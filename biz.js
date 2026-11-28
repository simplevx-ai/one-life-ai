/* ONE LIFE AI — 현장노트 (개인사업: 컴퓨터·방충망·TV 설치·LED 시계·타일 복원)
 * 접수 → 현장 체크(작업 종류별) → 견적(단가표 자동) → 입금·장부 → 재방문 알림까지.
 * 현장노트 홈(오늘), 달력(끌어서 날짜 옮기기·관리사무소 근무일), 견적서·영수증 이미지, 고객 타임라인, 장부(지출·순이익·엑셀).
 * app.js보다 먼저 불러온다. 데이터: jobs.fc(현장 체크)·jobs.est(견적), expense 저장소, settings 'prices'·'bizCfg'·'biz'.
 * 2차(미포함): 음성 접수, 구글 캘린더 동기화, 후기 요청 문자.
 */
'use strict';

const BIZ_TYPES = ['컴퓨터', '방충망', 'TV 설치', 'LED 시계', '타일 복원'];
const TYPE_ICON = { '컴퓨터': '💻', '방충망': '🪟', 'TV': '📺', 'LED 시계': '🕐', '타일 복원': '🧱', '기타': '🔧' };
// 작업 종류 이름(옛 이름 포함)을 현장 체크 종류로
function typeKey(t) {
  t = String(t || '');
  if (/컴퓨터|PC|노트북/.test(t)) return '컴퓨터';
  if (/방충망/.test(t)) return '방충망';
  if (/TV|티비/.test(t)) return 'TV';
  if (/LED|시계/.test(t)) return 'LED 시계';
  if (/타일/.test(t)) return '타일 복원';
  return '기타';
}
const tIcon = (t) => TYPE_ICON[typeKey(t)] || '🔧';
const EXP_CATS = ['부품', '자재', '주유', '광고비', '공구', '기타'];

/* 단가표 기본 품목(가격은 비워 둠 — 실제 단가를 사장님이 넣는다) */
const PRICE_DEFAULT = {
  '컴퓨터': [['점검·청소', '회'], ['윈도우 설치', '회'], ['데이터 백업', '회'], ['SSD', '개'], ['RAM', '개'], ['그래픽카드', '개'], ['파워', '개']],
  '방충망': [['일반망', 'm²'], ['미세망', 'm²'], ['스텐망', 'm²'], ['롤방충망', 'm²'], ['최소 시공비', '회']],
  'TV': [['설치비(65인치 이하)', '회'], ['설치비(75인치 이상)', '회'], ['고정 브라켓', '개'], ['틸트 브라켓', '개'], ['암 브라켓', '개'], ['몰딩 선정리', '식'], ['매립 선정리', '식'], ['석고벽 보강', '식']],
  'LED 시계': [['설치비', '회'], ['배선 작업', '식'], ['몰딩', 'm']],
  '타일 복원': [['부분 교체', '개'], ['복원제 보수', '개'], ['줄눈 재시공', 'm²'], ['타일 교체', 'm²']],
  '공통': [['출장비', '회']],
};
async function priceTable() {
  const saved = await getSetting('prices', null);
  const out = {};
  for (const [k, rows] of Object.entries(PRICE_DEFAULT)) out[k] = (saved && saved[k]) || rows.map(([name, unit]) => ({ name, unit, price: '' }));
  return out;
}
const priceOf = (P, k, name) => { const r = (P[k] || []).find((x) => x.name === name); return r ? { unit: r.unit, price: r.price === '' ? '' : Number(r.price) } : { unit: '', price: '' }; };
async function bizCfg() { return { officeMode: '없음', officeDays: [], officeBase: '', ...(await getSetting('bizCfg', {})) }; }
function isOfficeDay(cfg, iso) {
  if (cfg.officeMode === '요일') return (cfg.officeDays || []).includes(new Date(iso + 'T00:00').getDay());
  if (cfg.officeMode === '격일' && cfg.officeBase) { const d = Math.round((new Date(iso + 'T00:00') - new Date(cfg.officeBase + 'T00:00')) / 864e5); return ((d % 2) + 2) % 2 === 0; }
  return false;
}
const mapLinks = (addr) => addr ? `<a class="btn small" href="https://map.naver.com/p/search/${encodeURIComponent(addr)}" target="_blank" rel="noopener">🗺 네이버</a><a class="btn small" href="https://map.kakao.com/link/search/${encodeURIComponent(addr)}" target="_blank" rel="noopener">🗺 카카오</a>` : '';
const contactBtns = (c) => (c && c.phone ? `<a class="btn small" href="tel:${digits(c.phone)}">📞</a><a class="btn small" href="sms:${digits(c.phone)}">💬</a>` : '');

