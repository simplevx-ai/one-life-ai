/* ONE LIFE AI — 운동노트 (마라톤 + 프리다이빙), 1차
 * 러닝 기록·페이스 계산기·러닝화·대회 / 숨참기 테이블(안전 확인 필수)·다이브 로그 / 홈 카드·통계.
 * GPS 측정은 워치·기존 앱에 맡기고, 이 앱은 계획·기록·분석만 한다.
 * 컨디션 체크·훈련 플랜·레이스 모드·포인트 날씨는 2차.
 * 저장: IndexedDB 'sport'(type: run·shoe·race·table·tablerun·dive), 설정 settings 'sport'.
 */
'use strict';

const RUN_KINDS = ['조깅', '템포', '인터벌', 'LSD', '레이스'];
const RACE_DIST = { '5K': 5, '10K': 10, '하프': 21.0975, '풀': 42.195 };
const DIVE_DISC = ['CWT', 'FIM', 'CNF', 'STA', 'DYN'];
const SAFETY_TEXT = '숨참기 테이블은 물 밖 드라이 트레이닝 전용입니다. 반드시 누운 자세로 하세요. 물속·욕조에서 절대 사용하지 마세요. 물에서는 반드시 버디와 함께 하세요. 어지러움·저림이 느껴지면 즉시 멈추세요.';

/* ───────── 공통 ───────── */
const SP = { all: () => DB.all('sport'), put: (x) => DB.put('sport', x), get: (id) => DB.get('sport', id), del: (id) => DB.del('sport', id) };
async function spCfg() { return { weekKm: 30, staticPB: 0, shoeLimit: 700, ...(await getSetting('sport', {})) }; }
function toSec(s) {
  const p = String(s || '').trim().split(':').map((x) => +x);
  if (!p.length || p.some((x) => isNaN(x))) return 0;
  return p.reduce((a, x) => a * 60 + x, 0);
}
function hms(sec, forceH) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h || forceH ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
const paceStr = (sec, km) => (km > 0 && sec > 0 ? hms(sec / km) : '-');
function weekStart(d = new Date()) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return nowISO(x).slice(0, 10); }
function addD(iso, n) { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return nowISO(d).slice(0, 10); }
function dday(iso) { const t = new Date(todayStr() + 'T00:00'), d = new Date(iso + 'T00:00'); return Math.round((d - t) / 864e5); }
const ddayStr = (n) => (n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`);
function shoeKm(shoe, runs) { return (+shoe.startKm || 0) + runs.filter((r) => r.shoeId === shoe.id).reduce((a, r) => a + (+r.km || 0), 0); }
function bestStatic(items, cfg) {
  const fromLog = items.filter((x) => x.type === 'dive').flatMap((s) => (s.dives || []).filter((d) => d.disc === 'STA').map((d) => toSec(d.downtime)));
  const fromRun = items.filter((x) => x.type === 'tablerun').flatMap((r) => (r.rounds || []).filter((x) => x.done).map((x) => x.hold));
  return Math.max(+cfg.staticPB || 0, ...fromLog, ...fromRun, 0);
}
function racePBs(items) {
  const pb = {};
  items.filter((x) => x.type === 'race' && x.resultSec && x.dist).forEach((r) => { if (!pb[r.dist] || r.resultSec < pb[r.dist].resultSec) pb[r.dist] = r; });
  return pb;
}
function speak(t) { try { const u = new SpeechSynthesisUtterance(t); u.lang = 'ko-KR'; u.rate = 1.1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* 무시 */ } }
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch { /* 무시 */ } }

/* ───────── 운동노트 홈 ───────── */
async function viewSport() {
  setTitle('운동노트', true);
  const [items, cfg] = await Promise.all([SP.all(), spCfg()]);
  const runs = items.filter((x) => x.type === 'run');
  const ws = weekStart(), today = todayStr();
  const weekKm = runs.filter((r) => r.date >= ws).reduce((a, r) => a + (+r.km || 0), 0);
  const todayRuns = runs.filter((r) => r.date === today);
  const todayTables = items.filter((x) => x.type === 'tablerun' && (x.date || '').slice(0, 10) === today);
  const dives = items.filter((x) => x.type === 'dive').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const todayDives = dives.filter((d) => d.date === today);
  const races = items.filter((x) => x.type === 'race' && x.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const next = races[0];
  const sta = bestStatic(items, cfg);
  const last = dives[0];
  const maxDepth = (s) => Math.max(0, ...(s.dives || []).map((d) => +d.depth || 0));
  const pct = Math.min(100, Math.round((weekKm / (cfg.weekKm || 1)) * 100));
  const alerts = sportAlerts(items, cfg);
  view().innerHTML = `
    ${alerts.length ? `<div class="card warnbox">${alerts.map((a) => `<a class="item" href="${a.href}" style="padding:9px 12px">${a.icon} ${esc(a.text)}</a>`).join('')}</div>` : ''}
    <div class="grid2" style="margin-bottom:12px">
      <a class="stat" href="#/run/new" style="text-decoration:none;color:inherit"><span class="muted">🏃 이번 주 러닝</span><b>${weekKm.toFixed(1)}km</b>
        <div style="background:var(--bg);border-radius:6px;height:8px;margin-top:6px"><div style="width:${pct}%;background:var(--blue);height:100%;border-radius:6px"></div></div><span class="muted" style="font-size:12px">목표 ${cfg.weekKm}km 중 ${pct}%</span></a>
      <a class="stat" href="${next ? `#/race/${next.id}` : '#/race/new'}" style="text-decoration:none;color:inherit"><span class="muted">🏁 다음 대회</span><b>${next ? ddayStr(dday(next.date)) : '-'}</b><span class="muted" style="font-size:12px">${next ? esc(next.name) : '대회 추가'}</span></a>
      <a class="stat" href="#/tables" style="text-decoration:none;color:inherit"><span class="muted">🫁 스태틱 최고</span><b>${sta ? hms(sta) : '-'}</b><span class="muted" style="font-size:12px">테이블 훈련</span></a>
      <a class="stat" href="${last ? `#/dive/${last.id}` : '#/dive/new'}" style="text-decoration:none;color:inherit"><span class="muted">🤿 마지막 다이브</span><b>${last ? `${maxDepth(last) || '-'}m` : '-'}</b><span class="muted" style="font-size:12px">${last ? `${esc(fmtDate(last.date))} ${esc(last.place || '')}` : '로그 추가'}</span></a>
    </div>
    <div class="card"><div class="row spread"><h2 style="margin:0">📅 오늘의 훈련</h2><span class="muted">${esc(fmtDate(today))}</span></div>
      <div style="margin-top:8px">${[
        ...todayRuns.map((r) => `<a class="item" href="#/run/${r.id}" style="padding:9px 12px">🏃 ${esc(r.kind)} ${(+r.km).toFixed(2)}km · ${hms(r.sec)} · ${paceStr(r.sec, r.km)}/km</a>`),
        ...todayTables.map((t) => `<div class="item" style="padding:9px 12px">🫁 ${esc(t.tableName)} ${t.rounds.filter((x) => x.done).length}/${t.rounds.length} 라운드</div>`),
        ...todayDives.map((d) => `<a class="item" href="#/dive/${d.id}" style="padding:9px 12px">🤿 ${esc(d.place || '')} ${d.dives.length}회 · 최대 ${maxDepth(d)}m</a>`),
      ].join('') || '<div class="muted">아직 기록이 없습니다.</div>'}</div>
      <div class="grid2" style="margin-top:8px;grid-template-columns:repeat(3,1fr)"><a class="btn small" href="#/run/new">+ 러닝</a><a class="btn small" href="#/tables">+ 숨참기</a><a class="btn small" href="#/dive/new">+ 다이브</a></div></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">🙂 오늘 컨디션</h2><span class="badge">2차 예정</span></div>
      <div class="muted" style="margin-top:6px">수면·피로·근육통으로 '가볍게 / 계획대로 / 휴식'을 참고 표시하는 기능은 다음 단계에서 넣습니다. (훈련 참고용이며 건강 진단이 아닙니다)</div></div>
    <div class="card"><h2>🏃 러닝</h2><div class="tiles">
      <a class="tile" href="#/runs"><i>📋</i>기록·통계</a><a class="tile" href="#/pace"><i>⏱</i>페이스 계산기</a><a class="tile" href="#/shoes"><i>👟</i>러닝화</a>
      <a class="tile" href="#/races"><i>🏁</i>대회</a><a class="tile" href="#/sportcal"><i>🗓</i>훈련 달력</a><a class="tile" href="#/sportset"><i>⚙️</i>목표·설정</a></div></div>
    <div class="card"><h2>🤿 프리다이빙</h2><div class="tiles">
      <a class="tile" href="#/tables"><i>🫁</i>숨참기 테이블</a><a class="tile" href="#/dives"><i>📘</i>다이브 로그</a><a class="tile" href="#/sportcal"><i>📈</i>기록 추이</a></div></div>`;
}

function sportAlerts(items, cfg) {
  const out = [], today = todayStr(), tmr = addD(today, 1);
  items.filter((x) => x.type === 'race' && x.regOpen).forEach((r) => {
    if (r.regOpen === tmr) out.push({ icon: '📝', text: `내일 접수 시작: ${r.name}`, href: `#/race/${r.id}` });
    if (r.regOpen === today) out.push({ icon: '📝', text: `오늘 접수 시작: ${r.name}`, href: `#/race/${r.id}` });
  });
  items.filter((x) => x.type === 'race' && x.date >= today && dday(x.date) <= 7).forEach((r) => out.push({ icon: '🏁', text: `${ddayStr(dday(r.date))} ${r.name}`, href: `#/race/${r.id}` }));
  const runs = items.filter((x) => x.type === 'run');
  items.filter((x) => x.type === 'shoe' && !x.retired).forEach((s) => {
    const km = shoeKm(s, runs), lim = +s.limitKm || cfg.shoeLimit;
    if (km >= lim * 0.9) out.push({ icon: '👟', text: `${s.name} ${Math.round(km)}km — 교체 기준(${lim}km) ${km >= lim ? '넘음' : '가까움'}`, href: `#/shoe/${s.id}` });
  });
  return out;
}

