/* ONE LIFE AI — 투자 분석(공부용)
 * 관심종목(주식·코인·선물), 일봉 시세·기술지표·차트, 뉴스 제목, 내가 세운 매매 시나리오(손익비·손실액·청산가 계산·복기), 투자 공부 기록.
 * 매수·매도 추천을 하지 않는다. 지표 설명은 '흔히 이렇게 부른다' 수준의 공부 메모다.
 * 시세: 코인=업비트 공개 API(폰에서 바로), 주식·선물=구글 시트 스크립트(v3)가 야후 파이낸스에서 대신 받아 옴.
 */
'use strict';

const INV_MARKETS = ['국내주식', '미국주식', '선물·지수', '코인', '코인 선물'];
const JOURNAL_KINDS = ['아이디어', '뉴스', '분석', '공부', '복기'];
const SCEN_STATUS = ['계획', '진입', '청산', '취소'];
const RISK_CHECKS = [
  '손절가를 미리 정했고 지킬 수 있다',
  '손절 시 손실 금액이 감당 가능하다(전체 자금 대비 비율 확인)',
  '실적 발표·금리 결정 등 큰 일정을 확인했다',
  '레버리지 사용 시 청산가를 확인했다',
  '뉴스를 보고 급하게 들어가는 것이 아니다',
];
const INV_DISCLAIMER = '공부·기록용 도구입니다. 매수·매도 추천이 아니며, 지표는 과거 가격으로 계산한 참고 값입니다.';

/* ───────── 시세 ───────── */
function invSymbol(w) {
  // 야후 코드 또는 업비트 마켓 코드
  if (w.market === '국내주식') return `${w.code}.${w.exch === '코스닥' ? 'KQ' : 'KS'}`;
  if (w.market === '코인' || w.market === '코인 선물') return `KRW-${w.code.toUpperCase()}`;
  return w.code.toUpperCase();
}
const isCoin = (w) => w.market === '코인' || w.market === '코인 선물';

async function fetchCandles(w, range = '1y') {
  const key = `cdl:${invSymbol(w)}:${range}`;
  try {
    const c = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (c && Date.now() - c.at < 10 * 60 * 1000) return c.d; // 10분 안에 받은 값은 다시 쓰기
  } catch { /* 무시 */ }
  let d;
  if (isCoin(w)) {
    const r = await fetch(`https://api.upbit.com/v1/candles/days?market=${encodeURIComponent(invSymbol(w))}&count=200`);
    if (!r.ok) throw new Error(r.status === 404 ? '업비트에 없는 코인입니다(코드 확인)' : `업비트 응답 ${r.status}`);
    const a = (await r.json()).reverse();
    if (!a.length) throw new Error('시세가 없습니다');
    d = { name: '', currency: 'KRW', t: a.map((x) => x.candle_date_time_kst.slice(0, 10)), o: a.map((x) => x.opening_price), h: a.map((x) => x.high_price), l: a.map((x) => x.low_price), c: a.map((x) => x.trade_price), v: a.map((x) => x.candle_acc_trade_volume) };
  } else {
    const j = await callSheet('chart', { symbol: invSymbol(w), range });
    const idx = j.c.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    const ts = (s) => { const x = new Date(s * 1000 + 9 * 3600 * 1000); return x.toISOString().slice(0, 10); };
    d = { name: j.meta.name, currency: j.meta.currency, t: idx.map((i) => ts(j.t[i])), o: idx.map((i) => j.o[i]), h: idx.map((i) => j.h[i]), l: idx.map((i) => j.l[i]), c: idx.map((i) => j.c[i]), v: idx.map((i) => j.v[i] || 0) };
  }
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), d })); } catch { /* 용량 초과 무시 */ }
  return d;
}