/* ───────── 현장노트 홈(오늘) ───────── */
async function viewBiz() {
  setTitle('현장노트', true);
  const [jobs, custs, pays, exps, cfg] = await Promise.all([DB.all('jobs'), DB.all('customers'), DB.all('payments'), DB.all('expense'), bizCfg()]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const today = todayStr(), tmr = addDays(1);
  const sched = (d) => jobs.filter((j) => j.status !== '취소' && (j.scheduledAt || '').slice(0, 10) === d).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const tj = sched(today), mj = sched(tmr);
  const m = monthStr();
  const mSales = pays.filter((p) => (p.date || '').startsWith(m)).reduce((a, p) => a + (+p.amount || 0), 0);
  const mExp = exps.filter((x) => (x.date || '').startsWith(m)).reduce((a, x) => a + (+x.amount || 0), 0);
  const unpaid = jobs.filter((j) => j.status === '완료').reduce((a, j) => a + Math.max(0, (+j.quote || 0) - paidOf(j.id, pays)), 0);
  const mCount = jobs.filter((j) => j.status !== '취소' && (j.scheduledAt || '').startsWith(m)).length;
  const contacts = contactList(jobs, custs);
  const card = (j) => {
    const c = cmap[j.customerId] || {};
    const addr = [j.area, j.address].filter(Boolean).join(' ');
    return `<div class="item"><a href="#/job/${j.id}" style="color:inherit;text-decoration:none;display:block"><div class="row spread"><span class="t">${tIcon(j.type)} ${esc((j.scheduledAt || '').slice(11, 16) || '시간 미정')} · ${esc(nameOf(c))}</span><span class="badge s-${j.status}">${esc(j.status)}</span></div>
      <div class="muted">${esc(j.type || '')} · ${esc(addr || '주소 미입력')}</div></a>
      <div class="row wrap" style="margin-top:6px">${contactBtns(c)}${mapLinks(addr)}<a class="btn small" href="#/fc/${j.id}">📋 현장 체크</a></div></div>`;
  };
  view().innerHTML = `
    <div class="card hero"><div class="muted">${esc(fmtDate(today))} 오늘${isOfficeDay(cfg, today) ? ' · 🏢 관리사무소 근무일' : ''}</div>
      <div class="grid2" style="margin-top:8px;grid-template-columns:repeat(3,1fr)">
        <div><div class="muted">이번 달 매출</div><b style="font-size:19px">${won(mSales)}</b></div>
        <div><div class="muted">미수금</div><b style="font-size:19px;color:${unpaid ? '#FFD1D1' : '#fff'}">${won(unpaid)}</b></div>
        <div><div class="muted">작업 건수</div><b style="font-size:19px">${mCount}건</b></div></div>
      <div class="muted" style="margin-top:4px">지출 ${won(mExp)} · 순이익 ${won(mSales - mExp)}</div></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">📅 오늘 일정 ${tj.length}</h2><a class="btn small primary" href="#/job/new">+ 작업 접수</a></div>
      <div style="margin-top:8px">${tj.map(card).join('') || '<div class="muted">오늘 일정이 없습니다.</div>'}</div></div>
    ${mj.length ? `<div class="card"><h2>🔔 내일 일정 ${mj.length} <span class="muted">(전날 알림)</span></h2>${mj.map(card).join('')}</div>` : ''}
    <div class="card"><h2>☎️ 연락할 고객 ${contacts.length}</h2>${contacts.slice(0, 8).map((x) => `<div class="item row spread"><a href="#/customer/${x.c.id}" style="color:inherit;text-decoration:none;flex:1"><b>${esc(nameOf(x.c))}</b> <span class="muted">${esc(x.why)}</span></a><div class="row">${contactBtns(x.c)}</div></div>`).join('') || '<div class="muted">없음</div>'}</div>
    <button class="btn block" type="button" disabled style="margin-bottom:12px">🎤 음성 접수 (2차 예정)</button>
    <div class="card"><div class="tiles">
      <a class="tile" href="#/cal"><i>🗓</i>일정 달력</a><a class="tile" href="#/jobs"><i>📋</i>작업 목록</a><a class="tile" href="#/customers"><i>👤</i>고객</a>
      <a class="tile" href="#/ledger"><i>📒</i>장부</a><a class="tile" href="#/rcpt"><i>🧾</i>간이영수증</a><a class="tile" href="#/prices"><i>💲</i>단가표</a><a class="tile" href="#/bizset"><i>🏢</i>근무일 설정</a></div></div>`;
}

/* 연락할 고객: 다음 연락일이 됐거나, 재방문 시즌(방충망 봄 전·컴퓨터 1년 점검) */
function contactList(jobs, custs) {
  const today = todayStr(), out = [], seen = new Set();
  const md = today.slice(5);
  custs.forEach((c) => { if (c.nextContact && c.nextContact <= today) { out.push({ c, why: `다음 연락일 ${c.nextContact.slice(5)}${c.contactMemo ? ' · ' + c.contactMemo : ''}` }); seen.add(c.id); } });
  const done = jobs.filter((j) => j.status === '완료');
  custs.forEach((c) => {
    if (seen.has(c.id)) return;
    const cj = done.filter((j) => j.customerId === c.id);
    const pc = cj.find((j) => typeKey(j.type) === '컴퓨터' && j.fc && j.fc.nextCheck && j.fc.nextCheck <= addDays(14));
    if (pc) { out.push({ c, why: `컴퓨터 1년 점검 (${pc.fc.nextCheck.slice(5)})` }); seen.add(c.id); return; }
    // 방충망: 2월 15일~3월 31일, 지난해 이전에 시공한 고객
    if (md >= '02-15' && md <= '03-31') {
      const sc = cj.find((j) => typeKey(j.type) === '방충망' && (j.doneAt || j.scheduledAt || '').slice(0, 4) < today.slice(0, 4));
      if (sc) { out.push({ c, why: '방충망 봄 시즌 전 안내' }); seen.add(c.id); }
    }
  });
  return out;
}

/* ───────── 현장 체크(작업 종류별) ───────── */
async function viewFieldCheck(id) {
  const j = await DB.get('jobs', id);
  if (!j) { setTitle('현장 체크', true); view().innerHTML = '<div class="empty">작업을 찾을 수 없습니다.</div>'; return; }
  const P = await priceTable();
  const k = typeKey(j.type);
  const fc = { ...(j.fc || {}) };
  setTitle(`${TYPE_ICON[k] || ''} 현장 체크 · ${k}`, true);
  const sel = (idn, list, v) => `<select id="${idn}">${opts(list, v)}</select>`;
  const inp = (idn, v, ph = '', type = 'text') => `<input id="${idn}" type="${type}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(v)}" placeholder="${esc(ph)}">`;
  const lab = (t, html) => `<label>${t}</label>${html}`;
  let body = '';
  if (k === '컴퓨터') {
    const parts = P['컴퓨터'];
    fc.parts = fc.parts || {};
    body = `${lab('증상', `<textarea id="f_sym" rows="2">${esc(fc.sym)}</textarea>`)}
      <div class="grid2"><div>${lab('CPU', inp('f_cpu', fc.cpu))}</div><div>${lab('RAM', inp('f_ram', fc.ram, '16GB'))}</div></div>
      <div class="grid2"><div>${lab('SSD', inp('f_ssd', fc.ssd, '512GB'))}</div><div>${lab('그래픽', inp('f_gpu', fc.gpu))}</div></div>
      <label>작업·교체 부품 (고르면 견적에 들어감)</label>
      ${parts.map((p, i) => `<div class="row" style="margin:4px 0"><label class="row" style="margin:0;color:var(--ink);font-size:15px;flex:1"><input type="checkbox" data-part="${i}" ${fc.parts[p.name] ? 'checked' : ''} style="width:20px;min-height:20px;flex:none"> ${esc(p.name)}</label><input data-pq="${i}" type="number" inputmode="numeric" min="1" value="${esc((fc.parts[p.name] || {}).qty || 1)}" style="width:70px;min-height:36px"></div>`).join('')}
      ${lab('데이터 백업', sel('f_backup', ['안 함', '함', '고객이 직접'], fc.backup))}
      ${lab('다음 점검일 (기본 1년 뒤)', inp('f_next', fc.nextCheck || addDays(365), '', 'date'))}`;
  } else if (k === '방충망') {
    fc.windows = fc.windows || [{ loc: '거실', w: '', h: '', net: '미세망', color: '화이트' }];
    body = `<div id="f_wins"></div><button class="btn small" id="f_addw" type="button">+ 창 추가</button>
      <div class="card" style="background:var(--bg);margin:10px 0 0" id="f_sum"></div>
      <button class="btn small" id="f_share" type="button" style="margin-top:8px">📤 자재 주문용 치수표 복사</button>`;
  } else if (k === 'TV') {
    body = `<div class="grid2"><div>${lab('인치', inp('f_inch', fc.inch, '75', 'number'))}</div><div>${lab('벽 재질', sel('f_wall', ['콘크리트', '석고', '타일', '기타'], fc.wall))}</div></div>
      <div id="f_gyp" class="card warnbox" style="margin:8px 0" hidden>⚠️ 석고벽입니다. 보강 자재(앵커·보강판)를 챙기세요.</div>
      <div class="grid2"><div>${lab('브라켓', sel('f_bracket', ['고정', '틸트', '암', '고객 제공'], fc.bracket))}</div><div>${lab('설치 높이(cm, 화면 중심)', inp('f_height', fc.height, '110', 'number'))}</div></div>
      <div class="grid2"><div>${lab('선 정리', sel('f_cable', ['없음', '몰딩', '매립'], fc.cable))}</div><div>${lab('셋톱 위치', inp('f_settop', fc.settop, 'TV 아래 선반'))}</div></div>`;
  } else if (k === 'LED 시계') {
    const models = P['LED 시계'].filter((x) => !['설치비', '배선 작업', '몰딩'].includes(x.name)).map((x) => x.name);
    body = `<div class="grid2"><div>${lab('제품 모델', `<input id="f_model" list="f_models" value="${esc(fc.model)}"><datalist id="f_models">${models.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`)}</div><div>${lab('크기', inp('f_size', fc.size))}</div></div>
      <div class="grid2"><div>${lab('설치 위치', sel('f_loc', ['거실', '현관', '매장', '외벽', '기타'], fc.loc))}</div><div>${lab('벽 재질', sel('f_wall', ['콘크리트', '석고', '타일', '유리', '기타'], fc.wall))}</div></div>
      <div class="grid2"><div>${lab('고정 방식', sel('f_mount', ['앵커', '브라켓', '양면', '거치'], fc.mount))}</div><div>${lab('콘센트 거리(m)', inp('f_dist', fc.dist, '2', 'number'))}</div></div>
      <div class="grid2"><div>${lab('배선 필요', sel('f_wire', ['아니오', '예'], fc.wire))}</div><div>${lab('몰딩 길이(m)', inp('f_mold', fc.mold, '0', 'number'))}</div></div>
      ${lab('표시 설정', inp('f_disp', fc.disp, '시간·날짜·온습도'))}
      ${lab('보증 기간(개월)', inp('f_warr', fc.warr || 12, '', 'number'))}`;
  } else if (k === '타일 복원') {
    body = `<div class="grid2"><div>${lab('위치', sel('f_loc', ['욕실 벽', '욕실 바닥', '주방', '현관', '베란다', '기타'], fc.loc))}</div><div>${lab('손상 유형', sel('f_dmg', ['깨짐', '들뜸', '줄눈 탈락', '변색'], fc.dmg))}</div></div>
      <div class="grid2"><div>${lab('개수', inp('f_cnt', fc.cnt, '', 'number'))}</div><div>${lab('면적(m²)', inp('f_area', fc.area, '', 'number'))}</div></div>
      <div class="grid2"><div>${lab('타일 규격', inp('f_spec', fc.spec, '300×600'))}</div><div>${lab('색상', inp('f_color', fc.color))}</div></div>
      <div class="grid2"><div>${lab('여분 타일', sel('f_spare', ['있음', '없음'], fc.spare))}</div><div>${lab('작업 방식', sel('f_method', ['부분 교체', '복원제 보수', '줄눈 재시공', '타일 교체'], fc.method))}</div></div>
      ${lab('색상 맞춤 메모', `<textarea id="f_cmemo" rows="2">${esc(fc.cmemo)}</textarea>`)}
      ${lab('물 사용 자제 시간(안내 문자)', inp('f_hours', fc.hours || 24, '', 'number'))}
      <button class="btn small" id="f_sms" type="button" style="margin-top:8px">💬 작업 후 안내 문자 복사</button>`;
  } else {
    body = `${lab('현장 메모', `<textarea id="f_memo" rows="4">${esc(fc.memo)}</textarea>`)}`;
  }
  view().innerHTML = `<div class="card"><div class="muted">${esc(j.area || '')} ${esc(j.address || '')}</div>${body}
      ${lab('메모', `<textarea id="f_note" rows="2">${esc(fc.note)}</textarea>`)}</div>
    <div class="card"><div class="row spread"><h2 style="margin:0">📷 사진</h2><a class="btn small" href="#/job/${j.id}">작업 화면에서 추가·표시</a></div><div class="muted" style="margin-top:4px">사진 위에 손상 부위를 표시하려면 작업 화면의 사진을 눌러 '✏️ 표시'를 쓰세요.</div></div>
    <div class="row"><button class="btn primary block" id="f_save" type="button">💾 저장</button><button class="btn block" id="f_est" type="button">🧾 견적 만들기</button></div>`;

  // 방충망: 창 목록
  const drawWins = () => {
    if (k !== '방충망') return;
    const nets = P['방충망'].filter((x) => /망/.test(x.name)).map((x) => x.name);
    $('#f_wins').innerHTML = fc.windows.map((w, i) => `<div class="card" style="background:var(--bg);margin:6px 0">
      <div class="row spread"><b>#${i + 1}</b><button class="btn small danger" data-wx="${i}" type="button">✕</button></div>
      <div class="grid2"><div><label>위치</label><input data-w="loc" data-i="${i}" list="f_locs" value="${esc(w.loc)}"></div><div><label>망 종류</label><select data-w="net" data-i="${i}">${opts(nets.length ? nets : ['일반망'], w.net)}</select></div></div>
      <div class="grid2"><div><label>가로(mm)</label><input data-w="w" data-i="${i}" type="number" inputmode="numeric" value="${esc(w.w)}"></div><div><label>세로(mm)</label><input data-w="h" data-i="${i}" type="number" inputmode="numeric" value="${esc(w.h)}"></div></div>
      <label>프레임 색</label><input data-w="color" data-i="${i}" value="${esc(w.color)}"></div>`).join('') + '<datalist id="f_locs"><option value="거실"><option value="안방"><option value="작은방"><option value="주방"><option value="베란다"><option value="현관"></datalist>';
    $('#f_wins').querySelectorAll('[data-w]').forEach((el) => { el.oninput = el.onchange = () => { fc.windows[+el.dataset.i][el.dataset.w] = el.value; sum(); }; });
    $('#f_wins').querySelectorAll('[data-wx]').forEach((b) => { b.onclick = () => { fc.windows.splice(+b.dataset.wx, 1); drawWins(); }; });
    sum();
  };
  const sum = () => {
    if (k !== '방충망') return;
    let tot = 0, amt = 0, miss = false;
    const rows = fc.windows.map((w) => { const a = (+w.w || 0) * (+w.h || 0) / 1e6; const p = priceOf(P, '방충망', w.net).price; if (p === '') miss = true; tot += a; amt += a * (+p || 0); return a; });
    $('#f_sum').innerHTML = `창 ${fc.windows.length}개 · 면적 합계 <b>${tot.toFixed(2)}m²</b> · 금액 <b>${won(Math.round(amt))}</b>${miss ? '<div class="muted" style="color:var(--red)">단가표에 망 가격이 비어 있습니다.</div>' : ''}<div class="muted" style="font-size:12px">${rows.map((a, i) => `#${i + 1} ${a.toFixed(2)}m²`).join(' · ')}</div>`;
  };
  if (k === '방충망') {
    drawWins();
    $('#f_addw').onclick = () => { const l = fc.windows[fc.windows.length - 1] || {}; fc.windows.push({ loc: '', w: '', h: '', net: l.net || '미세망', color: l.color || '화이트' }); drawWins(); };
    $('#f_share').onclick = () => copyText([`[방충망 치수표] ${j.area || ''}`, ...fc.windows.map((w, i) => `${i + 1}. ${w.loc || '-'} / ${w.w}×${w.h}mm / ${w.net} / ${w.color}`), `합계 ${fc.windows.length}개`].join('\n'));
  }
  if (k === 'TV') { const g = () => { $('#f_gyp').hidden = $('#f_wall').value !== '석고'; }; $('#f_wall').onchange = g; g(); }
  if (k === '타일 복원') $('#f_sms').onclick = async () => copyText(`안녕하세요, ${(await bizInfoSafe()).name || ''} 입니다.\n오늘 ${$('#f_loc').value} 타일 ${$('#f_method').value} 작업을 마쳤습니다.\n시공 부위가 잘 굳도록 ${$('#f_hours').value}시간 동안 물 사용과 강한 충격을 피해 주세요.\n불편하신 점은 언제든 연락 주세요. 감사합니다.`);

  const read = () => {
    const g = (s) => ($(s) ? $(s).value : undefined);
    if (k === '컴퓨터') {
      const parts = {};
      P['컴퓨터'].forEach((p, i) => { if (view().querySelector(`[data-part="${i}"]`).checked) parts[p.name] = { qty: +view().querySelector(`[data-pq="${i}"]`).value || 1 }; });
      Object.assign(fc, { sym: g('#f_sym'), cpu: g('#f_cpu'), ram: g('#f_ram'), ssd: g('#f_ssd'), gpu: g('#f_gpu'), parts, backup: g('#f_backup'), nextCheck: g('#f_next') });
    } else if (k === 'TV') Object.assign(fc, { inch: g('#f_inch'), wall: g('#f_wall'), bracket: g('#f_bracket'), height: g('#f_height'), cable: g('#f_cable'), settop: g('#f_settop') });
    else if (k === 'LED 시계') Object.assign(fc, { model: g('#f_model'), size: g('#f_size'), loc: g('#f_loc'), wall: g('#f_wall'), mount: g('#f_mount'), dist: g('#f_dist'), wire: g('#f_wire'), mold: g('#f_mold'), disp: g('#f_disp'), warr: g('#f_warr') });
    else if (k === '타일 복원') Object.assign(fc, { loc: g('#f_loc'), dmg: g('#f_dmg'), cnt: g('#f_cnt'), area: g('#f_area'), spec: g('#f_spec'), color: g('#f_color'), spare: g('#f_spare'), method: g('#f_method'), cmemo: g('#f_cmemo'), hours: g('#f_hours') });
    else fc.memo = g('#f_memo');
    fc.note = g('#f_note');
  };
  const save = async () => { read(); const jj = await DB.get('jobs', id); await DB.put('jobs', { ...jj, fc, updatedAt: nowISO() }); };
  $('#f_save').onclick = async () => { await save(); toast('저장했습니다'); };
  $('#f_est').onclick = async () => { await save(); location.hash = `#/est/${id}?auto=1`; };
}
async function bizInfoSafe() { try { return await bizInfo(); } catch { return {}; } }

/* 현장 체크 → 견적 줄 */
function linesFromCheck(j, P) {
  const k = typeKey(j.type), fc = j.fc || {}, L = [];
  const add = (cat, name, qty = 1, label) => { const p = priceOf(P, cat, name); L.push({ name: label || name, qty, unit: p.unit, price: p.price, src: 'auto' }); };
  if (k === '컴퓨터') Object.entries(fc.parts || {}).forEach(([n, v]) => add('컴퓨터', n, v.qty || 1));
  if (k === '방충망') (fc.windows || []).forEach((w, i) => { const a = (+w.w || 0) * (+w.h || 0) / 1e6; if (a) add('방충망', w.net, +a.toFixed(2), `${w.loc || '창 ' + (i + 1)} ${w.net} ${w.w}×${w.h}`); });
  if (k === 'TV') {
    add('TV', (+fc.inch || 0) >= 75 ? '설치비(75인치 이상)' : '설치비(65인치 이하)', 1, `TV 설치(${fc.inch || '-'}인치)`);
    if (fc.bracket && fc.bracket !== '고객 제공') add('TV', `${fc.bracket} 브라켓`);
    if (fc.cable === '몰딩') add('TV', '몰딩 선정리'); if (fc.cable === '매립') add('TV', '매립 선정리');
    if (fc.wall === '석고') add('TV', '석고벽 보강');
  }
  if (k === 'LED 시계') {
    if (fc.model) add('LED 시계', fc.model, 1, `LED 시계 ${fc.model}${fc.size ? ' ' + fc.size : ''}`);
    add('LED 시계', '설치비');
    if (fc.wire === '예') add('LED 시계', '배선 작업');
    if (+fc.mold > 0) add('LED 시계', '몰딩', +fc.mold);
  }
  if (k === '타일 복원') {
    const m = fc.method || '부분 교체';
    const byArea = /m²/.test(priceOf(P, '타일 복원', m).unit);
    add('타일 복원', m, byArea ? (+fc.area || 0) : (+fc.cnt || 0), `${fc.loc || ''} ${m}`.trim());
  }
  return L;
}

/* ───────── 견적서·영수증 ───────── */
function estTotal(e) {
  const sub = (e.lines || []).reduce((a, l) => a + (+l.qty || 0) * (+l.price || 0), 0);
  const trip = +e.trip || 0, disc = +e.discount || 0;
  const base = Math.max(0, sub + trip - disc);
  const vat = e.vat ? Math.round(base * 0.1) : 0;
  return { sub, trip, disc, vat, total: base + vat };
}
async function viewEstimate(id) {
  const j = await DB.get('jobs', id);
  if (!j) { setTitle('견적서', true); view().innerHTML = '<div class="empty">작업을 찾을 수 없습니다.</div>'; return; }
  const [c, P, pays, biz] = await Promise.all([DB.get('customers', j.customerId), priceTable(), DB.by('payments', 'jobId', id), bizInfo()]);
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const e = j.est ? JSON.parse(JSON.stringify(j.est)) : { lines: [], trip: priceOf(P, '공통', '출장비').price || '', discount: '', vat: false, note: '' };
  if (qs.get('auto') || !j.est) { const auto = linesFromCheck(j, P); e.lines = [...auto, ...e.lines.filter((l) => l.src !== 'auto')]; }
  const paid = pays.reduce((a, p) => a + (+p.amount || 0), 0);
  setTitle('견적서', true);
  const draw = () => {
    const T = estTotal(e);
    view().innerHTML = `<div class="card"><div class="t" style="font-weight:800">${esc(nameOf(c))} · ${esc(j.type || '')}</div><div class="muted">${esc(j.area || '')}</div></div>
      <div class="card"><h2>품목</h2>
        ${e.lines.map((l, i) => `<div class="card" style="background:var(--bg);margin:6px 0;padding:10px">
          <div class="row"><input data-l="name" data-i="${i}" value="${esc(l.name)}" style="flex:1"><button class="btn small danger" data-x="${i}" type="button">✕</button></div>
          <div class="row" style="margin-top:6px"><input data-l="qty" data-i="${i}" type="number" inputmode="decimal" step="any" value="${esc(l.qty)}" style="width:80px"><span class="muted">${esc(l.unit || '')} ×</span><input data-l="price" data-i="${i}" type="number" inputmode="numeric" step="100" value="${esc(l.price)}" placeholder="단가" style="flex:1"><b style="min-width:90px;text-align:right">${won((+l.qty || 0) * (+l.price || 0))}</b></div>
          ${l.price === '' ? '<div class="muted" style="color:var(--red);font-size:12px">단가 미입력(단가표에 넣으면 다음부터 자동)</div>' : ''}</div>`).join('') || '<div class="muted">품목이 없습니다.</div>'}
        <div class="row wrap" style="margin-top:6px"><button class="btn small" id="e_add" type="button">+ 품목</button><select id="e_pick" style="width:auto;flex:1"><option value="">단가표에서 고르기</option>${Object.entries(P).map(([k, rows]) => rows.map((r) => `<option value="${esc(k)}|${esc(r.name)}">${esc(k)} · ${esc(r.name)}${r.price !== '' ? ' ' + won(r.price) : ''}</option>`).join('')).join('')}</select><button class="btn small" id="e_auto" type="button">↺ 현장 체크로 다시 채우기</button></div></div>
      <div class="card"><div class="grid2"><div><label for="e_trip">출장비</label><input id="e_trip" type="number" inputmode="numeric" value="${esc(e.trip)}"></div><div><label for="e_disc">할인</label><input id="e_disc" type="number" inputmode="numeric" value="${esc(e.discount)}"></div></div>
        <label class="row" style="margin-top:8px;color:var(--ink);font-size:15px"><input type="checkbox" id="e_vat" ${e.vat ? 'checked' : ''} style="width:22px;min-height:22px;flex:none"> 부가세 10% 포함</label>
        <label for="e_note">비고</label><input id="e_note" value="${esc(e.note)}" placeholder="예: 견적 유효기간 7일">
        <table style="margin-top:10px"><tbody><tr><td>품목 합계</td><td class="r">${won(T.sub)}</td></tr><tr><td>출장비</td><td class="r">${won(T.trip)}</td></tr>${T.disc ? `<tr><td>할인</td><td class="r">-${won(T.disc)}</td></tr>` : ''}${e.vat ? `<tr><td>부가세</td><td class="r">${won(T.vat)}</td></tr>` : ''}<tr><td><b>합계</b></td><td class="r"><b style="font-size:20px;color:var(--ink)">${won(T.total)}</b></td></tr>${paid ? `<tr><td>받은 금액</td><td class="r">${won(paid)}</td></tr>` : ''}</tbody></table></div>
      <div class="row"><button class="btn primary block" id="e_save" type="button">💾 저장(견적 금액 반영)</button></div>
      <div class="row" style="margin-top:8px"><button class="btn block" id="e_img" type="button">🧾 견적서 보내기</button><button class="btn block" id="e_rcpt" type="button">🧾 영수증 보내기</button></div>
      <div id="e_box" style="margin-top:10px"></div>`;
    view().querySelectorAll('[data-l]').forEach((el) => { el.onchange = () => { const l = e.lines[+el.dataset.i]; l[el.dataset.l] = el.dataset.l === 'name' ? el.value : (el.value === '' ? '' : +el.value); readTop(); draw(); }; });
    view().querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { readTop(); e.lines.splice(+b.dataset.x, 1); draw(); }; });
    $('#e_add').onclick = () => { readTop(); e.lines.push({ name: '', qty: 1, unit: '', price: '', src: 'manual' }); draw(); };
    $('#e_pick').onchange = (ev) => { if (!ev.target.value) return; readTop(); const [kk, n] = ev.target.value.split('|'); const p = priceOf(P, kk, n); e.lines.push({ name: n, qty: 1, unit: p.unit, price: p.price, src: 'manual' }); draw(); };
    $('#e_auto').onclick = async () => { readTop(); const jj = await DB.get('jobs', id); e.lines = [...linesFromCheck(jj, P), ...e.lines.filter((l) => l.src !== 'auto')]; draw(); };
    ['#e_trip', '#e_disc', '#e_vat'].forEach((s) => { $(s).onchange = () => { readTop(); draw(); }; });
    $('#e_save').onclick = async () => { readTop(); await saveEst(); toast(`저장했습니다 (견적 ${won(estTotal(e).total)})`); };
    $('#e_img').onclick = async () => { readTop(); await saveEst(); shareDoc('견적서'); };
    $('#e_rcpt').onclick = async () => { readTop(); await saveEst(); shareDoc('영수증'); };
  };
  const readTop = () => { if (!$('#e_trip')) return; e.trip = $('#e_trip').value === '' ? '' : +$('#e_trip').value; e.discount = $('#e_disc').value === '' ? '' : +$('#e_disc').value; e.vat = $('#e_vat').checked; e.note = $('#e_note').value; };
  const saveEst = async () => { const jj = await DB.get('jobs', id); const T = estTotal(e); await DB.put('jobs', { ...jj, est: e, quote: T.total, status: jj.status === '접수' ? '견적' : jj.status, updatedAt: nowISO() }); };
  const shareDoc = async (kind) => {
    const T = estTotal(e);
    // 영수증은 실제 간이영수증 양식(rcptform.js), 견적서는 기존 디자인
    const blob = kind === '영수증'
      ? await renderFormReceipt(e, T, j, c || {}, biz, paid, ([...pays].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || {}).method || '')
      : await renderEstImage(kind, e, T, j, c || {}, biz, paid);
    const u = URL.createObjectURL(blob);
    const file = new File([blob], `${kind}-${todayStr()}.png`, { type: 'image/png' });
    $('#e_box').innerHTML = `<img src="${u}" alt="${kind}" style="width:100%;border-radius:12px;border:1px solid var(--line)"><div class="row" style="margin-top:8px"><button class="btn primary block" id="e_share" type="button">📤 카톡·문자로 보내기</button><a class="btn block" href="${u}" download="${file.name}">⬇ 저장</a></div>`;
    $('#e_share').onclick = async () => { if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text: `${kind} - ${biz.name || ''}` }); } catch { /* 취소 */ } } else toast('저장한 뒤 보내 주세요'); };
  };
  draw();
}
async function renderEstImage(kind, e, T, j, c, b, paid) {
  const W = 1080, P = 60, F = '"Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  const rows = e.lines.filter((l) => l.name && (+l.qty || 0) * (+l.price || 0) > 0); // 금액 0인 줄은 고객용 문서에서 뺀다
  const H = 420 + rows.length * 64 + 360 + (e.note ? 60 : 0);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0B1F4B'; g.fillRect(0, 0, W, 170);
  g.fillStyle = '#F5C442'; g.font = `bold 30px ${F}`; g.fillText(b.name || '', P, 64);
  g.fillStyle = '#fff'; g.font = `bold 60px ${F}`; g.fillText(kind, P, 138);
  g.textAlign = 'right'; g.font = `28px ${F}`; g.fillStyle = '#C9D6F5'; g.fillText(todayStr(), W - P, 138); g.textAlign = 'left';
  g.fillStyle = '#15203A'; g.font = `30px ${F}`;
  g.fillText(`${c.name ? c.name + ' 고객님' : '고객님'} · ${j.type || ''}`, P, 230);
  g.fillStyle = '#66708A'; g.font = `26px ${F}`; g.fillText(j.area || '', P, 274);
  let y = 340;
  g.fillStyle = '#F3F5F9'; g.fillRect(P - 10, y - 44, W - 2 * P + 20, 60);
  g.fillStyle = '#66708A'; g.font = `bold 26px ${F}`; g.fillText('품목', P, y); g.textAlign = 'right'; g.fillText('수량', 700, y); g.fillText('금액', W - P, y); g.textAlign = 'left';
  y += 64; g.font = `28px ${F}`;
  rows.forEach((l) => {
    g.fillStyle = '#15203A'; g.fillText(String(l.name).slice(0, 22), P, y);
    g.textAlign = 'right'; g.fillText(`${l.qty}${l.unit || ''}`, 700, y); g.fillText(won((+l.qty || 0) * (+l.price || 0)), W - P, y); g.textAlign = 'left';
    g.strokeStyle = '#E2E6EF'; g.beginPath(); g.moveTo(P, y + 20); g.lineTo(W - P, y + 20); g.stroke();
    y += 64;
  });
  const line = (k, v, bold) => { g.font = `${bold ? 'bold ' : ''}${bold ? 40 : 28}px ${F}`; g.fillStyle = bold ? '#1C60D6' : '#15203A'; g.fillText(k, 560, y); g.textAlign = 'right'; g.fillText(v, W - P, y); g.textAlign = 'left'; y += bold ? 64 : 48; };
  y += 10;
  if (T.trip) line('출장비', won(T.trip));
  if (T.disc) line('할인', '-' + won(T.disc));
  if (e.vat) line('부가세(10%)', won(T.vat));
  line('합계', won(T.total), true);
  if (kind === '영수증') { line('받은 금액', won(paid)); line(paid >= T.total ? '완납' : '남은 금액', paid >= T.total ? '감사합니다' : won(T.total - paid)); }
  if (e.note) { g.fillStyle = '#66708A'; g.font = `24px ${F}`; g.fillText(e.note, P, y); y += 50; }
  g.fillStyle = '#0B1F4B'; g.fillRect(0, H - 100, W, 100);
  g.fillStyle = '#fff'; g.font = `bold 30px ${F}`; g.fillText([b.name, b.phone].filter(Boolean).join('  ·  ') || '감사합니다', P, H - 40);
  return new Promise((res, rej) => cv.toBlob((x) => (x ? res(x) : rej(new Error('이미지 실패'))), 'image/png'));
}