/* ───────── 러닝 기록 ───────── */
async function viewRun(id) {
  const [r0, items] = await Promise.all([id ? SP.get(id) : null, SP.all()]);
  const shoes = items.filter((x) => x.type === 'shoe' && !x.retired);
  const lastShoe = items.filter((x) => x.type === 'run' && x.shoeId).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const r = r0 || { date: todayStr(), kind: '조깅', rpe: 5, shoeId: lastShoe ? lastShoe.shoeId : (shoes[0] || {}).id };
  setTitle(r0 ? '러닝 기록' : '러닝 기록 추가', true);
  view().innerHTML = `<form class="card" id="rf" autocomplete="off">
    <div class="grid2"><div><label for="r_date">날짜</label><input id="r_date" type="date" value="${esc(r.date)}"></div>
      <div><label for="r_kind">강도</label><select id="r_kind">${opts(RUN_KINDS, r.kind)}</select></div></div>
    <div class="grid2"><div><label for="r_km">거리(km)</label><input id="r_km" type="number" inputmode="decimal" step="0.01" value="${esc(r.km)}"></div>
      <div><label for="r_time">시간 (시:분:초)</label><input id="r_time" inputmode="numeric" placeholder="0:52:30" value="${r.sec ? hms(r.sec, true) : ''}"></div></div>
    <div class="card" style="margin:10px 0 0;background:var(--bg);text-align:center"><span class="muted">평균 페이스</span> <b id="r_pace" style="font-size:22px">-</b> <span class="muted">/km</span></div>
    <div class="grid2"><div><label for="r_hr">평균 심박(선택)</label><input id="r_hr" type="number" inputmode="numeric" value="${esc(r.hr)}"></div>
      <div><label for="r_rpe">힘든 정도 <b id="r_rpev">${esc(r.rpe)}</b>/10</label><input id="r_rpe" type="range" min="1" max="10" value="${esc(r.rpe)}" style="padding:0"></div></div>
    <label for="r_shoe">신발</label><select id="r_shoe"><option value="">선택 안 함</option>${shoes.map((s) => `<option value="${s.id}"${s.id === r.shoeId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <label for="r_memo">메모</label><textarea id="r_memo" rows="2">${esc(r.memo)}</textarea>
    <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button></form>
    ${r0 ? '<button class="btn danger block" id="r_del" type="button">기록 삭제</button>' : ''}`;
  const upd = () => { $('#r_pace').textContent = paceStr(toSec($('#r_time').value), +$('#r_km').value); $('#r_rpev').textContent = $('#r_rpe').value; };
  $('#rf').oninput = upd; upd();
  $('#rf').onsubmit = async (e) => {
    e.preventDefault();
    const km = +$('#r_km').value, sec = toSec($('#r_time').value);
    if (!km || !sec) { toast('거리와 시간을 넣어 주세요'); return; }
    await SP.put({ ...(r0 || { id: uid(), type: 'run', createdAt: nowISO() }), date: $('#r_date').value, kind: $('#r_kind').value, km, sec, hr: $('#r_hr').value, rpe: +$('#r_rpe').value, shoeId: $('#r_shoe').value, memo: $('#r_memo').value.trim(), updatedAt: nowISO() });
    toast('저장했습니다'); location.replace('#/sport');
  };
  if (r0) $('#r_del').onclick = async () => { if (confirm('이 기록을 지울까요?')) { await SP.del(r0.id); location.replace('#/runs'); } };
}

async function viewRuns() {
  setTitle('러닝 기록·통계', true);
  const items = await SP.all();
  const runs = items.filter((x) => x.type === 'run').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  // 최근 8주 주간 거리
  const weeks = [...Array(8)].map((_, i) => addD(weekStart(), -7 * (7 - i)));
  const wk = weeks.map((w) => runs.filter((r) => r.date >= w && r.date < addD(w, 7)).reduce((a, r) => a + (+r.km || 0), 0));
  const mx = Math.max(1, ...wk);
  const month = monthStr();
  const mKm = runs.filter((r) => (r.date || '').startsWith(month)).reduce((a, r) => a + (+r.km || 0), 0);
  // 페이스 추이(최근 10개)
  const recent = runs.slice(0, 10).reverse();
  const pb = racePBs(items);
  view().innerHTML = `
    <a class="btn primary block" href="#/run/new">+ 러닝 기록</a>
    <div class="card" style="margin-top:12px"><div class="row spread"><h2 style="margin:0">주간 거리 (8주)</h2><span class="muted">이번 달 ${mKm.toFixed(1)}km</span></div>
      <div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-top:10px">${wk.map((v, i) => `<div style="flex:1;text-align:center"><div style="background:${i === 7 ? 'var(--blue)' : 'var(--line)'};height:${Math.round((v / mx) * 90)}px;border-radius:4px 4px 0 0"></div><div class="muted" style="font-size:11px">${v.toFixed(0)}</div><div class="muted" style="font-size:10px">${weeks[i].slice(5).replace('-', '/')}</div></div>`).join('')}</div></div>
    <div class="card"><h2>페이스 추이 (최근 10회, 낮을수록 빠름)</h2>${recent.length ? `<div style="display:flex;align-items:flex-end;gap:4px;height:90px">${(() => { const ps = recent.map((r) => r.sec / r.km), hi = Math.max(...ps), lo = Math.min(...ps); return ps.map((p, i) => `<div style="flex:1;text-align:center" title="${hms(p)}"><div style="background:var(--gold);height:${Math.round(20 + ((hi - p) / (hi - lo || 1)) * 60)}px;border-radius:4px 4px 0 0"></div><div class="muted" style="font-size:10px">${hms(p)}</div></div>`).join(''); })()}</div>` : '<div class="muted">기록이 없습니다.</div>'}</div>
    <div class="card"><h2>🏆 개인 최고기록(대회)</h2>${Object.keys(RACE_DIST).map((d) => `<div class="row spread"><span>${d}</span><b>${pb[d] ? `${hms(pb[d].resultSec, true)} <span class="muted">${esc(pb[d].name)}</span>` : '-'}</b></div>`).join('')}</div>
    <h2 style="font-size:16px">기록</h2>
    ${runs.map((r) => `<a class="item" href="#/run/${r.id}"><div class="row spread"><span class="t">${esc(fmtDate(r.date))} · ${esc(r.kind)}</span><b>${(+r.km).toFixed(2)}km</b></div><div class="muted">${hms(r.sec, true)} · ${paceStr(r.sec, r.km)}/km${r.hr ? ` · 심박 ${esc(r.hr)}` : ''} · 힘듦 ${esc(r.rpe)}/10</div></a>`).join('') || '<div class="empty">러닝 기록이 없습니다.</div>'}`;
}

/* ───────── 페이스 계산기 ───────── */
async function viewPace() {
  setTitle('페이스 계산기', true);
  const items = await SP.all();
  const runs = items.filter((x) => x.type === 'run' && x.km >= 3 && x.sec).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  // 예상 기록: 최근 8주 중 가장 빠른 페이스 기록(3km 이상)으로 리겔 공식 T2 = T1 × (D2/D1)^1.06
  const since = addD(todayStr(), -56);
  const base = runs.filter((r) => r.date >= since).sort((a, b) => a.sec / a.km - b.sec / b.km)[0];
  view().innerHTML = `
    <div class="card">
      <label for="p_dist">거리</label><select id="p_dist">${opts([...Object.keys(RACE_DIST), '직접 입력'], '하프')}</select>
      <div id="p_customBox" hidden><label for="p_km">거리(km)</label><input id="p_km" type="number" inputmode="decimal" step="0.1" value="15"></div>
      <div class="grid2"><div><label for="p_time">목표 기록 (시:분:초)</label><input id="p_time" inputmode="numeric" placeholder="1:59:00"></div>
        <div><label for="p_pace">km당 페이스 (분:초)</label><input id="p_pace" inputmode="numeric" placeholder="5:38"></div></div>
      <div class="muted" style="margin-top:6px">한쪽만 넣으면 다른 쪽이 자동으로 계산됩니다.</div>
    </div>
    <div class="card"><h2>구간 스플릿 (5km 단위)</h2><div id="p_split" class="muted">기록이나 페이스를 넣으세요.</div>
      <button class="btn block" id="p_band" type="button" style="margin-top:8px">🖼 페이스밴드 이미지 저장</button></div>
    <div class="card"><h2>최근 기록으로 예상</h2>${base ? `<div class="muted">기준: ${esc(fmtDate(base.date))} ${(+base.km).toFixed(2)}km ${hms(base.sec, true)} (${paceStr(base.sec, base.km)}/km)</div>
      ${Object.entries(RACE_DIST).map(([n, d]) => { const t = base.sec * Math.pow(d / base.km, 1.06); return `<div class="row spread"><span>${n}</span><b>${hms(t, true)} <span class="muted">${hms(t / d)}/km</span></b></div>`; }).join('')}
      <div class="muted" style="font-size:12px;margin-top:6px">리겔 공식으로 계산한 참고 값입니다. 긴 거리일수록 실제와 차이가 큽니다.</div>` : '<div class="muted">최근 8주 안에 3km 이상 러닝 기록이 있으면 다른 거리 예상 기록을 보여 줍니다.</div>'}</div>`;
  const dist = () => ($('#p_dist').value === '직접 입력' ? +$('#p_km').value : RACE_DIST[$('#p_dist').value]) || 0;
  let lastEdit = 'time', exactPace = 0;
  const calc = () => {
    $('#p_customBox').hidden = $('#p_dist').value !== '직접 입력';
    const d = dist();
    // 기록을 넣었으면 정확한 페이스(소수점)로 스플릿을 계산해 결승 시간이 목표와 맞게 한다
    let p;
    if (lastEdit === 'time') { const t = toSec($('#p_time').value); p = t && d ? t / d : 0; $('#p_pace').value = p ? hms(p) : ''; }
    else { p = toSec($('#p_pace').value); $('#p_time').value = p && d ? hms(p * d, true) : ''; }
    exactPace = p;
    if (!p || !d) { $('#p_split').textContent = '기록이나 페이스를 넣으세요.'; return; }
    const marks = []; for (let k = 5; k < d; k += 5) marks.push(k); marks.push(d);
    $('#p_split').innerHTML = `<table><thead><tr><th>지점</th><th class="r">누적 시간</th></tr></thead><tbody>${marks.map((k) => `<tr><td>${k === d ? '결승 ' + (+d.toFixed(3)) : k}km</td><td class="r"><b style="color:var(--ink)">${hms(p * k, true)}</b></td></tr>`).join('')}</tbody></table>`;
  };
  $('#p_time').oninput = () => { lastEdit = 'time'; calc(); };
  $('#p_pace').oninput = () => { lastEdit = 'pace'; calc(); };
  $('#p_dist').onchange = calc; $('#p_km').oninput = calc;
  $('#p_band').onclick = async () => {
    const p = exactPace, d = dist();
    if (!p || !d) { toast('먼저 기록이나 페이스를 넣으세요'); return; }
    const marks = []; for (let k = 5; k < d; k += 5) marks.push(k); marks.push(d);
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 300 + marks.length * 110;
    const g = cv.getContext('2d'); const F = '"Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    g.fillStyle = '#0B1F4B'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#F5C442'; g.font = `bold 56px ${F}`; g.fillText(`${$('#p_dist').value} 목표 ${hms(p * d, true)}`, 60, 110);
    g.fillStyle = '#C9D6F5'; g.font = `40px ${F}`; g.fillText(`페이스 ${hms(p)}/km`, 60, 180);
    marks.forEach((k, i) => {
      const y = 280 + i * 110;
      g.fillStyle = i % 2 ? '#13295e' : '#18326f'; g.fillRect(40, y - 70, 1000, 100);
      g.fillStyle = '#fff'; g.font = `bold 52px ${F}`; g.fillText(`${k === d ? '결승' : k + 'km'}`, 70, y);
      g.textAlign = 'right'; g.fillText(hms(p * k, true), 1010, y); g.textAlign = 'left';
    });
    cv.toBlob(async (b) => {
      const f = new File([b], `페이스밴드-${$('#p_dist').value}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); return; } catch { /* 취소 */ } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    }, 'image/png');
  };
}