/* ───────── 기술지표 ───────── */
function sma(a, n) { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
function ema(a, n) { const o = []; const k = 2 / (n + 1); let p = null; for (let i = 0; i < a.length; i++) { if (a[i] == null) { o.push(null); continue; } p = p == null ? a[i] : a[i] * k + p * (1 - k); o.push(i >= n - 1 ? p : null); } return o; }
function rsi(c, n = 14) {
  const o = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return o;
}
function indicators(d) {
  const c = d.c, n = c.length;
  const ma5 = sma(c, 5), ma20 = sma(c, 20), ma60 = sma(c, 60), ma120 = sma(c, 120);
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const macd = c.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const sigRaw = ema(macd.map((x) => (x == null ? 0 : x)), 9);
  const firstMacd = macd.findIndex((x) => x != null);
  const signal = sigRaw.map((x, i) => (i >= firstMacd + 8 ? x : null));
  const r = rsi(c);
  const bbU = [], bbL = [];
  for (let i = 0; i < n; i++) {
    if (i < 19) { bbU.push(null); bbL.push(null); continue; }
    const s = c.slice(i - 19, i + 1), m = ma20[i];
    const sd = Math.sqrt(s.reduce((a, x) => a + (x - m) ** 2, 0) / 20);
    bbU.push(m + 2 * sd); bbL.push(m - 2 * sd);
  }
  const vAvg20 = sma(d.v, 20);
  const last = n - 1;
  const y = c.slice(-250);
  return {
    ma5, ma20, ma60, ma120, macd, signal, rsi: r, bbU, bbL,
    last: {
      close: c[last], prev: c[last - 1], chg: c[last - 1] ? (c[last] / c[last - 1] - 1) * 100 : 0,
      ma5: ma5[last], ma20: ma20[last], ma60: ma60[last], ma120: ma120[last], rsi: r[last],
      macd: macd[last], signal: signal[last], macdPrev: macd[last - 1], signalPrev: signal[last - 1],
      bbU: bbU[last], bbL: bbL[last], bbW: ma20[last] ? ((bbU[last] - bbL[last]) / ma20[last]) * 100 : null,
      volRatio: vAvg20[last] ? d.v[last] / vAvg20[last] : null,
      hi: Math.max(...y), lo: Math.min(...y), date: d.t[last],
    },
  };
}
const fmtNum = (v, cur) => (v == null || isNaN(v) ? '-' : cur === 'KRW' || v >= 1000 ? Math.round(v).toLocaleString('ko-KR') : (+v).toFixed(v < 10 ? 4 : 2));

/* 지표를 쉬운 말로 (공부용, 판단 아님) */
function explain(L) {
  const s = [];
  const pos = (a, b) => (a > b ? '위' : '아래');
  if (L.ma20 != null) s.push(`종가가 20일 평균선 ${pos(L.close, L.ma20)}${L.ma60 != null ? `, 60일 평균선 ${pos(L.close, L.ma60)}` : ''}에 있습니다.${L.ma60 != null ? (L.ma20 > L.ma60 ? ' 20일선이 60일선 위(흔히 정배열이라 부름).' : ' 20일선이 60일선 아래(흔히 역배열이라 부름).') : ''}`);
  if (L.rsi != null) s.push(`RSI ${L.rsi.toFixed(0)}: ${L.rsi >= 70 ? '70 이상은 흔히 과매수 구간이라고 부릅니다.' : L.rsi <= 30 ? '30 이하는 흔히 과매도 구간이라고 부릅니다.' : '30~70 사이의 중간 구간입니다.'}`);
  if (L.macd != null && L.signal != null) {
    const cross = L.macdPrev != null && L.signalPrev != null && (L.macdPrev - L.signalPrev) * (L.macd - L.signal) < 0;
    s.push(`MACD가 시그널선 ${pos(L.macd, L.signal)}에 있습니다${cross ? '(오늘 서로 교차)' : ''}. 위면 상승 쪽, 아래면 하락 쪽 힘이 크다고 해석하는 경우가 많습니다.`);
  }
  if (L.bbU != null) {
    const p = (L.close - L.bbL) / (L.bbU - L.bbL);
    s.push(`볼린저밴드 안 위치 ${(p * 100).toFixed(0)}%(0%=아래 선, 100%=위 선), 밴드 폭 ${L.bbW.toFixed(1)}%.${L.bbW < 8 ? ' 폭이 좁으면 변동성이 줄어든 상태로 봅니다.' : ''}`);
  }
  if (L.volRatio != null) s.push(`거래량은 20일 평균의 ${L.volRatio.toFixed(1)}배입니다.`);
  s.push(`최근 1년(최대 250일) 고가 대비 ${(((L.close / L.hi) - 1) * 100).toFixed(1)}%, 저가 대비 +${(((L.close / L.lo) - 1) * 100).toFixed(1)}%.`);
  return s;
}

/* ───────── 차트(캔버스) ───────── */
function drawChart(cv, d, ind, bars = 120) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--muted').trim() || '#888', line = css.getPropertyValue('--line').trim() || '#ddd', blue = css.getPropertyValue('--blue').trim() || '#1C60D6';
  const n = d.c.length, s = Math.max(0, n - bars), idx = [...Array(n - s).keys()].map((i) => i + s);
  const pH = H * 0.68, rTop = H * 0.74, rH = H * 0.24, padR = 46;
  const vals = idx.flatMap((i) => [d.h[i], d.l[i], ind.bbU[i], ind.bbL[i]]).filter((x) => x != null);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const X = (k) => (k / (idx.length - 1)) * (W - padR - 4) + 2;
  const Y = (v) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (pH - 12);
  g.clearRect(0, 0, W, H);
  g.font = '10px sans-serif'; g.fillStyle = ink; g.strokeStyle = line; g.lineWidth = 1;
  [hi, (hi + lo) / 2, lo].forEach((v) => { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W - padR, Y(v)); g.stroke(); g.fillText(fmtNum(v, d.currency), W - padR + 3, Y(v) + 3); });
  // 거래량
  const vmax = Math.max(...idx.map((i) => d.v[i] || 0)) || 1;
  g.fillStyle = 'rgba(128,128,128,.18)';
  idx.forEach((i, k) => { const h = ((d.v[i] || 0) / vmax) * pH * 0.25; g.fillRect(X(k) - 1, pH - h, 2, h); });
  // 볼린저 밴드
  g.fillStyle = 'rgba(28,96,214,.08)'; g.beginPath();
  idx.forEach((i, k) => { if (ind.bbU[i] != null) g.lineTo(X(k), Y(ind.bbU[i])); });
  [...idx].reverse().forEach((i) => { const k = idx.indexOf(i); if (ind.bbL[i] != null) g.lineTo(X(k), Y(ind.bbL[i])); });
  g.fill();
  const path = (arr, color, w) => { g.strokeStyle = color; g.lineWidth = w; g.beginPath(); let st = false; idx.forEach((i, k) => { if (arr[i] == null) return; st ? g.lineTo(X(k), Y(arr[i])) : g.moveTo(X(k), Y(arr[i])); st = true; }); g.stroke(); };
  path(ind.ma60, '#9B6BD6', 1.2); path(ind.ma20, '#E08A1E', 1.2); path(d.c, blue, 1.8);
  // RSI
  const RY = (v) => rTop + (1 - v / 100) * rH;
  g.strokeStyle = line; g.lineWidth = 1; [30, 70].forEach((v) => { g.beginPath(); g.moveTo(0, RY(v)); g.lineTo(W - padR, RY(v)); g.stroke(); g.fillStyle = ink; g.fillText(v, W - padR + 3, RY(v) + 3); });
  g.fillText('RSI', 4, rTop + 10);
  path2(g, idx, ind.rsi, X, RY, '#D64545');
  g.fillStyle = ink; g.fillText(d.t[idx[0]].slice(2), 2, H - 1); g.fillText(d.t[idx[idx.length - 1]].slice(2), W - padR - 40, H - 1);
}
function path2(g, idx, arr, X, Y, color) { g.strokeStyle = color; g.lineWidth = 1.2; g.beginPath(); let st = false; idx.forEach((i, k) => { if (arr[i] == null) return; st ? g.lineTo(X(k), Y(arr[i])) : g.moveTo(X(k), Y(arr[i])); st = true; }); g.stroke(); }