/* ───────── 단가표 ───────── */
async function viewPrices() {
  setTitle('단가표', true);
  const P = await priceTable();
  let cur = sessionStorage.getItem('priceTab') || '방충망';
  const draw = () => {
    view().innerHTML = `<div class="chips" id="pt">${Object.keys(P).map((k) => `<button class="chip${k === cur ? ' on' : ''}" data-k="${esc(k)}" type="button">${TYPE_ICON[k] || '💲'} ${esc(k)}</button>`).join('')}</div>
      <div class="card">${P[cur].map((r, i) => `<div class="row" style="margin:6px 0"><input data-n="${i}" value="${esc(r.name)}" style="flex:2"><input data-u="${i}" value="${esc(r.unit)}" style="width:60px" placeholder="단위"><input data-p="${i}" type="number" inputmode="numeric" step="100" value="${esc(r.price)}" placeholder="단가" style="flex:1"><button class="btn small danger" data-x="${i}" type="button">✕</button></div>`).join('')}
        <button class="btn small" id="p_add" type="button">+ 품목${cur === 'LED 시계' ? '(모델)' : ''}</button></div>
      <div class="muted">${cur === '방충망' ? '망 종류는 m²당 단가입니다. 현장 체크에서 치수를 넣으면 면적×단가로 계산됩니다.' : cur === 'LED 시계' ? '제품 모델을 품목으로 추가하면 현장 체크에서 고를 수 있습니다.' : '여기 단가가 견적에 자동으로 들어갑니다.'} 빈 단가는 견적에서 직접 넣을 수 있습니다.</div>
      <button class="btn primary block" id="p_save" type="button" style="margin-top:10px">💾 저장</button>`;
    const read = () => { P[cur] = P[cur].map((_, i) => ({ name: view().querySelector(`[data-n="${i}"]`).value.trim(), unit: view().querySelector(`[data-u="${i}"]`).value.trim(), price: view().querySelector(`[data-p="${i}"]`).value === '' ? '' : +view().querySelector(`[data-p="${i}"]`).value })).filter((r) => r.name); };
    $('#pt').onclick = (ev) => { const b = ev.target.closest('[data-k]'); if (!b) return; read(); cur = b.dataset.k; sessionStorage.setItem('priceTab', cur); draw(); };
    $('#p_add').onclick = () => { read(); P[cur].push({ name: '', unit: cur === 'LED 시계' ? '대' : '개', price: '' }); draw(); };
    view().querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { read(); P[cur].splice(+b.dataset.x, 1); draw(); }; });
    $('#p_save').onclick = async () => { read(); await setSetting('prices', P); toast('저장했습니다'); };
  };
  draw();
}