/* ───────── 러닝화 ───────── */
async function viewShoes() {
  setTitle('러닝화', true);
  const [items, cfg] = await Promise.all([SP.all(), spCfg()]);
  const runs = items.filter((x) => x.type === 'run');
  const shoes = items.filter((x) => x.type === 'shoe').sort((a, b) => (a.retired - b.retired) || (b.bought || '').localeCompare(a.bought || ''));
  view().innerHTML = `<a class="btn primary block" href="#/shoe/new">+ 러닝화 추가</a><div style="margin-top:12px">${shoes.map((s) => {
    const km = shoeKm(s, runs), lim = +s.limitKm || cfg.shoeLimit, p = Math.min(100, Math.round((km / lim) * 100));
    return `<a class="item" href="#/shoe/${s.id}" style="${s.retired ? 'opacity:.55' : ''}"><div class="row spread"><span class="t">👟 ${esc(s.name)} <span class="badge">${esc(s.use || '훈련')}</span>${s.retired ? ' <span class="badge">은퇴</span>' : ''}</span><b>${Math.round(km)} / ${lim}km</b></div>
      <div style="background:var(--bg);border-radius:6px;height:10px;margin-top:6px"><div style="width:${p}%;background:${p >= 90 ? 'var(--red)' : 'var(--green)'};height:100%;border-radius:6px"></div></div>
      <div class="muted" style="font-size:12px">${s.bought ? '구매 ' + esc(s.bought) : ''}</div></a>`;
  }).join('') || '<div class="empty">등록된 러닝화가 없습니다.</div>'}</div>`;
}
async function viewShoe(id) {
  const [s0, cfg] = await Promise.all([id ? SP.get(id) : null, spCfg()]);
  const s = s0 || { use: '훈련', limitKm: cfg.shoeLimit, startKm: 0, bought: todayStr() };
  setTitle(s0 ? '러닝화' : '러닝화 추가', true);
  view().innerHTML = `<form class="card" id="sf" autocomplete="off">
    <label for="s_name">이름</label><input id="s_name" value="${esc(s.name)}" placeholder="예: 페가수스 41">
    <div class="grid2"><div><label for="s_use">용도</label><select id="s_use">${opts(['훈련', '레이스'], s.use)}</select></div>
      <div><label for="s_bought">구매일</label><input id="s_bought" type="date" value="${esc(s.bought)}"></div></div>
    <div class="grid2"><div><label for="s_lim">교체 기준(km)</label><input id="s_lim" type="number" inputmode="numeric" value="${esc(s.limitKm)}"></div>
      <div><label for="s_start">이미 탄 거리(km)</label><input id="s_start" type="number" inputmode="decimal" value="${esc(s.startKm)}"></div></div>
    <label class="row" style="margin-top:10px;color:var(--ink);font-size:15px"><input type="checkbox" id="s_ret" ${s.retired ? 'checked' : ''} style="width:22px;min-height:22px;flex:none"> 은퇴(더 안 신음)</label>
    <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button></form>
    ${s0 ? '<button class="btn danger block" id="s_del" type="button">삭제</button>' : ''}`;
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    if (!$('#s_name').value.trim()) { toast('이름을 넣어 주세요'); return; }
    await SP.put({ ...(s0 || { id: uid(), type: 'shoe', createdAt: nowISO() }), name: $('#s_name').value.trim(), use: $('#s_use').value, bought: $('#s_bought').value, limitKm: +$('#s_lim').value || cfg.shoeLimit, startKm: +$('#s_start').value || 0, retired: $('#s_ret').checked });
    location.replace('#/shoes');
  };
  if (s0) $('#s_del').onclick = async () => { if (confirm('러닝화를 지울까요? (러닝 기록은 남습니다)')) { await SP.del(s0.id); location.replace('#/shoes'); } };
}