/* ───────── 투자 홈 ───────── */
async function invAll() { return DB.all('invest'); }

async function viewInvest() {
  setTitle('투자 분석', true);
  const all = await invAll();
  const watch = all.filter((x) => x.type === 'watch').sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const scens = all.filter((x) => x.type === 'scenario' && (x.status === '계획' || x.status === '진입'));
  const jr = all.filter((x) => x.type === 'journal').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 5);
  const wmap = Object.fromEntries(watch.map((w) => [w.id, w]));
  view().innerHTML = `
    <div class="card" style="border-color:var(--gold)"><div class="muted">⚠️ ${esc(INV_DISCLAIMER)}</div></div>
    <div class="row spread"><h2 style="font-size:16px;margin:4px 0">⭐ 관심종목 ${watch.length}</h2><a class="btn small primary" href="#/inv/new">+ 종목 추가</a></div>
    <div id="watchList">${watch.map((w) => `<a class="item" href="#/inv/${w.id}" id="w_${w.id}"><div class="row spread"><span class="t">${esc(w.name || w.code)} <span class="muted">${esc(w.market)} · ${esc(invSymbol(w))}</span></span><span class="q muted">불러오는 중…</span></div><div class="muted s"></div></a>`).join('') || '<div class="empty">관심종목을 추가하세요. (예: 삼성전자 005930, NVDA, BTC, NQ=F)</div>'}</div>
    <div class="card" style="margin-top:12px"><div class="row spread"><h2 style="margin:0">📋 진행 중 시나리오 ${scens.length}</h2><a class="btn small" href="#/scens">전체 ›</a></div>
      <div style="margin-top:8px">${scens.map((s) => scenLine(s, wmap)).join('') || '<div class="muted">진행 중인 시나리오가 없습니다.</div>'}</div></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">📝 투자 기록</h2><a class="btn small" href="#/ijournal">전체 ›</a></div>
      <div class="row wrap" style="margin:8px 0">${JOURNAL_KINDS.map((k) => `<a class="btn small" href="#/ij/new?k=${encodeURIComponent(k)}">+ ${k}</a>`).join('')}</div>
      ${jr.map((j) => jLine(j, wmap)).join('') || '<div class="muted">기록이 없습니다.</div>'}</div>
    <button class="btn block" id="mktBrief" type="button">🤖 오늘 시장·관심종목 뉴스 정리를 Claude에게 요청</button>`;
  $('#mktBrief').onclick = () => {
    const names = watch.map((w) => `${w.name || w.code}(${invSymbol(w)})`).join(', ') || '없음';
    claudeOpen(`오늘은 ${todayStr()}입니다. 한국어로, 결론 먼저 짧게.\n\n요청: 오늘 주식·코인 시장 주요 뉴스와 아래 관심종목 관련 뉴스를 정리해 주세요.\n관심종목: ${names}\n\n조건: 최신 뉴스를 검색해 출처(매체·날짜)를 붙이고, 공부용 정리로만 써 주세요. 매수·매도 추천이나 목표가는 쓰지 마세요. 어려운 용어는 풀어 주세요.`);
  };
  // 시세는 하나씩 차례로(요청이 몰리지 않게)
  for (const w of watch) {
    const el = $(`#w_${w.id}`); if (!el) continue;
    try {
      const d = await fetchCandles(w, '1y');
      const I = indicators(d).last;
      el.querySelector('.q').innerHTML = `<b style="color:var(--ink)">${fmtNum(I.close, d.currency)}</b> <span style="color:${I.chg >= 0 ? 'var(--red)' : 'var(--blue)'}">${I.chg >= 0 ? '+' : ''}${I.chg.toFixed(2)}%</span>`;
      el.querySelector('.s').textContent = `RSI ${I.rsi != null ? I.rsi.toFixed(0) : '-'} · 20일선 ${I.ma20 != null ? (I.close > I.ma20 ? '위' : '아래') : '-'} · ${I.date}`;
    } catch (e) { el.querySelector('.q').textContent = '시세 실패'; el.querySelector('.s').textContent = e.message; }
  }
}