/* ───────── 근무일 설정 ───────── */
async function viewBizSet() {
  setTitle('관리사무소 근무일', true);
  const c = await bizCfg();
  view().innerHTML = `<div class="card">
    <div class="muted">달력에 관리사무소 근무일을 표시하고, 그날 작업을 잡으면 알려 줍니다.</div>
    <label for="b_mode">근무 방식</label><select id="b_mode">${opts(['없음', '요일', '격일'], c.officeMode)}</select>
    <div id="b_days" style="margin-top:8px">${'일월화수목금토'.split('').map((d, i) => `<label class="row" style="display:inline-flex;margin:0 10px 6px 0;color:var(--ink);font-size:15px"><input type="checkbox" data-d="${i}" ${(c.officeDays || []).includes(i) ? 'checked' : ''} style="width:20px;min-height:20px"> ${d}</label>`).join('')}</div>
    <div id="b_baseBox"><label for="b_base">격일 기준일(근무한 날 하루)</label><input id="b_base" type="date" value="${esc(c.officeBase || todayStr())}"></div>
    <button class="btn primary block" id="b_save" type="button" style="margin-top:12px">💾 저장</button></div>`;
  const upd = () => { $('#b_days').hidden = $('#b_mode').value !== '요일'; $('#b_baseBox').hidden = $('#b_mode').value !== '격일'; };
  $('#b_mode').onchange = upd; upd();
  $('#b_save').onclick = async () => {
    await setSetting('bizCfg', { ...c, officeMode: $('#b_mode').value, officeDays: [...view().querySelectorAll('[data-d]')].filter((x) => x.checked).map((x) => +x.dataset.d), officeBase: $('#b_base').value });
    toast('저장했습니다'); history.back();
  };
}