/* ───────── 대회 ───────── */
async function viewRaces() {
  setTitle('대회', true);
  const items = await SP.all();
  const today = todayStr();
  const races = items.filter((x) => x.type === 'race');
  const up = races.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = races.filter((r) => r.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const pb = racePBs(items);
  const isPB = (r) => r.resultSec && pb[r.dist] && pb[r.dist].id === r.id;
  const line = (r) => `<a class="item" href="#/race/${r.id}"><div class="row spread"><span class="t">${esc(r.name)} <span class="badge">${esc(r.dist || '')}</span>${isPB(r) ? ' <span class="badge" style="color:var(--gold)">🏆 PB</span>' : ''}</span><b>${r.date >= today ? ddayStr(dday(r.date)) : r.resultSec ? hms(r.resultSec, true) : esc(r.status || '')}</b></div>
    <div class="muted">${esc(fmtDate(r.date))}${r.regOpen ? ` · 접수 시작 ${esc(fmtDate(r.regOpen))}` : ''} · ${esc(r.status || '관심')}</div></a>`;
  view().innerHTML = `<a class="btn primary block" href="#/race/new">+ 대회 추가</a>
    <h2 style="font-size:16px;margin-top:14px">다가오는 대회</h2>${up.map(line).join('') || '<div class="muted">없음</div>'}
    <h2 style="font-size:16px;margin-top:14px">지난 대회</h2>${past.map(line).join('') || '<div class="muted">없음</div>'}
    <div class="muted" style="margin-top:10px">접수 시작 전날과 당일, 대회 7일 전부터 운동노트와 ONE LIFE 홈 알림에 표시됩니다. (앱을 열었을 때 보이는 알림이며, 휴대폰 푸시 알림은 아닙니다)</div>`;
}
async function viewRace(id) {
  const r0 = id ? await SP.get(id) : null;
  const r = r0 || { dist: '하프', status: '관심' };
  setTitle(r0 ? r0.name : '대회 추가', true);
  view().innerHTML = `<form class="card" id="rcf" autocomplete="off">
    <label for="rc_name">대회 이름</label><input id="rc_name" value="${esc(r.name)}">
    <div class="grid2"><div><label for="rc_date">대회 날짜</label><input id="rc_date" type="date" value="${esc(r.date)}"></div>
      <div><label for="rc_reg">접수 시작일</label><input id="rc_reg" type="date" value="${esc(r.regOpen)}"></div></div>
    <div class="grid2"><div><label for="rc_dist">거리</label><select id="rc_dist">${opts(Object.keys(RACE_DIST), r.dist)}</select></div>
      <div><label for="rc_status">상태</label><select id="rc_status">${opts(['관심', '접수함', '완주', '불참'], r.status)}</select></div></div>
    <label for="rc_link">링크</label><input id="rc_link" type="url" value="${esc(r.link)}">
    <label for="rc_goal">목표 기록 (시:분:초)</label><input id="rc_goal" inputmode="numeric" value="${r.goalSec ? hms(r.goalSec, true) : ''}">
    <label for="rc_strat">레이스 전략(구간별 목표 페이스)</label><textarea id="rc_strat" rows="4" placeholder="예: 0~10km 5:45 / 10~18km 5:35 / 18km~ 남은 힘">${esc(r.strategy)}</textarea>
    <button class="btn small" id="rc_auto" type="button" style="margin-top:6px">목표 기록으로 5km 구간표 넣기</button>
    <label for="rc_res">결과 기록 (완주 후)</label><input id="rc_res" inputmode="numeric" value="${r.resultSec ? hms(r.resultSec, true) : ''}">
    <label for="rc_memo">메모</label><textarea id="rc_memo" rows="2">${esc(r.memo)}</textarea>
    <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button></form>
    ${r.link ? `<a class="btn block" href="${esc(r.link)}" target="_blank" rel="noopener">↗ 대회 페이지</a>` : ''}
    ${r0 ? '<button class="btn danger block" id="rc_del" type="button" style="margin-top:8px">삭제</button>' : ''}`;
  $('#rc_auto').onclick = () => {
    const t = toSec($('#rc_goal').value), d = RACE_DIST[$('#rc_dist').value];
    if (!t) { toast('목표 기록을 먼저 넣으세요'); return; }
    const p = t / d, marks = []; for (let k = 5; k < d; k += 5) marks.push(k); marks.push(d);
    $('#rc_strat').value = `목표 페이스 ${hms(p)}/km\n` + marks.map((k) => `${k === d ? '결승' : k + 'km'} ${hms(p * k, true)}`).join('\n');
  };
  $('#rcf').onsubmit = async (e) => {
    e.preventDefault();
    if (!$('#rc_name').value.trim() || !$('#rc_date').value) { toast('이름과 날짜를 넣어 주세요'); return; }
    const res = toSec($('#rc_res').value);
    await SP.put({ ...(r0 || { id: uid(), type: 'race', createdAt: nowISO() }), name: $('#rc_name').value.trim(), date: $('#rc_date').value, regOpen: $('#rc_reg').value, dist: $('#rc_dist').value, status: res ? '완주' : $('#rc_status').value, link: $('#rc_link').value.trim(), goalSec: toSec($('#rc_goal').value), strategy: $('#rc_strat').value, resultSec: res, memo: $('#rc_memo').value.trim() });
    toast(res ? '결과를 저장했습니다' : '저장했습니다'); location.replace('#/races');
  };
  if (r0) $('#rc_del').onclick = async () => { if (confirm('이 대회를 지울까요?')) { await SP.del(r0.id); location.replace('#/races'); } };
}

/* ───────── 숨참기 테이블 ───────── */
function makeTable(kind, pbSec, rounds = 8) {
  pbSec = pbSec || 120;
  const r5 = (x) => Math.max(5, Math.round(x / 5) * 5);
  if (kind === 'CO2') {
    // 숨참기 고정(최고 기록의 50%), 호흡은 2분부터 라운드마다 15초씩 줄어듦(최소 15초)
    const hold = r5(pbSec * 0.5);
    return [...Array(rounds)].map((_, i) => ({ breathe: Math.max(15, 120 - 15 * i), hold }));
  }
  // O2: 호흡 2분 고정, 숨참기는 최고 기록의 40%에서 80%까지 늘어남
  return [...Array(rounds)].map((_, i) => ({ breathe: 120, hold: r5(pbSec * (0.4 + (0.4 * i) / Math.max(1, rounds - 1))) }));
}

async function viewTables() {
  setTitle('숨참기 테이블', true);
  const [items, cfg] = await Promise.all([SP.all(), spCfg()]);
  const tables = items.filter((x) => x.type === 'table');
  const runs = items.filter((x) => x.type === 'tablerun').sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10);
  const pb = bestStatic(items, cfg);
  view().innerHTML = `
    <div class="card warnbox"><b>⚠️ 안전</b><div class="muted" style="margin-top:4px">${esc(SAFETY_TEXT)}</div></div>
    <div class="card"><h2>새 테이블 만들기</h2>
      <div class="grid2"><div><label for="t_kind">종류</label><select id="t_kind">${opts(['CO2', 'O2'])}</select></div>
        <div><label for="t_rounds">라운드 수</label><input id="t_rounds" type="number" inputmode="numeric" min="2" max="12" value="8"></div></div>
      <label for="t_pb">내 스태틱 최고 기록 (분:초)</label><input id="t_pb" inputmode="numeric" value="${pb ? hms(pb) : ''}" placeholder="예: 3:00">
      <div class="muted" style="margin-top:6px">CO2: 숨참기 고정(최고 기록의 50%), 호흡이 2분부터 15초씩 줄어듭니다.<br>O2: 호흡 2분 고정, 숨참기가 최고 기록의 40%→80%로 늘어납니다.</div>
      <button class="btn primary block" id="t_make" type="button" style="margin-top:10px">테이블 만들기</button></div>
    <h2 style="font-size:16px">내 테이블</h2>
    ${tables.map((t) => `<div class="item"><div class="row spread"><span class="t">${esc(t.name)}</span><span class="badge">${esc(t.kind)} · ${t.rounds.length}R</span></div>
      <div class="muted" style="font-size:13px">${t.rounds.map((r) => `${hms(r.breathe)}/${hms(r.hold)}`).join(' · ')}</div>
      <div class="row" style="margin-top:6px"><a class="btn small primary" href="#/tablerun/${t.id}">▶ 시작</a><a class="btn small" href="#/table/${t.id}">수정</a></div></div>`).join('') || '<div class="muted">저장한 테이블이 없습니다.</div>'}
    ${runs.length ? `<h2 style="font-size:16px;margin-top:14px">최근 훈련</h2>${runs.map((r) => `<div class="item"><div class="row spread"><span class="t">${esc(r.tableName)}</span><span class="muted">${esc((r.date || '').slice(0, 16).replace('T', ' '))}</span></div>
      <div class="muted" style="font-size:13px">완료 ${r.rounds.filter((x) => x.done).length}/${r.rounds.length} · 수축 시작 ${r.rounds.map((x) => (x.contraction ? hms(x.contraction) : '-')).join(', ')}</div></div>`).join('')}` : ''}`;
  $('#t_make').onclick = async () => {
    const pbs = toSec($('#t_pb').value);
    if (!pbs) { toast('최고 기록을 넣어 주세요'); return; }
    if (!cfg.staticPB || pbs > cfg.staticPB) await setSetting('sport', { ...cfg, staticPB: pbs });
    const kind = $('#t_kind').value, n = Math.min(12, Math.max(2, +$('#t_rounds').value || 8));
    const t = { id: uid(), type: 'table', kind, name: `${kind} 테이블 (최고 ${hms(pbs)})`, rounds: makeTable(kind, pbs, n), createdAt: nowISO() };
    await SP.put(t); location.hash = `#/table/${t.id}`;
  };
}