function scenLine(s, wmap) {
  const w = wmap[s.watchId] || {};
  const c = scenCalc(s);
  return `<a class="item" href="#/scen/${s.id}"><div class="row spread"><span class="t">${esc(w.name || w.code || '종목 없음')} · ${esc(s.dir)}</span><span class="badge ${s.status === '진입' ? 's-예약' : s.status === '청산' ? 's-완료' : ''}">${esc(s.status)}</span></div>
    <div class="muted">진입 ${esc(s.entry || '-')} · 목표 ${esc(s.target || '-')} · 손절 ${esc(s.stop || '-')}${c.rr ? ` · 손익비 ${c.rr.toFixed(1)}` : ''}${s.status === '청산' && c.pnl != null ? ` · 결과 ${won(Math.round(c.pnl))}` : ''}</div></a>`;
}
function jLine(j, wmap) {
  const w = wmap[j.watchId];
  return `<a class="item" href="#/ij/${j.id}"><div class="muted">${esc((j.createdAt || '').slice(0, 10))} · <span class="badge">${esc(j.kind)}</span>${w ? ' · ' + esc(w.name || w.code) : ''}</div>
    <div style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(j.text)}</div></a>`;
}

function claudeOpen(prompt) {
  try { navigator.clipboard.writeText(prompt); } catch { /* 무시 */ }
  toast('요청문을 복사했습니다. Claude가 열리면 붙여넣기(이미 들어가 있으면 그대로 보내기)');
  window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt), '_blank', 'noopener');
}

/* ───────── 관심종목 추가·수정 ───────── */
async function viewInvEdit(id) {
  const w = id ? await DB.get('invest', id) : null;
  setTitle(w ? '종목 수정' : '관심종목 추가', true);
  const x = w || { market: '국내주식', exch: '코스피' };
  view().innerHTML = `
    <form class="card" id="wf" autocomplete="off">
      <label for="w_market">시장</label><select id="w_market">${opts(INV_MARKETS, x.market)}</select>
      <div id="w_exchBox"><label for="w_exch">거래소</label><select id="w_exch">${opts(['코스피', '코스닥'], x.exch)}</select></div>
      <label for="w_code">종목 코드</label><input id="w_code" value="${esc(x.code)}" placeholder="">
      <div class="muted" id="w_hint"></div>
      <label for="w_name">이름(표시용)</label><input id="w_name" value="${esc(x.name)}" placeholder="예: 삼성전자">
      <label for="w_memo">관심 이유·메모</label><textarea id="w_memo" rows="3">${esc(x.memo)}</textarea>
      <button class="btn block" id="w_test" type="button" style="margin-top:10px">시세 확인</button>
      <div id="w_res" class="muted" style="margin-top:6px"></div>
      <button class="btn primary block" type="submit" style="margin-top:10px">💾 저장</button>
    </form>
    ${w ? '<button class="btn danger block" id="w_del" type="button">관심종목 삭제</button>' : ''}`;
  const HINT = { '국내주식': '6자리 숫자 (예: 005930 삼성전자, 000660 SK하이닉스)', '미국주식': '티커 (예: NVDA, AAPL, TSLA, QQQ)', '선물·지수': '야후 코드 (예: NQ=F 나스닥100 선물, ES=F S&P500 선물, GC=F 금, CL=F 유가, ^KS11 코스피)', '코인': '업비트 원화 코인 (예: BTC, ETH, XRP)', '코인 선물': '코인 코드 (예: BTC). 가격은 업비트 현물 기준으로 보여 줍니다.' };
  const upd = () => { $('#w_exchBox').hidden = $('#w_market').value !== '국내주식'; $('#w_hint').textContent = HINT[$('#w_market').value]; };
  $('#w_market').onchange = upd; upd();
  const read = () => ({ ...(w || { id: uid(), type: 'watch', createdAt: new Date().toISOString() }), market: $('#w_market').value, exch: $('#w_exch').value, code: $('#w_code').value.trim().replace(/\s/g, ''), name: $('#w_name').value.trim(), memo: $('#w_memo').value.trim(), updatedAt: new Date().toISOString() });
  $('#w_test').onclick = async () => {
    const v = read(); if (!v.code) { toast('코드를 넣어 주세요'); return; }
    $('#w_res').textContent = '확인 중…';
    try {
      const d = await fetchCandles(v);
      const I = indicators(d).last;
      $('#w_res').textContent = `✅ ${d.name || invSymbol(v)} ${fmtNum(I.close, d.currency)} ${d.currency || ''} (${I.date}, ${d.c.length}일치)`;
      if (!$('#w_name').value && d.name) $('#w_name').value = d.name;
    } catch (e) { $('#w_res').textContent = '❌ ' + e.message; }
  };
  $('#wf').onsubmit = async (e) => {
    e.preventDefault();
    const v = read(); if (!v.code) { toast('코드를 넣어 주세요'); return; }
    await DB.put('invest', v); toast('저장했습니다'); location.replace(`#/inv/${v.id}`);
  };
  if (w) $('#w_del').onclick = async () => { if (confirm('관심종목을 지울까요? (시나리오·기록은 남습니다)')) { await DB.del('invest', w.id); location.replace('#/invest'); } };
}