/* ───────── 일정 달력(월·주, 끌어서 날짜 옮기기) ───────── */
async function viewCal() {
  setTitle('일정', true);
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const mode = qs.get('v') || 'month';
  const base = qs.get('d') || todayStr();
  const [jobs, custs, cfg, gevs, gmeta, sheetCfg] = await Promise.all([DB.all('jobs'), DB.all('customers'), bizCfg(), gcalEvents(), getSetting('gcal', null), getSetting('sheet', {})]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const on = (d) => jobs.filter((j) => (j.scheduledAt || '').slice(0, 10) === d).sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
  // 구글 캘린더 일정(보기 전용, 끌어서 옮기기 안 됨)
  const gOn = (d) => gcalOn(gevs, d).sort((a, b) => (a.allDay ? '' : a.start).localeCompare(b.allDay ? '' : b.start));
  const gChip = (e, d) => `<div data-gcal="${esc(e.id)}" style="font-size:11px;background:rgba(245,196,66,.28);border-left:3px solid var(--gold);border-radius:4px;padding:1px 3px;margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer">📆${esc(e.allDay ? '' : gcalTime(e, d) + ' ')}${esc(e.title.slice(0, 8))}</div>`;
  const gItem = (e, d) => `<a class="item" href="#" data-gcal="${esc(e.id)}" style="margin:6px 0 0;padding:8px;border-left:4px solid var(--gold)"><div class="row spread"><span>📆 ${esc(gcalTime(e, d))} ${esc(e.title)}</span><span class="badge">구글</span></div>${e.location ? `<div class="muted">📍 ${esc(e.location)}</div>` : ''}</a>`;
  const chip = (j) => `<div class="calchip" draggable="true" data-job="${j.id}" style="font-size:11px;background:${j.status === '취소' ? 'var(--line)' : j.status === '완료' ? 'rgba(31,157,99,.18)' : 'rgba(28,96,214,.16)'};border-radius:4px;padding:1px 3px;margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;${j.status === '취소' ? 'text-decoration:line-through' : ''};touch-action:none">${tIcon(j.type)}${esc((j.scheduledAt || '').slice(11, 16))} ${esc(nameOf(cmap[j.customerId]).slice(0, 4))}</div>`;
  let cells = '';
  let title = '', prev, next;
  if (mode === 'month') {
    const [y, m] = base.split('-').map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), off = (first.getDay() + 6) % 7;
    title = `${y}년 ${m}월`;
    prev = nowISO(new Date(y, m - 2, 1)).slice(0, 10); next = nowISO(new Date(y, m, 1)).slice(0, 10);
    cells = '<div></div>'.repeat(off) + [...Array(days)].map((_, i) => { const d = `${y}-${pad(m)}-${pad(i + 1)}`; const off2 = isOfficeDay(cfg, d); return `<div class="calcell" data-day="${d}" style="border:1px solid var(--line);border-radius:8px;min-height:64px;padding:2px;${off2 ? 'background:rgba(245,196,66,.18);' : ''}${d === todayStr() ? 'outline:2px solid var(--blue);' : ''}"><div style="font-size:12px;display:flex;justify-content:space-between"><a href="#/cal?v=week&d=${d}" style="color:inherit">${i + 1}</a>${off2 ? '<span title="관리사무소 근무">🏢</span>' : ''}</div>${on(d).map(chip).join('')}${gOn(d).map((e) => gChip(e, d)).join('')}</div>`; }).join('');
  } else {
    const ws = weekStart(new Date(base + 'T00:00'));
    title = `${ws.slice(5)} 주`;
    prev = addD(ws, -7); next = addD(ws, 7);
    cells = [...Array(7)].map((_, i) => { const d = addD(ws, i); const off2 = isOfficeDay(cfg, d); return `<div class="calcell" data-day="${d}" style="border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:6px;${off2 ? 'background:rgba(245,196,66,.18);' : ''}${d === todayStr() ? 'outline:2px solid var(--blue);' : ''}"><div class="row spread"><b>${esc(fmtDate(d))}</b>${off2 ? '<span class="badge">🏢 관리사무소</span>' : ''}</div>
      ${on(d).map((j) => `<a class="item calchip" draggable="true" data-job="${j.id}" href="#/job/${j.id}" style="margin:6px 0 0;padding:8px;touch-action:none"><div class="row spread"><span>${tIcon(j.type)} ${esc((j.scheduledAt || '').slice(11, 16))} ${esc(nameOf(cmap[j.customerId]))}</span><span class="badge s-${j.status}">${esc(j.status)}</span></div><div class="muted">${esc([j.type, j.area].filter(Boolean).join(' · '))}</div></a>`).join('')}${gOn(d).map((e) => gItem(e, d)).join('')}${on(d).length || gOn(d).length ? '' : '<div class="muted" style="font-size:13px">없음</div>'}</div>`; }).join('');
  }
  view().innerHTML = `
    <div class="row spread" style="margin-bottom:8px"><a class="btn small" href="#/cal?v=${mode}&d=${prev}">‹</a><b>${title}</b><a class="btn small" href="#/cal?v=${mode}&d=${next}">›</a></div>
    <div class="chips"><a class="chip${mode === 'month' ? ' on' : ''}" href="#/cal?v=month&d=${base}">월</a><a class="chip${mode === 'week' ? ' on' : ''}" href="#/cal?v=week&d=${base}">주</a><a class="chip" href="#/cal?v=${mode}&d=${todayStr()}">오늘</a><a class="chip" href="#/bizset">🏢 근무일 설정</a>${sheetCfg.url && sheetCfg.key ? '<button class="chip" id="gcalBtn" type="button">📆 구글 캘린더 받기</button>' : ''}</div>
    <div class="muted" style="margin-bottom:6px;font-size:13px">작업을 길게 눌러 다른 날짜로 끌면 일정이 옮겨집니다. 📆 노란 일정은 구글 캘린더(보기 전용)${gmeta && gmeta.at ? ` · ${new Date(gmeta.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 받음` : ''}.</div>
    ${mode === 'month' ? `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">${['월', '화', '수', '목', '금', '토', '일'].map((d) => `<div class="muted" style="font-size:12px;text-align:center">${d}</div>`).join('')}${cells}</div>` : cells}`;
  enableCalDrag(cfg);
  view().querySelectorAll('[data-gcal]').forEach((a) => {
    a.onclick = (ev) => { ev.preventDefault(); const e = gevs.find((x) => x.id === a.dataset.gcal); if (e) gcalInfo(e); };
  });
  const gb = $('#gcalBtn');
  if (gb) gb.onclick = async () => {
    gb.disabled = true; gb.textContent = '받는 중…';
    try { toast(`구글 캘린더 ${await syncGcal()}건을 받았습니다`); render(); }
    catch (e) { alert('구글 캘린더 받기 실패: ' + (/옛 버전|새 버전/.test(e.message) ? '시트의 Apps Script를 v4 코드로 바꾸고 새 버전으로 배포해 주세요' : e.message)); gb.disabled = false; gb.textContent = '📆 구글 캘린더 받기'; }
  };
}
// weekStart·addD·buzz는 sport.js에 있는 것을 같이 쓴다

/* 끌어서 옮기기: 누르고 0.35초 지나 움직이면 끌기 시작(터치·마우스 공통) */
function enableCalDrag(cfg) {
  let drag = null, ghost = null, timer = null, startX = 0, startY = 0, over = null;
  const end = () => { clearTimeout(timer); if (ghost) ghost.remove(); ghost = null; if (over) over.style.boxShadow = ''; over = null; drag = null; };
  view().querySelectorAll('.calchip').forEach((el) => {
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      startX = e.clientX; startY = e.clientY;
      timer = setTimeout(() => {
        drag = el.dataset.job; buzz && buzz(30);
        ghost = el.cloneNode(true); Object.assign(ghost.style, { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', zIndex: 50, opacity: '.85', pointerEvents: 'none', width: el.offsetWidth + 'px' });
        document.body.appendChild(ghost);
      }, 350);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) { if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 10) clearTimeout(timer); return; }
      e.preventDefault();
      ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
      const t = document.elementFromPoint(e.clientX, e.clientY); const cell = t && t.closest('.calcell');
      if (over && over !== cell) over.style.boxShadow = '';
      if (cell) { cell.style.boxShadow = '0 0 0 3px var(--gold) inset'; over = cell; }
    });
    el.addEventListener('pointerup', async (e) => {
      if (!drag) { clearTimeout(timer); return; }
      e.preventDefault();
      const id = drag, cell = over; end();
      if (!cell) return;
      const d = cell.dataset.day;
      const j = await DB.get('jobs', id);
      const old = (j.scheduledAt || '').slice(0, 10);
      if (d === old) return;
      const time = (j.scheduledAt || '').slice(11, 16) || '10:00';
      if (isOfficeDay(cfg, d) && !confirm(`${fmtDate(d)}은 관리사무소 근무일입니다. 그래도 옮길까요?`)) return;
      await DB.put('jobs', { ...j, scheduledAt: `${d}T${time}`, status: j.status === '접수' || j.status === '견적' ? '예약' : j.status, updatedAt: nowISO() });
      toast(`${fmtDate(d)}로 옮겼습니다`); render();
    });
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (e) => { if (ghost) e.preventDefault(); });
  });
}