async function viewTable(id) {
  const t = await SP.get(id);
  if (!t) { setTitle('테이블', true); view().innerHTML = '<div class="empty">테이블을 찾을 수 없습니다.</div>'; return; }
  setTitle('테이블 수정', true);
  const draw = () => {
    view().innerHTML = `<div class="card"><label for="tb_name">이름</label><input id="tb_name" value="${esc(t.name)}">
      <table style="margin-top:10px"><thead><tr><th>R</th><th>호흡 (분:초)</th><th>숨참기 (분:초)</th><th></th></tr></thead><tbody>
      ${t.rounds.map((r, i) => `<tr><td>${i + 1}</td><td><input data-b="${i}" value="${hms(r.breathe)}" inputmode="numeric" style="min-height:36px;padding:4px 8px"></td><td><input data-h="${i}" value="${hms(r.hold)}" inputmode="numeric" style="min-height:36px;padding:4px 8px"></td><td><button class="btn small danger" data-x="${i}" type="button">✕</button></td></tr>`).join('')}
      </tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn small" id="tb_add" type="button">+ 라운드</button></div>
      <div class="muted" style="margin-top:6px">총 ${hms(t.rounds.reduce((a, r) => a + r.breathe + r.hold, 0), true)}</div></div>
      <div class="row"><button class="btn primary block" id="tb_save" type="button">💾 내 테이블로 저장</button><a class="btn block" href="#/tablerun/${t.id}">▶ 시작</a></div>
      <button class="btn danger block" id="tb_del" type="button" style="margin-top:8px">테이블 삭제</button>`;
    const read = () => { t.name = $('#tb_name').value.trim() || t.name; t.rounds = t.rounds.map((r, i) => ({ breathe: toSec(view().querySelector(`[data-b="${i}"]`).value) || r.breathe, hold: toSec(view().querySelector(`[data-h="${i}"]`).value) || r.hold })); };
    view().querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { read(); t.rounds.splice(+b.dataset.x, 1); draw(); }; });
    $('#tb_add').onclick = () => { read(); const l = t.rounds[t.rounds.length - 1] || { breathe: 120, hold: 60 }; t.rounds.push({ ...l }); draw(); };
    $('#tb_save').onclick = async () => { read(); await SP.put(t); toast('저장했습니다'); };
    $('#tb_del').onclick = async () => { if (confirm('테이블을 지울까요?')) { await SP.del(t.id); location.replace('#/tables'); } };
  };
  draw();
}