/* ───────── 종목 상세 ───────── */
async function viewInvDetail(id) {
  const w = await DB.get('invest', id);
  if (!w || w.type !== 'watch') { setTitle('종목', true); view().innerHTML = '<div class="empty">종목을 찾을 수 없습니다.</div>'; return; }
  setTitle(w.name || w.code, true);
  const all = await invAll();
  const scens = all.filter((x) => x.type === 'scenario' && x.watchId === id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const jr = all.filter((x) => x.type === 'journal' && x.watchId === id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const wmap = { [id]: w };
  view().innerHTML = `
    <div class="card"><div class="row spread"><div><div class="muted">${esc(w.market)} · ${esc(invSymbol(w))}</div><div id="px" style="font-size:24px;font-weight:800">불러오는 중…</div></div><a class="btn small" href="#/inv/edit/${id}">수정</a></div>
      ${w.memo ? `<div class="muted" style="margin-top:6px">${esc(w.memo)}</div>` : ''}</div>
    <div class="card"><div class="row spread"><h2 style="margin:0">차트 (최근 120일)</h2><span class="muted" style="font-size:12px"><span style="color:var(--blue)">━</span>종가 <span style="color:#E08A1E">━</span>20일 <span style="color:#9B6BD6">━</span>60일</span></div>
      <canvas id="cv" style="width:100%;height:300px;margin-top:8px"></canvas></div>
    <div class="card"><h2>기술지표</h2><div id="indTbl" class="muted">-</div></div>
    <div class="card"><h2>지표 쉬운 해석 <span class="muted">(공부용)</span></h2><ul id="expl" style="margin:0;padding-left:18px"></ul>
      <div class="muted" style="margin-top:8px">${esc(INV_DISCLAIMER)}</div></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">📰 뉴스 (최근 7일)</h2><button class="btn small" id="newsBtn" type="button">불러오기</button></div><div id="newsBox" style="margin-top:8px"></div></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">📋 내 매매 시나리오</h2><a class="btn small primary" href="#/scen/new?w=${id}">+ 시나리오</a></div>
      <div style="margin-top:8px">${scens.map((s) => scenLine(s, wmap)).join('') || '<div class="muted">아직 없습니다. 진입·목표·손절을 미리 적어 두면 손익비와 손실액을 계산해 줍니다.</div>'}</div></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">📝 이 종목 기록</h2><a class="btn small" href="#/ij/new?w=${id}">+ 기록</a></div>
      <div style="margin-top:8px">${jr.map((j) => jLine(j, wmap)).join('') || '<div class="muted">기록이 없습니다.</div>'}</div></div>
    <button class="btn block" id="askClaude" type="button">🤖 지표·시나리오로 Claude에게 공부용 분석 요청</button>`;

  let snap = null;
  try {
    const d = await fetchCandles(w, '1y');
    const ind = indicators(d), L = ind.last;
    snap = { d, L };
    $('#px').innerHTML = `${fmtNum(L.close, d.currency)} <span style="font-size:15px;color:${L.chg >= 0 ? 'var(--red)' : 'var(--blue)'}">${L.chg >= 0 ? '+' : ''}${L.chg.toFixed(2)}%</span> <span class="muted" style="font-size:13px">${L.date}</span>`;
    drawChart($('#cv'), d, ind);
    window.addEventListener('resize', () => { if ($('#cv')) drawChart($('#cv'), d, ind); }, { once: true });
    const row = (k, v) => `<tr><td>${k}</td><td class="r"><b style="color:var(--ink)">${v}</b></td></tr>`;
    $('#indTbl').innerHTML = `<table><tbody>
      ${row('5 / 20일 평균선', `${fmtNum(L.ma5, d.currency)} / ${fmtNum(L.ma20, d.currency)}`)}
      ${row('60 / 120일 평균선', `${fmtNum(L.ma60, d.currency)} / ${fmtNum(L.ma120, d.currency)}`)}
      ${row('RSI(14)', L.rsi != null ? L.rsi.toFixed(1) : '-')}
      ${row('MACD / 시그널', L.macd != null ? `${L.macd.toFixed(2)} / ${L.signal != null ? L.signal.toFixed(2) : '-'}` : '-')}
      ${row('볼린저 위 / 아래', `${fmtNum(L.bbU, d.currency)} / ${fmtNum(L.bbL, d.currency)}`)}
      ${row('거래량(20일 평균 대비)', L.volRatio != null ? L.volRatio.toFixed(2) + '배' : '-')}
      ${row('1년 고가 / 저가', `${fmtNum(L.hi, d.currency)} / ${fmtNum(L.lo, d.currency)}`)}
    </tbody></table>`;
    $('#expl').innerHTML = explain(L).map((s) => `<li>${esc(s)}</li>`).join('');
  } catch (e) {
    $('#px').textContent = '시세를 불러오지 못했습니다';
    $('#indTbl').textContent = e.message + (isCoin(w) ? '' : ' — 주식·선물 시세는 설정의 구글 시트 연결(스크립트 v3)이 필요합니다.');
  }

  $('#newsBtn').onclick = async () => {
    $('#newsBox').textContent = '불러오는 중…';
    try {
      const q = w.name || w.code;
      const r = await callSheet('news', { q });
      $('#newsBox').innerHTML = r.items.length ? r.items.map((it) => `<a class="item" href="${esc(it.link)}" target="_blank" rel="noopener" style="padding:9px 12px">${esc(it.title)}<div class="muted">${esc(it.source)} · ${esc(new Date(it.date).toLocaleDateString('ko-KR'))}</div></a>`).join('')
        + `<button class="btn small" id="newsSave" type="button">이 뉴스 제목들을 기록으로 저장</button>` : '<div class="muted">최근 뉴스가 없습니다.</div>';
      if (r.items.length) $('#newsSave').onclick = async () => {
        await DB.put('invest', { id: uid(), type: 'journal', kind: '뉴스', watchId: id, text: r.items.map((it) => `- ${it.title} (${it.source})`).join('\n'), createdAt: new Date().toISOString() });
        toast('뉴스 기록으로 저장했습니다'); render();
      };
    } catch (e) { $('#newsBox').textContent = '❌ ' + e.message; }
  };

  $('#askClaude').onclick = () => {
    const L = snap && snap.L, cur = snap && snap.d.currency;
    const ind = L ? `종가 ${fmtNum(L.close, cur)}(${L.date}, 전일 대비 ${L.chg.toFixed(2)}%), 20일선 ${fmtNum(L.ma20, cur)}, 60일선 ${fmtNum(L.ma60, cur)}, RSI ${L.rsi != null ? L.rsi.toFixed(1) : '-'}, MACD ${L.macd != null ? L.macd.toFixed(2) : '-'}/시그널 ${L.signal != null ? L.signal.toFixed(2) : '-'}, 볼린저 ${fmtNum(L.bbL, cur)}~${fmtNum(L.bbU, cur)}, 거래량 20일 평균의 ${L.volRatio != null ? L.volRatio.toFixed(1) : '-'}배, 1년 고가 ${fmtNum(L.hi, cur)} 저가 ${fmtNum(L.lo, cur)}` : '지표 없음';
    const sc = scens.filter((s) => s.status !== '취소').slice(0, 3).map((s) => `- ${s.dir} 진입 ${s.entry} 목표 ${s.target} 손절 ${s.stop} 레버리지 ${s.lev || 1}배 / 근거: ${s.reason || '-'}`).join('\n') || '- 없음';
    claudeOpen(`오늘은 ${todayStr()}입니다. 한국어로, 결론 먼저 짧게.\n\n종목: ${w.name || w.code} (${invSymbol(w)}, ${w.market})\n기술지표: ${ind}\n내가 적은 시나리오:\n${sc}\n\n요청: 공부용으로 ① 지표가 보여 주는 상황을 쉬운 말로 ② 최근 뉴스·일정(실적, 금리 등) 검색해 출처와 함께 ③ 내 시나리오의 리스크(손절 위치, 손익비, 레버리지 위험)와 놓친 점을 짚어 주세요.\n조건: 매수·매도 추천, 목표가 제시는 하지 마세요.`);
  };
}

/* ───────── 매매 시나리오 ───────── */
function scenCalc(s) {
  const e = +s.entry, t = +s.target, st = +s.stop, cap = +s.capital || 0, lev = +s.lev || 1, long = s.dir !== '숏(매도)';
  const out = {};
  if (e && t) out.gainPct = (long ? t / e - 1 : 1 - t / e) * 100 * lev;
  if (e && st) out.lossPct = (long ? 1 - st / e : st / e - 1) * 100 * lev;
  if (out.lossPct > 100) out.lossPct = 100; // 손절 전에 청산되면 투자금 전부(그 이상은 잃지 않는 격리 기준)
  if (out.gainPct != null && out.lossPct) out.rr = out.gainPct / out.lossPct;
  if (cap && out.gainPct != null) out.gain = cap * out.gainPct / 100;
  if (cap && out.lossPct != null) out.loss = cap * out.lossPct / 100;
  if (e && lev > 1) out.liq = long ? e * (1 - 1 / lev) : e * (1 + 1 / lev); // 대략(거래소 유지증거금·수수료 제외)
  if (s.status === '청산' && e && +s.exit && cap) out.pnl = Math.max(-cap, cap * (long ? +s.exit / e - 1 : 1 - +s.exit / e) * lev);
  return out;
}

async function viewScen(id) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const s0 = id ? await DB.get('invest', id) : null;
  if (id && !s0) { setTitle('시나리오', true); view().innerHTML = '<div class="empty">시나리오를 찾을 수 없습니다.</div>'; return; }
  const watch = (await invAll()).filter((x) => x.type === 'watch');
  const s = s0 || { type: 'scenario', watchId: qs.get('w') || (watch[0] || {}).id, dir: '롱(매수)', status: '계획', lev: 1, checks: [] };
  setTitle(s0 ? '매매 시나리오' : '새 시나리오', true);
  const wsel = watch.map((w) => `<option value="${w.id}"${w.id === s.watchId ? ' selected' : ''}>${esc(w.name || w.code)} (${esc(w.market)})</option>`).join('');
  view().innerHTML = `
    <div class="card" style="border-color:var(--gold)"><div class="muted">내가 세운 계획을 적고 숫자로 점검하는 곳입니다. 추천이 아닙니다.</div></div>
    <form class="card" id="sf" autocomplete="off">
      <label for="s_w">종목</label><select id="s_w">${wsel || '<option value="">관심종목을 먼저 추가하세요</option>'}</select>
      <div class="grid2">
        <div><label for="s_dir">방향</label><select id="s_dir">${opts(['롱(매수)', '숏(매도)'], s.dir)}</select></div>
        <div><label for="s_status">상태</label><select id="s_status">${opts(SCEN_STATUS, s.status)}</select></div>
      </div>
      <div class="grid2">
        <div><label for="s_entry">진입가</label><input id="s_entry" type="number" inputmode="decimal" step="any" value="${esc(s.entry)}"></div>
        <div><label for="s_target">목표가</label><input id="s_target" type="number" inputmode="decimal" step="any" value="${esc(s.target)}"></div>
      </div>
      <div class="grid2">
        <div><label for="s_stop">손절가</label><input id="s_stop" type="number" inputmode="decimal" step="any" value="${esc(s.stop)}"></div>
        <div><label for="s_lev">레버리지(배)</label><input id="s_lev" type="number" inputmode="decimal" min="1" step="any" value="${esc(s.lev || 1)}"></div>
      </div>
      <label for="s_cap">투자금(원)</label><input id="s_cap" type="number" inputmode="numeric" step="10000" value="${esc(s.capital)}" placeholder="예: 1000000">
      <div id="calc" class="card" style="margin:10px 0 0;background:var(--bg)"></div>
      <label for="s_reason">근거(지표·뉴스·아이디어)</label><textarea id="s_reason" rows="3">${esc(s.reason)}</textarea>
      <label>리스크 체크</label>
      ${RISK_CHECKS.map((c, i) => `<label class="row" style="color:var(--ink);font-size:14px;margin:4px 0"><input type="checkbox" data-ck="${i}" ${(s.checks || []).includes(i) ? 'checked' : ''} style="width:20px;min-height:20px;flex:none"> ${esc(c)}</label>`).join('')}
      <div id="exitBox">
        <label for="s_exit">청산가(청산 후)</label><input id="s_exit" type="number" inputmode="decimal" step="any" value="${esc(s.exit)}">
        <label for="s_review">복기(지킨 것·못 지킨 것·배운 것)</label><textarea id="s_review" rows="3">${esc(s.review)}</textarea>
      </div>
      <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button>
    </form>
    ${s0 ? '<button class="btn danger block" id="s_del" type="button">시나리오 삭제</button>' : ''}`;
  const read = () => ({
    ...s, id: s.id || uid(), createdAt: s.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    watchId: $('#s_w').value, dir: $('#s_dir').value, status: $('#s_status').value, entry: $('#s_entry').value, target: $('#s_target').value, stop: $('#s_stop').value,
    lev: $('#s_lev').value || 1, capital: $('#s_cap').value, reason: $('#s_reason').value.trim(), exit: $('#s_exit').value, review: $('#s_review').value.trim(),
    checks: [...view().querySelectorAll('[data-ck]')].filter((x) => x.checked).map((x) => +x.dataset.ck),
  });
  const calc = () => {
    const v = read(), c = scenCalc(v);
    $('#exitBox').hidden = !(v.status === '청산' || v.status === '취소');
    const warn = [];
    if (+v.entry && +v.stop && ((v.dir === '롱(매수)' && +v.stop >= +v.entry) || (v.dir === '숏(매도)' && +v.stop <= +v.entry))) warn.push('손절가가 진입가의 반대쪽에 있어야 합니다');
    if (c.rr != null && c.rr < 1) warn.push('손익비가 1보다 작습니다(목표 수익보다 손절 손실이 큼)');
    if (+v.lev > 1) warn.push(`레버리지 ${v.lev}배: 가격이 ${(100 / v.lev).toFixed(1)}% 반대로 가면 원금 전부를 잃을 수 있습니다`);
    if (+v.lev > 1 && c.liq && +v.stop && ((v.dir === '롱(매수)' && +v.stop <= c.liq) || (v.dir === '숏(매도)' && +v.stop >= c.liq))) warn.push('손절가가 청산가보다 멀리 있습니다(손절 전에 청산될 수 있음)');
    if (v.checks.length < RISK_CHECKS.length) warn.push(`리스크 체크 ${v.checks.length}/${RISK_CHECKS.length}`);
    $('#calc').innerHTML = `
      <div class="grid2">
        <div><div class="muted">목표 도달 시</div><b style="color:var(--red)">${c.gainPct != null ? '+' + c.gainPct.toFixed(1) + '%' : '-'}${c.gain != null ? ' / ' + won(Math.round(c.gain)) : ''}</b></div>
        <div><div class="muted">손절 시</div><b style="color:var(--blue)">${c.lossPct != null ? '-' + c.lossPct.toFixed(1) + '%' : '-'}${c.loss != null ? ' / -' + won(Math.round(c.loss)) : ''}</b></div>
        <div><div class="muted">손익비</div><b>${c.rr != null ? c.rr.toFixed(2) + ' : 1' : '-'}</b></div>
        <div><div class="muted">대략 청산가</div><b>${c.liq ? fmtNum(c.liq) : '-'}</b></div>
      </div>
      ${c.pnl != null ? `<div style="margin-top:6px">청산 결과: <b>${won(Math.round(c.pnl))}</b></div>` : ''}
      ${warn.length ? `<ul style="margin:8px 0 0;padding-left:18px;color:var(--red);font-size:14px">${warn.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="muted" style="font-size:12px;margin-top:6px">레버리지·청산가는 수수료·유지증거금을 뺀 대략 값입니다.</div>`;
  };
  $('#sf').oninput = calc; $('#sf').onchange = calc; calc();
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const v = read();
    if (!v.watchId) { toast('관심종목을 먼저 추가하세요'); return; }
    await DB.put('invest', v);
    if (v.status === '청산' && v.review && !s.reviewSaved) {
      await DB.put('invest', { id: uid(), type: 'journal', kind: '복기', watchId: v.watchId, text: v.review, scenId: v.id, createdAt: new Date().toISOString() });
      await DB.put('invest', { ...v, reviewSaved: true });
    }
    toast('저장했습니다'); location.replace(`#/inv/${v.watchId}`);
  };
  if (s0) $('#s_del').onclick = async () => { if (confirm('이 시나리오를 지울까요?')) { await DB.del('invest', s0.id); location.replace('#/invest'); } };
}

async function viewScens() {
  setTitle('매매 시나리오', true);
  const all = await invAll();
  const wmap = Object.fromEntries(all.filter((x) => x.type === 'watch').map((w) => [w.id, w]));
  const sc = all.filter((x) => x.type === 'scenario').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const closed = sc.filter((s) => s.status === '청산').map((s) => scenCalc(s).pnl).filter((x) => x != null);
  const wins = closed.filter((x) => x > 0).length;
  view().innerHTML = `
    ${closed.length ? `<div class="card"><h2>청산 결과 요약</h2><div class="grid2"><div><div class="muted">청산 ${closed.length}건 · 수익 ${wins}건</div><b>승률 ${((wins / closed.length) * 100).toFixed(0)}%</b></div><div><div class="muted">손익 합계</div><b>${won(Math.round(closed.reduce((a, x) => a + x, 0)))}</b></div></div></div>` : ''}
    ${SCEN_STATUS.map((st) => { const l = sc.filter((s) => s.status === st); return l.length ? `<h2 style="font-size:15px">${st} ${l.length}</h2>${l.map((s) => scenLine(s, wmap)).join('')}` : ''; }).join('') || '<div class="empty">시나리오가 없습니다. 종목 화면에서 추가하세요.</div>'}`;
}

/* ───────── 투자 기록 ───────── */
async function viewJournal() {
  setTitle('투자 기록', true);
  const all = await invAll();
  const wmap = Object.fromEntries(all.filter((x) => x.type === 'watch').map((w) => [w.id, w]));
  const jr = all.filter((x) => x.type === 'journal').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  let k = '전체', q = '';
  const draw = () => {
    $('#jl').innerHTML = jr.filter((j) => (k === '전체' || j.kind === k) && (!q || (j.text || '').toLowerCase().includes(q))).map((j) => jLine(j, wmap)).join('') || '<div class="empty">기록이 없습니다.</div>';
    document.querySelectorAll('#jk .chip').forEach((c) => c.classList.toggle('on', c.dataset.v === k));
  };
  view().innerHTML = `<input id="q" type="search" placeholder="기록 검색" style="margin-bottom:10px">
    <div class="chips" id="jk">${['전체', ...JOURNAL_KINDS].map((v) => `<button class="chip" data-v="${v}">${v}</button>`).join('')}</div><div id="jl"></div>`;
  $('#jk').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { k = b.dataset.v; draw(); } };
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
  fab('#/ij/new');
}

async function viewJEdit(id) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const j0 = id ? await DB.get('invest', id) : null;
  const watch = (await invAll()).filter((x) => x.type === 'watch');
  const j = j0 || { type: 'journal', kind: qs.get('k') || '아이디어', watchId: qs.get('w') || '' };
  setTitle(j0 ? '투자 기록' : '새 투자 기록', true);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  view().innerHTML = `
    <form class="card" id="jf" autocomplete="off">
      <div class="grid2">
        <div><label for="j_kind">종류</label><select id="j_kind">${opts(JOURNAL_KINDS, j.kind)}</select></div>
        <div><label for="j_w">종목(선택)</label><select id="j_w"><option value="">없음</option>${watch.map((w) => `<option value="${w.id}"${w.id === j.watchId ? ' selected' : ''}>${esc(w.name || w.code)}</option>`).join('')}</select></div>
      </div>
      <label for="j_text">내용</label><textarea id="j_text" rows="8" placeholder="아이디어·뉴스 요약·분석·공부한 내용·복기">${esc(j.text)}</textarea>
      <button class="btn" id="j_mic" type="button" style="margin-top:8px">🎤 말로 입력</button>
      <label for="j_link">링크(선택)</label><input id="j_link" type="url" value="${esc(j.link)}">
      <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button>
    </form>
    ${j0 ? '<button class="btn danger block" id="j_del" type="button">기록 삭제</button>' : ''}`;
  let rec = null;
  $('#j_mic').onclick = () => {
    if (!SR) { toast('키보드의 🎤 버튼을 쓰세요'); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = true;
    const base = $('#j_text').value; let fin = '';
    rec.onresult = (ev) => { let it = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const x = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += x + ' '; else it += x; } $('#j_text').value = (base ? base + '\n' : '') + fin + it; };
    rec.onstart = () => { $('#j_mic').textContent = '⏹ 그만 듣기'; };
    rec.onend = () => { rec = null; $('#j_mic').textContent = '🎤 말로 입력'; };
    try { rec.start(); } catch { rec = null; }
  };
  $('#jf').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#j_text').value.trim(); if (!text) { toast('내용을 넣어 주세요'); return; }
    await DB.put('invest', { ...j, id: j.id || uid(), createdAt: j.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), kind: $('#j_kind').value, watchId: $('#j_w').value, text, link: $('#j_link').value.trim() });
    toast('저장했습니다'); history.length > 1 ? history.back() : (location.hash = '#/ijournal');
  };
  if (j0) $('#j_del').onclick = async () => { if (confirm('이 기록을 지울까요?')) { await DB.del('invest', j0.id); location.replace('#/ijournal'); } };
}