/* ───────── 고객 상세(타임라인·다음 연락일) ───────── */
async function viewCustomer(id) {
  const c = await DB.get('customers', id);
  setTitle(c ? nameOf(c) : '고객', true);
  if (!c) { view().innerHTML = '<div class="empty">고객을 찾을 수 없습니다.</div>'; return; }
  const [jobs, pays] = await Promise.all([DB.by('jobs', 'customerId', id), DB.all('payments')]);
  const jp = pays.filter((p) => jobs.some((j) => j.id === p.jobId));
  const total = jp.reduce((a, p) => a + (+p.amount || 0), 0);
  const unpaid = jobs.filter((j) => j.status === '완료').reduce((a, j) => a + Math.max(0, (+j.quote || 0) - paidOf(j.id, pays)), 0);
  const ev = [
    ...jobs.map((j) => ({ d: (j.scheduledAt || j.createdAt || '').slice(0, 10), html: `<a href="#/job/${j.id}" style="color:inherit">${tIcon(j.type)} <b>${esc(j.type || '작업')}</b> <span class="badge s-${j.status}">${esc(j.status)}</span>${j.quote ? ' · ' + won(j.quote) : ''}<div class="muted">${esc([j.product, j.area].filter(Boolean).join(' · '))}</div></a>` })),
    ...jp.map((p) => ({ d: p.date, html: `💰 입금 ${won(p.amount)} <span class="muted">${esc(p.method || '')}</span>` })),
  ].sort((a, b) => (b.d || '').localeCompare(a.d || ''));
  const photos = [];
  for (const j of jobs) photos.push(...(await DB.by('photos', 'jobId', j.id)));
  const ph = photos.slice(-9);
  const urls = ph.map((p) => URL.createObjectURL(p.blob));
  view().innerHTML = `
    <div class="card"><div style="font-size:20px;font-weight:800">${esc(nameOf(c))}</div>
      <div class="muted">${esc([prettyPhone(c.phone), c.area, c.address].filter(Boolean).join(' · '))}</div>
      <div class="grid2" style="margin-top:8px"><div><div class="muted">누적 결제</div><b>${won(total)}</b></div><div><div class="muted">미수금</div><b style="color:${unpaid ? 'var(--red)' : 'inherit'}">${won(unpaid)}</b></div></div>
      <div class="row wrap" style="margin-top:8px">${contactBtns(c)}${mapLinks([c.area, c.address].filter(Boolean).join(' '))}<a class="btn small primary" href="#/job/new?c=${c.id}">+ 새 작업</a></div></div>
    <div class="card"><div class="grid2"><div><label for="c_next">다음 연락일</label><input id="c_next" type="date" value="${esc(c.nextContact)}"></div><div><label for="c_cm">연락 이유</label><input id="c_cm" value="${esc(c.contactMemo)}" placeholder="예: 봄 방충망 점검"></div></div>
      <div class="grid2" style="margin-top:8px"><div><label for="c_nm">이름</label><input id="c_nm" value="${esc(c.name)}"></div><div><label for="c_co">업체명</label><input id="c_co" value="${esc(c.company)}"></div>
        <div><label for="c_ph">전화</label><input id="c_ph" type="tel" value="${esc(prettyPhone(c.phone))}"></div><div><label for="c_gr">묶음</label><input id="c_gr" value="${esc(c.group)}" placeholder="고객·거래처 등"></div></div>
      <label for="c_ad">주소</label><input id="c_ad" value="${esc(c.address)}">
      <label for="c_ca">업종</label><input id="c_ca" value="${esc(c.category)}">
      <label for="c_memo">고객 메모</label><textarea id="c_memo" rows="2">${esc(c.memo)}</textarea>
      <button class="btn block" id="c_save" type="button" style="margin-top:8px">💾 저장</button></div>
    ${ph.length ? `<div class="card"><h2>사진</h2><div class="photos">${ph.map((p, i) => `<div class="photo"><img src="${urls[i]}" alt=""><span>${esc(p.kind || '')}</span></div>`).join('')}</div></div>` : ''}
    <div class="card"><h2>작업 이력</h2>${ev.map((x) => `<div style="border-left:3px solid var(--blue);padding:4px 0 10px 10px;margin-left:4px"><div class="muted" style="font-size:12px">${esc(x.d)}</div>${x.html}</div>`).join('') || '<div class="muted">없음</div>'}</div>
    <button class="btn danger block" id="delCust" type="button">고객 삭제</button>`;
  $('#c_save').onclick = async () => { await DB.put('customers', { ...c, name: $('#c_nm').value.trim(), company: $('#c_co').value.trim(), phone: digits($('#c_ph').value), group: $('#c_gr').value.trim(), address: $('#c_ad').value.trim(), category: $('#c_ca').value.trim(), nextContact: $('#c_next').value, contactMemo: $('#c_cm').value.trim(), memo: $('#c_memo').value.trim(), updatedAt: nowISO() }); toast('저장했습니다'); };
  $('#delCust').onclick = async () => {
    if (jobs.length) { toast('작업이 남아 있어 지울 수 없습니다. 작업을 먼저 지우세요.'); return; }
    if (confirm('이 고객을 지울까요?')) { await DB.del('customers', id); location.replace('#/customers'); }
  };
}