/* 테이블 실행: 안전 확인 → 원형 타이머(호흡/숨참기), 음성·진동, 수축 시작 탭, 화면 켜짐 유지 */
async function viewTableRun(id) {
  const t = await SP.get(id);
  if (!t) { setTitle('테이블', true); view().innerHTML = '<div class="empty">테이블을 찾을 수 없습니다.</div>'; return; }
  setTitle(t.name, true);
  view().innerHTML = `
    <div class="card warnbox" id="safe">
      <h2>⚠️ 시작 전 안전 확인 (필수)</h2>
      <ul style="padding-left:18px;margin:8px 0;line-height:1.7">
        <li><b>물 밖 드라이 트레이닝 전용</b>입니다.</li>
        <li><b>누운 자세</b>로 하세요.</li>
        <li><b>물속·욕조에서 절대 사용 금지.</b></li>
        <li>물에서는 <b>반드시 버디와</b> 함께 하세요.</li>
        <li>어지러움·저림·시야 이상이 느껴지면 <b>즉시 중단</b>하세요.</li>
      </ul>
      <label class="row" style="color:var(--ink);font-size:15px"><input type="checkbox" id="safeOk" style="width:24px;min-height:24px;flex:none"> 위 내용을 확인했고, 물 밖에서 누운 자세로 하겠습니다.</label>
      <button class="btn primary block" id="go" type="button" disabled style="margin-top:12px">확인하고 시작</button>
    </div>`;
  $('#safeOk').onchange = (e) => { $('#go').disabled = !e.target.checked; };
  $('#go').onclick = () => runTable(t);
}

async function runTable(t) {
  const res = t.rounds.map((r) => ({ breathe: r.breathe, hold: r.hold, done: false, contraction: 0 }));
  let round = 0, phase = 'breathe', phaseStart = performance.now(), paused = false, stopped = false, lastSpoken = -1, wake = null;
  try { wake = await navigator.wakeLock.request('screen'); } catch { /* 지원 안 하면 무시 */ }
  view().innerHTML = `
    <div style="text-align:center">
      <div class="muted" id="tr_round" style="font-size:18px"></div>
      <div style="position:relative;width:280px;height:280px;margin:14px auto">
        <svg viewBox="0 0 100 100" width="280" height="280" style="transform:rotate(-90deg)"><circle cx="50" cy="50" r="45" fill="none" stroke="var(--line)" stroke-width="7"/><circle id="tr_arc" cx="50" cy="50" r="45" fill="none" stroke="var(--blue)" stroke-width="7" stroke-linecap="round" stroke-dasharray="282.7" stroke-dashoffset="0"/></svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div id="tr_phase" style="font-size:22px;font-weight:800"></div><div id="tr_left" style="font-size:56px;font-weight:800;font-variant-numeric:tabular-nums"></div></div>
      </div>
      <button class="btn block" id="tr_con" type="button" style="min-height:64px;font-size:18px">👆 수축 시작 (탭)</button>
      <div class="row" style="margin-top:10px"><button class="btn block" id="tr_pause" type="button">⏸ 일시정지</button><button class="btn danger block" id="tr_stop" type="button">■ 중단</button></div>
      <div class="muted" id="tr_info" style="margin-top:10px"></div>
    </div>`;
  const total = () => (phase === 'breathe' ? res[round].breathe : res[round].hold);
  function render2() {
    if (stopped) return;
    const el = paused ? 0 : (performance.now() - phaseStart) / 1000;
    const left = Math.max(0, total() - el);
    $('#tr_round').textContent = `라운드 ${round + 1} / ${res.length}`;
    $('#tr_phase').textContent = phase === 'breathe' ? '🌬 호흡' : '🫁 숨참기';
    $('#tr_phase').style.color = phase === 'breathe' ? 'var(--green)' : 'var(--blue)';
    $('#tr_arc').style.stroke = phase === 'breathe' ? 'var(--green)' : 'var(--blue)';
    $('#tr_left').textContent = hms(Math.ceil(left));
    $('#tr_arc').setAttribute('stroke-dashoffset', String(282.7 * (1 - left / total())));
    $('#tr_con').disabled = phase !== 'hold' || res[round].contraction > 0;
    $('#tr_info').textContent = res[round].contraction ? `이번 라운드 수축 시작 ${hms(res[round].contraction)}` : '';
    const s = Math.ceil(left);
    if (s !== lastSpoken) {
      if (s === 10) speak('10초');
      else if (s <= 5 && s >= 1) speak(String(s));
      lastSpoken = s;
    }
    if (left <= 0) next();
  }
  function next() {
    buzz([200, 100, 200]);
    if (phase === 'breathe') { phase = 'hold'; speak('숨참기 시작'); }
    else {
      res[round].done = true;
      if (round + 1 >= res.length) return finish(true);
      round++; phase = 'breathe'; speak('호흡');
    }
    phaseStart = performance.now(); lastSpoken = -1;
  }
  let pausedAt = 0;
  $('#tr_pause').onclick = () => {
    if (!paused) { paused = true; pausedAt = performance.now(); $('#tr_pause').textContent = '▶ 계속'; }
    else { paused = false; phaseStart += performance.now() - pausedAt; $('#tr_pause').textContent = '⏸ 일시정지'; }
  };
  $('#tr_con').onclick = () => { if (phase === 'hold' && !paused) { res[round].contraction = Math.round((performance.now() - phaseStart) / 1000); buzz(80); } };
  $('#tr_stop').onclick = () => { if (confirm('중단하고 지금까지 결과를 저장할까요?')) finish(false); };
  const timer = setInterval(() => { if (!paused) render2(); }, 200);
  render2();
  speak('호흡 시작');
  window.addEventListener('hashchange', () => { if (!stopped) { stopped = true; clearInterval(timer); try { wake && wake.release(); } catch { /* 무시 */ } } }, { once: true });
  async function finish(complete) {
    stopped = true; clearInterval(timer);
    try { wake && wake.release(); } catch { /* 무시 */ }
    speak(complete ? '완료' : '중단');
    const rec = { id: uid(), type: 'tablerun', tableId: t.id, tableName: t.name, kind: t.kind, date: nowISO(), complete, rounds: res };
    await SP.put(rec);
    view().innerHTML = `<div class="card"><h2>${complete ? '✅ 완료' : '■ 중단'} — ${esc(t.name)}</h2>
      <table><thead><tr><th>R</th><th>호흡</th><th>숨참기</th><th>수축 시작</th></tr></thead><tbody>
      ${res.map((r, i) => `<tr><td>${i + 1}</td><td>${hms(r.breathe)}</td><td>${r.done ? '✔ ' : ''}${hms(r.hold)}</td><td>${r.contraction ? hms(r.contraction) : '-'}</td></tr>`).join('')}</tbody></table>
      <div class="muted" style="margin-top:8px">수축이 시작되는 시점이 늦어질수록 CO2 내성이 좋아지는 경향이 있습니다(참고).</div></div>
      <a class="btn primary block" href="#/tables">테이블 목록</a>`;
  }
}