/* ───────── 장부(수입·지출·미수금·순이익) ───────── */
async function viewLedger() {
  setTitle('장부', true);
  const [jobs, pays, exps, custs] = await Promise.all([DB.all('jobs'), DB.all('payments'), DB.all('expense'), DB.all('customers')]);
  const jmap = Object.fromEntries(jobs.map((j) => [j.id, j])), cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  let ym = sessionStorage.getItem('ledgerM') || monthStr();
  const draw = () => {
    const inM = (d) => (d || '').startsWith(ym);
    const P = pays.filter((p) => inM(p.date)), E = exps.filter((x) => inM(x.date));
    const inc = P.reduce((a, p) => a + (+p.amount || 0), 0), out = E.reduce((a, x) => a + (+x.amount || 0), 0);
    // 작업 종류별: 수입(입금) − 그 작업에 연결한 지출
    const byT = {};
    P.forEach((p) => { const k = typeKey((jmap[p.jobId] || {}).type); (byT[k] = byT[k] || { inc: 0, exp: 0 }).inc += +p.amount || 0; });
    E.forEach((x) => { const k = x.jobId ? typeKey((jmap[x.jobId] || {}).type) : '공통'; (byT[k] = byT[k] || { inc: 0, exp: 0 }).exp += +x.amount || 0; });
    const unpaid = jobs.filter((j) => j.status === '완료').map((j) => ({ j, left: (+j.quote || 0) - paidOf(j.id, pays) })).filter((x) => x.left > 0);
    view().innerHTML = `
      <div class="row" style="margin-bottom:10px"><input type="month" id="lg_m" value="${ym}" style="flex:1"><a class="btn small" href="#/rcpt">🧾 영수증</a><a class="btn small primary" href="#/exp/new">+ 지출</a></div>
      <div class="card hero"><div class="grid2" style="grid-template-columns:repeat(3,1fr)"><div><div class="muted">수입</div><b style="font-size:19px">${won(inc)}</b></div><div><div class="muted">지출</div><b style="font-size:19px">${won(out)}</b></div><div><div class="muted">순이익</div><b style="font-size:19px">${won(inc - out)}</b></div></div></div>
      <div class="card"><h2>작업 종류별</h2><table><thead><tr><th>종류</th><th class="r">수입</th><th class="r">지출</th><th class="r">순이익</th></tr></thead><tbody>
        ${Object.entries(byT).map(([k, v]) => `<tr><td>${TYPE_ICON[k] || '📦'} ${esc(k)}</td><td class="r">${won(v.inc)}</td><td class="r">${won(v.exp)}</td><td class="r"><b>${won(v.inc - v.exp)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">기록 없음</td></tr>'}</tbody></table>
        <div class="muted" style="font-size:12px;margin-top:6px">지출을 작업에 연결하면 그 종류의 순이익에, 연결하지 않으면 '공통'에 들어갑니다.</div></div>
      <div class="card"><h2>미수금 ${unpaid.length}건 · ${won(unpaid.reduce((a, x) => a + x.left, 0))}</h2>${unpaid.map(({ j, left }) => `<a class="item row spread" href="#/job/${j.id}"><span>${tIcon(j.type)} ${esc(nameOf(cmap[j.customerId]))} · ${esc(j.type || '')}</span><b style="color:var(--red)">${won(left)}</b></a>`).join('') || '<div class="muted">없음</div>'}</div>
      <div class="card"><h2>수입 ${P.length}</h2>${P.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((p) => { const j = jmap[p.jobId] || {}; return `<a class="item row spread" href="#/job/${p.jobId}"><span>${esc(fmtDate(p.date))} ${tIcon(j.type)} ${esc(nameOf(cmap[j.customerId]))} <span class="muted">${esc(p.method || '')}</span></span><b>${won(p.amount)}</b></a>`; }).join('') || '<div class="muted">없음</div>'}</div>
      <div class="card"><h2>지출 ${E.length}</h2>${E.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((x) => `<a class="item row spread" href="#/exp/${x.id}"><span>${esc(fmtDate(x.date))} <span class="badge">${esc(x.cat)}</span> ${esc(x.memo || '')}${x.jobId && jmap[x.jobId] ? ` <span class="muted">→ ${esc(nameOf(cmap[jmap[x.jobId].customerId]))}</span>` : ''}</span><b>${won(x.amount)}</b></a>`).join('') || '<div class="muted">없음</div>'}</div>
      <div class="card"><h2>종합소득세용 엑셀</h2><div class="row"><select id="lg_y" style="flex:1">${[...new Set([ym.slice(0, 4), String(new Date().getFullYear() - 1)])].map((y) => `<option>${y}</option>`).join('')}</select><button class="btn" id="lg_csv" type="button">⬇ 연간 수입·지출 CSV</button></div></div>`;
    $('#lg_m').onchange = (e) => { ym = e.target.value; sessionStorage.setItem('ledgerM', ym); draw(); };
    $('#lg_csv').onclick = () => {
      const y = $('#lg_y').value;
      const rows = [['구분', '날짜', '분류', '내용', '금액', '결제수단', '연결 작업']];
      pays.filter((p) => (p.date || '').startsWith(y)).forEach((p) => { const j = jmap[p.jobId] || {}; rows.push(['수입', p.date, typeKey(j.type), `${nameOf(cmap[j.customerId])} ${j.type || ''}`, p.amount, p.method || '', j.area || '']); });
      exps.filter((x) => (x.date || '').startsWith(y)).forEach((x) => { const j = jmap[x.jobId] || {}; rows.push(['지출', x.date, x.cat, x.memo || '', x.amount, x.method || '', j.type ? `${nameOf(cmap[j.customerId])} ${j.type}` : '']); });
      rows.splice(1, 0, ...rows.splice(1).sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
      csvDownload(`장부-${y}.csv`, rows);
    };
  };
  draw();
}
async function viewExpense(id) {
  const [x0, jobs, custs] = await Promise.all([id ? DB.get('expense', id) : null, DB.all('jobs'), DB.all('customers')]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const x = x0 || { date: todayStr(), cat: '자재', method: '카드' };
  setTitle(x0 ? '지출' : '지출 추가', true);
  const recent = jobs.filter((j) => j.status !== '취소').sort((a, b) => (b.scheduledAt || b.createdAt || '').localeCompare(a.scheduledAt || a.createdAt || '')).slice(0, 30);
  let photo = null;
  view().innerHTML = `<form class="card" id="xf" autocomplete="off">
    <div class="grid2"><div><label for="x_date">날짜</label><input id="x_date" type="date" value="${esc(x.date)}"></div><div><label for="x_cat">분류</label><select id="x_cat">${opts(EXP_CATS, x.cat)}</select></div></div>
    <div class="grid2"><div><label for="x_amt">금액(원)</label><input id="x_amt" type="number" inputmode="numeric" value="${esc(x.amount)}"></div><div><label for="x_m">결제</label><select id="x_m">${opts(['카드', '현금', '계좌이체'], x.method)}</select></div></div>
    <label for="x_memo">내용</label><input id="x_memo" value="${esc(x.memo)}" placeholder="예: SSD 1TB, 주유">
    <label for="x_job">연결 작업(선택)</label><select id="x_job"><option value="">없음(공통)</option>${recent.map((j) => `<option value="${j.id}"${j.id === x.jobId ? ' selected' : ''}>${esc((j.scheduledAt || j.createdAt || '').slice(5, 10))} ${tIcon(j.type)} ${esc(nameOf(cmap[j.customerId]))} ${esc(j.type || '')}</option>`).join('')}</select>
    <label class="btn" style="margin:10px 0 0;color:var(--ink)">🧾 영수증 사진<input id="x_ph" type="file" accept="image/*" capture="environment" hidden></label> <span class="muted" id="x_phn"></span>
    <div class="photos" id="x_photos" style="margin-top:8px"></div>
    <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button></form>
    ${x0 ? '<button class="btn danger block" id="x_del" type="button">삭제</button>' : ''}`;
  $('#x_ph').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { photo = await shrink(f, 1600, 0.8); $('#x_phn').textContent = '사진 1장 추가'; } catch (er) { toast(er.message); } } };
  if (x0) { const ps = await DB.by('photos', 'jobId', x0.id); $('#x_photos').innerHTML = ps.map((p) => `<div class="photo"><img src="${URL.createObjectURL(p.blob)}" alt="영수증"></div>`).join(''); }
  $('#xf').onsubmit = async (e) => {
    e.preventDefault();
    if (!+$('#x_amt').value) { toast('금액을 넣어 주세요'); return; }
    const rec = { ...(x0 || { id: uid(), createdAt: nowISO() }), date: $('#x_date').value, cat: $('#x_cat').value, amount: +$('#x_amt').value, method: $('#x_m').value, memo: $('#x_memo').value.trim(), jobId: $('#x_job').value, updatedAt: nowISO() };
    await DB.put('expense', rec);
    if (photo) await DB.put('photos', { id: uid(), jobId: rec.id, kind: '영수증', blob: photo, createdAt: nowISO() });
    toast('저장했습니다'); location.replace('#/ledger');
  };
  if (x0) $('#x_del').onclick = async () => { if (confirm('이 지출을 지울까요?')) { for (const p of await DB.by('photos', 'jobId', x0.id)) await DB.del('photos', p.id); await DB.del('expense', x0.id); location.replace('#/ledger'); } };
}

/* 사진 위에 손상 부위 표시(빨간 펜) → 새 사진으로 저장 */
async function markPhoto(p, after) {
  const img = await new Promise((res, rej) => { const u = URL.createObjectURL(p.blob); const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
  const v = document.createElement('div'); v.className = 'viewer';
  v.innerHTML = `<canvas style="flex:1;width:100%;min-height:0;touch-action:none"></canvas><div class="row"><button class="btn small" data-a="close" type="button">취소</button><button class="btn small" data-a="undo" type="button">되돌리기</button><button class="btn small primary" data-a="save" type="button">표시 저장</button></div>`;
  document.body.appendChild(v);
  const cv = v.querySelector('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const g = cv.getContext('2d'); const strokes = [];
  const paint = () => { g.drawImage(img, 0, 0); g.strokeStyle = '#ff2a2a'; g.lineWidth = Math.max(6, cv.width / 120); g.lineCap = 'round'; g.lineJoin = 'round'; strokes.forEach((s) => { g.beginPath(); s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }); };
  paint();
  const pt = (e) => { const r = cv.getBoundingClientRect(); const s = Math.min(r.width / cv.width, r.height / cv.height); const ox = (r.width - cv.width * s) / 2, oy = (r.height - cv.height * s) / 2; return [(e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s]; };
  cv.style.objectFit = 'contain';
  let cur = null;
  cv.onpointerdown = (e) => { cur = [pt(e)]; strokes.push(cur); };
  cv.onpointermove = (e) => { if (cur) { cur.push(pt(e)); paint(); } };
  cv.onpointerup = () => { cur = null; };
  v.querySelector('[data-a=close]').onclick = () => v.remove();
  v.querySelector('[data-a=undo]').onclick = () => { strokes.pop(); paint(); };
  v.querySelector('[data-a=save]').onclick = () => cv.toBlob(async (b) => { await DB.put('photos', { id: uid(), jobId: p.jobId, kind: (p.kind || '') + ' 표시', blob: b, createdAt: nowISO() }); v.remove(); toast('표시한 사진을 저장했습니다'); after && after(); }, 'image/jpeg', 0.85);
}