/* ───────── 다이브 로그 ───────── */
async function viewDives() {
  setTitle('다이브 로그', true);
  const items = await SP.all();
  const ss = items.filter((x) => x.type === 'dive').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const maxD = (s) => Math.max(0, ...(s.dives || []).map((d) => +d.depth || 0));
  const allDepth = Math.max(0, ...ss.map(maxD));
  view().innerHTML = `<a class="btn primary block" href="#/dive/new">+ 다이빙 세션</a>
    <div class="grid2" style="margin:12px 0"><div class="stat"><span class="muted">세션</span><b>${ss.length}</b></div><div class="stat"><span class="muted">최대 수심</span><b>${allDepth ? allDepth + 'm' : '-'}</b></div></div>
    ${ss.map((s) => `<a class="item" href="#/dive/${s.id}"><div class="row spread"><span class="t">${esc(fmtDate(s.date))} · ${esc(s.place || '장소 미입력')}</span><span class="badge">${esc(s.placeKind || '')}</span></div>
      <div class="muted">${(s.dives || []).length}회 · ${[...new Set((s.dives || []).map((d) => d.disc))].join('/')} · 최대 ${maxD(s)}m${s.buddy ? ' · 버디 ' + esc(s.buddy) : ''}</div></a>`).join('') || '<div class="empty">다이빙 기록이 없습니다.</div>'}`;
}

async function viewDive(id) {
  const [s0, items] = await Promise.all([id ? SP.get(id) : null, SP.all()]);
  const prev = items.filter((x) => x.type === 'dive' && x.id !== id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const s = s0 || { date: todayStr(), placeKind: '바다', gear: {}, dives: [{ disc: 'FIM', depth: '', downtime: '', surface: '', memo: '' }] };
  setTitle(s0 ? '다이빙 세션' : '다이빙 세션 추가', true);
  const places = [...new Set(prev.map((x) => x.place).filter(Boolean))];
  const draw = () => {
    view().innerHTML = `<form class="card" id="dvf" autocomplete="off">
      <div class="grid2"><div><label for="d_date">날짜</label><input id="d_date" type="date" value="${esc(s.date)}"></div>
        <div><label for="d_kind">장소 종류</label><select id="d_kind">${opts(['바다', '수영장'], s.placeKind)}</select></div></div>
      <label for="d_place">장소</label><input id="d_place" list="d_places" value="${esc(s.place)}" placeholder="예: K26, 문섬"><datalist id="d_places">${places.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <button class="btn small" id="d_loadGear" type="button" style="margin-top:6px" hidden>↺ 이 장소의 지난 장비 불러오기</button>
      <div class="grid2"><div><label for="d_temp">수온(℃)</label><input id="d_temp" type="number" inputmode="decimal" value="${esc(s.temp)}"></div>
        <div><label for="d_vis">시야(m)</label><input id="d_vis" type="number" inputmode="decimal" value="${esc(s.vis)}"></div></div>
      <h2 style="margin-top:14px">장비</h2>
      <div class="grid2"><div><label for="g_suit">슈트 두께(mm)</label><input id="g_suit" value="${esc(s.gear.suit)}"></div><div><label for="g_weight">웨이트(kg)</label><input id="g_weight" value="${esc(s.gear.weight)}"></div></div>
      <div class="grid2"><div><label for="g_fin">핀</label><input id="g_fin" value="${esc(s.gear.fin)}"></div><div><label for="g_mask">마스크</label><input id="g_mask" value="${esc(s.gear.mask)}"></div></div>
      <div class="grid2"><div><label for="d_buddy">버디</label><input id="d_buddy" value="${esc(s.buddy)}"></div><div><label for="d_cond">컨디션</label><select id="d_cond">${opts(['좋음', '보통', '나쁨'], s.condition || '보통')}</select></div></div>
      <label for="d_eq">이퀄라이징 메모</label><textarea id="d_eq" rows="2">${esc(s.eqMemo)}</textarea>
      <h2 style="margin-top:14px">다이브 ${s.dives.length}회</h2>
      ${s.dives.map((d, i) => `<div class="card" style="background:var(--bg);margin:8px 0">
        <div class="row spread"><b>#${i + 1}</b><button class="btn small danger" data-rm="${i}" type="button">✕</button></div>
        <div class="grid2"><div><label>종목</label><select data-f="disc" data-i="${i}">${opts(DIVE_DISC, d.disc)}</select></div><div><label>최대 수심(m)</label><input data-f="depth" data-i="${i}" type="number" inputmode="decimal" value="${esc(d.depth)}"></div></div>
        <div class="grid2"><div><label>다운타임(분:초)</label><input data-f="downtime" data-i="${i}" inputmode="numeric" value="${esc(d.downtime)}"></div><div><label>수면 휴식(분:초)</label><input data-f="surface" data-i="${i}" inputmode="numeric" value="${esc(d.surface)}"></div></div>
        <label>메모</label><input data-f="memo" data-i="${i}" value="${esc(d.memo)}"></div>`).join('')}
      <button class="btn block" id="d_add" type="button">+ 다이브 추가</button>
      <label for="d_memo">세션 메모</label><textarea id="d_memo" rows="2">${esc(s.memo)}</textarea>
      <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button></form>
      ${s0 ? '<div class="card"><div class="row spread"><h2 style="margin:0">📷 사진</h2><label class="btn small" style="margin:0;color:var(--ink)">추가<input id="d_ph" type="file" accept="image/*" multiple hidden></label></div><div class="photos" id="d_photos" style="margin-top:8px"></div></div><button class="btn danger block" id="d_del" type="button">세션 삭제</button>' : '<div class="muted">사진은 저장한 뒤 추가할 수 있습니다.</div>'}`;
    const read = () => {
      s.date = $('#d_date').value; s.placeKind = $('#d_kind').value; s.place = $('#d_place').value.trim(); s.temp = $('#d_temp').value; s.vis = $('#d_vis').value;
      s.gear = { suit: $('#g_suit').value, weight: $('#g_weight').value, fin: $('#g_fin').value, mask: $('#g_mask').value };
      s.buddy = $('#d_buddy').value.trim(); s.condition = $('#d_cond').value; s.eqMemo = $('#d_eq').value; s.memo = $('#d_memo').value;
      view().querySelectorAll('[data-f]').forEach((el) => { s.dives[+el.dataset.i][el.dataset.f] = el.value; });
    };
    const checkPlace = () => { const p = prev.find((x) => x.place && x.place === $('#d_place').value.trim()); $('#d_loadGear').hidden = !p; };
    $('#d_place').oninput = checkPlace; checkPlace();
    $('#d_loadGear').onclick = () => { read(); const p = prev.find((x) => x.place === s.place); if (p) { s.gear = { ...p.gear }; s.placeKind = p.placeKind; draw(); toast('지난 장비 설정을 불러왔습니다'); } };
    $('#d_add').onclick = () => { read(); const l = s.dives[s.dives.length - 1] || {}; s.dives.push({ disc: l.disc || 'FIM', depth: '', downtime: '', surface: '', memo: '' }); draw(); };
    view().querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { read(); s.dives.splice(+b.dataset.rm, 1); draw(); }; });
    $('#dvf').onsubmit = async (e) => {
      e.preventDefault(); read();
      if (!s.dives.length) { toast('다이브를 하나 이상 넣어 주세요'); return; }
      const rec = { ...s, id: s.id || uid(), type: 'dive', createdAt: s.createdAt || nowISO(), updatedAt: nowISO() };
      await SP.put(rec); toast('저장했습니다'); location.replace(`#/dive/${rec.id}`);
    };
    if (s0) {
      const urls = [];
      const drawPh = async () => {
        urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
        const ps = await DB.by('photos', 'jobId', s0.id);
        $('#d_photos').innerHTML = ps.map((p) => { const u = URL.createObjectURL(p.blob); urls.push(u); return `<div class="photo"><img src="${u}" alt="다이빙 사진"></div>`; }).join('') || '<div class="muted" style="grid-column:1/-1">사진 없음</div>';
        $('#d_photos').querySelectorAll('.photo').forEach((el, i) => { el.onclick = () => openViewer(ps[i], urls[i], drawPh); });
      };
      $('#d_ph').onchange = async (e) => { for (const f of [...e.target.files]) { try { await DB.put('photos', { id: uid(), jobId: s0.id, kind: '기타', blob: await shrink(f, 1600, 0.82), createdAt: nowISO() }); } catch (er) { toast(er.message); } } e.target.value = ''; drawPh(); };
      drawPh();
      $('#d_del').onclick = async () => { if (confirm('이 세션을 지울까요?')) { for (const p of await DB.by('photos', 'jobId', s0.id)) await DB.del('photos', p.id); await SP.del(s0.id); location.replace('#/dives'); } };
    }
  };
  draw();
}

/* ───────── 훈련 달력·기록 추이 ───────── */
async function viewSportCal() {
  setTitle('훈련 달력·기록', true);
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const ym = qs.get('m') || monthStr();
  const [items, cfg] = await Promise.all([SP.all(), spCfg()]);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), off = (first.getDay() + 6) % 7;
  const on = (d) => `${ym}-${pad(d)}`;
  const runs = items.filter((x) => x.type === 'run'), dives = items.filter((x) => x.type === 'dive'), tr = items.filter((x) => x.type === 'tablerun');
  const mv = (n) => { const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  // 월별 다이빙 세션 수(최근 6개월), 스태틱·수심 추이
  const months = [...Array(6)].map((_, i) => mv(i - 5));
  const diveCnt = months.map((mm) => dives.filter((d) => (d.date || '').startsWith(mm)).length);
  // 스태틱 추이는 다이브 로그의 STA 기록만(테이블 훈련의 숨참기는 최고 기록 시도가 아니라 제외)
  const staTrend = dives.flatMap((s) => (s.dives || []).filter((d) => d.disc === 'STA' && toSec(d.downtime)).map((d) => ({ date: s.date, v: toSec(d.downtime) }))).sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  const depthTrend = dives.map((s) => ({ date: s.date, v: Math.max(0, ...(s.dives || []).map((d) => +d.depth || 0)) })).filter((x) => x.v).sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  const bars = (arr, fmt, color) => { const mx = Math.max(1, ...arr.map((x) => x.v)); return arr.length ? `<div style="display:flex;align-items:flex-end;gap:4px;height:90px">${arr.map((x) => `<div style="flex:1;text-align:center"><div style="background:${color};height:${Math.round((x.v / mx) * 70)}px;border-radius:4px 4px 0 0"></div><div class="muted" style="font-size:10px">${fmt(x.v)}</div></div>`).join('')}</div>` : '<div class="muted">기록이 없습니다.</div>'; };
  view().innerHTML = `
    <div class="row spread" style="margin-bottom:8px"><a class="btn small" href="#/sportcal?m=${mv(-1)}">‹</a><b>${y}년 ${m}월</b><a class="btn small" href="#/sportcal?m=${mv(1)}">›</a></div>
    <div class="card"><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center">
      ${['월', '화', '수', '목', '금', '토', '일'].map((d) => `<div class="muted" style="font-size:12px">${d}</div>`).join('')}
      ${'<div></div>'.repeat(off)}
      ${[...Array(days)].map((_, i) => { const d = on(i + 1); const km = runs.filter((r) => r.date === d).reduce((a, r) => a + (+r.km || 0), 0); const dv = dives.some((s) => s.date === d), tb = tr.some((r) => r.date.slice(0, 10) === d);
        return `<div style="border:1px solid var(--line);border-radius:8px;min-height:52px;padding:2px;${d === todayStr() ? 'outline:2px solid var(--blue)' : ''}"><div style="font-size:12px">${i + 1}</div>${km ? `<div style="font-size:11px;color:var(--blue)">🏃${km.toFixed(0)}</div>` : ''}${dv ? '<div style="font-size:11px">🤿</div>' : ''}${tb ? '<div style="font-size:11px">🫁</div>' : ''}</div>`; }).join('')}
    </div></div>
    <div class="card"><h2>🫁 스태틱 기록 추이</h2>${bars(staTrend, (v) => hms(v), 'var(--blue)')}<div class="muted" style="margin-top:6px">최고 ${bestStatic(items, cfg) ? hms(bestStatic(items, cfg)) : '-'}</div></div>
    <div class="card"><h2>🤿 최대 수심 추이(m)</h2>${bars(depthTrend, (v) => v, 'var(--green)')}</div>
    <div class="card"><h2>월별 다이빙 세션</h2>${bars(months.map((mm, i) => ({ v: diveCnt[i], mm })), (v) => v, 'var(--gold)')}<div class="row spread muted" style="font-size:11px">${months.map((mm) => `<span>${+mm.slice(5)}월</span>`).join('')}</div></div>`;
}

/* ───────── 목표·설정 ───────── */
async function viewSportSet() {
  setTitle('운동 목표·설정', true);
  const c = await spCfg();
  view().innerHTML = `<form class="card" id="spf">
    <label for="c_week">주간 러닝 목표(km)</label><input id="c_week" type="number" inputmode="decimal" value="${esc(c.weekKm)}">
    <div class="muted">훈련 플랜(2차)이 생기기 전까지 홈의 '계획 대비'는 이 목표로 계산합니다.</div>
    <label for="c_sta">스태틱 최고 기록 (분:초)</label><input id="c_sta" inputmode="numeric" value="${c.staticPB ? hms(c.staticPB) : ''}">
    <label for="c_shoe">러닝화 기본 교체 기준(km)</label><input id="c_shoe" type="number" inputmode="numeric" value="${esc(c.shoeLimit)}">
    <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button></form>`;
  $('#spf').onsubmit = async (e) => {
    e.preventDefault();
    await setSetting('sport', { ...c, weekKm: +$('#c_week').value || 30, staticPB: toSec($('#c_sta').value), shoeLimit: +$('#c_shoe').value || 700 });
    toast('저장했습니다'); history.back();
  };
}
