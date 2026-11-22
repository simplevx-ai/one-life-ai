/* ONE LIFE AI — 관리사무소 모듈
 * 시설 점검·이상·민원·업체 작업 기록, 음성 자동 정리(규칙 기반), 정기점검 알림, 업무 일지, 인수인계, 공지 도우미.
 * app.js보다 먼저 불러오며, 함수 안에서만 app.js의 DB·도우미를 쓴다.
 */
'use strict';

const OFFICE_KINDS = ['점검·이상', '민원', '업체 작업', '일반 업무'];
const OFFICE_CATS = ['기계', '전기', '소방', '승강기', '건축', '미화', '보안·주차', '기타'];
const OFFICE_STATUS = ['이상 발견', '정상', '조치 중', '조치 완료'];
const OFFICE_ACTIONS = ['업체 점검 요청', '수리 필요', '교체 필요', '추가 확인', '청소 요청', '조치 검토', '조치 완료', '없음'];
const CYCLES = { '매일': 1, '매주': 7, '2주': 14, '매월': 30, '분기': 91, '반기': 182, '매년': 365 };

/* ───────── 자동 정리(규칙 기반) ─────────
 * 말한 문장에서 분류·위치·상태·조치·처리 상태·후속 일정을 뽑는다. 결과는 사용자가 고칠 수 있다.
 */
const CAT_WORDS = {
  '기계': ['배수펌프', '펌프', '급수', '배수', '배관', '누수', '보일러', '공조', '환기', '물탱크', '저수조', '기계실', '오수', '정화조', '밸브', '수도', '역류', '집수정'],
  '전기': ['전기', '조명', '전등', '등기구', '분전반', '콘센트', '누전', '정전', '변압기', '전기실', '발전기', '형광등', 'LED', '전구', '배선', '수변전', '센서등', '비상등', '보안등', '가로등'],
  '소방': ['소방', '소화기', '소화전', '스프링클러', '감지기', '화재', '유도등', '비상벨', '방화문', '수신기', '제연', '피난'],
  '승강기': ['승강기', '엘리베이터', '호기', '카 내부'],
  '건축': ['균열', '크랙', '도장', '방수', '옥상', '외벽', '유리', '타일', '천장', '벽체', '문짝', '도어', '난간', '창호', '보도블록'],
  '미화': ['청소', '쓰레기', '분리수거', '오물', '미화', '낙엽'],
  '보안·주차': ['CCTV', 'cctv', '주차', '출입', '경비', '방범', '주차차단기', '번호인식'],
};
const LOC_RE = /(지하\s*\d+\s*층|B\s*\d+\s*층?|지상\s*\d+\s*층|\d+\s*층|옥상|기계실|전기실|발전기실|펌프실|저수조실|지하\s*주차장|주차장|관리사무소|경비실|놀이터|커뮤니티|피트니스|분리수거장|쓰레기장|\d+\s*동(?:\s*\d+\s*호)?|\d+\s*호기|계단실|계단|복도|현관|로비|정문|후문|화단|조경)/g;
const BAD_RE = /(누수|파손|고장|이상\s*발견|이상\s*있|흔적|균열|크랙|불량|소음|냄새|악취|막힘|막혔|녹\s|부식|작동\s*안|안\s*됨|안\s*돼|깨짐|깨졌|떨어|꺼짐|꺼져|점멸|침수|물\s*고임|새는|샌다|누전|정전)/;
const VENDOR_RE = /([가-힣A-Za-z0-9]{2,}(?:설비|전기|소방|엘리베이터|승강기|건설|산업|기술|테크|ENG|이엔지))(?=\s|$|에|와|과|이|가|을|를|,|\.)/;
const OK_RE = /(정상|이상\s*없)/;
const DONE_RE = /(완료|교체함|교체했|교체\s*완료|수리함|수리했|조치함|조치했|해결)/;

function addDays(n, from = new Date()) {
  const d = new Date(from); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function autoOrganize(text) {
  const t = String(text || '');
  // 분류: 단어가 가장 많이 나온 쪽
  let cat = '기타', best = 0;
  for (const [c, words] of Object.entries(CAT_WORDS)) {
    const n = words.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0);
    if (n > best) { best = n; cat = c; }
  }
  // 위치: 나온 순서대로 이어 붙임
  const locs = [];
  for (const m of t.matchAll(LOC_RE)) {
    const v = m[0].replace(/\s+/g, ' ').replace(/(지하|지상)\s?(\d+)\s?층/, '$1 $2층').replace(/(\d+)\s+층/, '$1층').trim();
    if (!locs.some((x) => x.includes(v) || v.includes(x))) locs.push(v);
  }
  const loc = locs.join(' ');
  // 상태
  let status = '이상 발견';
  if (DONE_RE.test(t)) status = '조치 완료';
  else if (BAD_RE.test(t)) status = '이상 발견';
  else if (OK_RE.test(t)) status = '정상';
  // 조치
  let action = '조치 검토';
  if (status === '조치 완료') action = '조치 완료';
  else if (status === '정상') action = '없음';
  else if (/업체|연락|불러|AS|A\/S/.test(t) || VENDOR_RE.test(t)) action = '업체 점검 요청';
  else if (/교체/.test(t)) action = '교체 필요';
  else if (/수리|보수/.test(t)) action = '수리 필요';
  else if (/확인\s*(필요|요망|해야)/.test(t)) action = '추가 확인';
  else if (/청소/.test(t)) action = '청소 요청';
  const done = status === '조치 완료' || status === '정상';
  // 후속 일정: 업체·확인·수리·교체가 필요하면 3일 뒤로 제안
  const due = !done && /업체|확인|수리|교체/.test(action) ? addDays(3) : '';
  // 종류
  let kind = '점검·이상';
  if (/민원|입주민|세대에서|호\s*에서|호에서|호\s*요청/.test(t)) kind = '민원';
  else if (/업체.*(작업|시공|교체|수리)\s*(완료|함|했)/.test(t)) kind = '업체 작업';
  // 업체명 추정: 'OO설비', 'OO엘리베이터' 등
  const vm = t.match(VENDOR_RE);
  // 민원 세대: '101동 1203호'
  const um = t.match(/\d+\s*동\s*\d+\s*호/);
  return { kind, cat, loc, status, action, done, due, vendor: vm ? vm[1] : '', unit: um ? um[0].replace(/\s+/g, ' ') : '' };
}

/* ───────── 관리사무소 홈 ───────── */
async function officeData() {
  const [recs, scheds, tasks] = await Promise.all([DB.all('office'), DB.all('schedules'), DB.all('tasks')]);
  return { recs, scheds, tasks };
}
function schedNext(s) {
  if (!s.lastDone) return s.firstDue || todayStr();
  return addDays(CYCLES[s.cycle] || 30, new Date(s.lastDone + 'T00:00'));
}
function officeAlerts(recs, scheds) {
  const today = todayStr(), soon = addDays(7);
  const open = recs.filter((r) => !r.done);
  return {
    open,
    late: open.filter((r) => r.due && r.due < today),
    dueToday: open.filter((r) => r.due === today),
    schedDue: scheds.map((s) => ({ ...s, next: schedNext(s) })).filter((s) => s.next <= soon).sort((a, b) => a.next.localeCompare(b.next)),
  };
}

function recLine(r) {
  const today = todayStr();
  const badge = r.done ? '<span class="badge s-완료">완료</span>' : `<span class="badge ${r.due && r.due < today ? '' : 's-예약'}" style="${r.due && r.due < today ? 'color:var(--red)' : ''}">${r.due ? '기한 ' + esc(fmtDate(r.due)) : '미완료'}</span>`;
  return `<a class="item" href="#/orec/${r.id}"><div class="row spread"><span class="t">${esc(r.loc || r.unit || '위치 미입력')}</span>${badge}</div>
    <div class="muted">${esc([r.kind, r.cat, r.status, r.action].filter(Boolean).join(' · '))}</div>
    <div style="font-size:14px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(r.text)}</div></a>`;
}

async function viewOffice() {
  setTitle('관리사무소', true);
  const { recs, scheds } = await officeData();
  const al = officeAlerts(recs, scheds);
  const today = todayStr();
  const todayCnt = recs.filter((r) => (r.createdAt || '').slice(0, 10) === today).length;
  const openSorted = al.open.sort((a, b) => (a.due || '9').localeCompare(b.due || '9') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  view().innerHTML = `
    <div class="grid2" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
      <a class="stat ${al.late.length ? 'warn' : ''}" href="#/orecs" style="text-decoration:none;color:inherit"><span class="muted">미처리</span><b>${al.open.length}</b></a>
      <a class="stat" href="#/odiary" style="text-decoration:none;color:inherit"><span class="muted">오늘 기록</span><b>${todayCnt}</b></a>
      <a class="stat ${al.schedDue.some((s) => s.next <= today) ? 'warn' : ''}" href="#/sched" style="text-decoration:none;color:inherit"><span class="muted">정기점검 7일</span><b>${al.schedDue.length}</b></a>
    </div>
    <a class="btn primary block" href="#/orec/new?m=voice" style="min-height:56px;font-size:17px">🎤 점검·이상 기록 (말하면 자동 정리)</a>
    <div class="grid2" style="margin:8px 0 12px">
      <a class="btn" href="#/orec/new?k=민원">📝 민원 접수</a>
      <a class="btn" href="#/orec/new?k=업체 작업">🏗 업체 작업</a>
      <a class="btn" href="#/orec/new?m=photo">📷 사진부터</a>
      <a class="btn" href="#/orec/new?k=일반 업무">✏️ 일반 업무</a>
    </div>
    ${al.schedDue.length ? `<div class="card ${al.schedDue.some((s) => s.next <= today) ? 'warnbox' : ''}"><div class="row spread"><h2 style="margin:0">🗓 정기점검 알림</h2><a class="btn small" href="#/sched">전체 ›</a></div>
      ${al.schedDue.map((s) => `<a class="item" href="#/sched" style="padding:9px 12px"><b>${esc(fmtDate(s.next))}</b> ${s.next < today ? '<span style="color:var(--red)">(지남)</span>' : s.next === today ? '<span style="color:var(--red)">(오늘)</span>' : ''} · ${esc(s.name)} <span class="muted">${esc(s.cat)} · ${esc(s.cycle)}</span></a>`).join('')}</div>` : ''}
    <div class="card"><div class="row spread"><h2 style="margin:0">⏳ 미처리 업무</h2><a class="btn small" href="#/orecs">전체 기록 ›</a></div>
      <div style="margin-top:8px">${openSorted.slice(0, 15).map(recLine).join('') || '<div class="muted">미처리 업무가 없습니다.</div>'}</div></div>
    <div class="card"><h2>도구</h2>
      <div class="tiles">
        <a class="tile" href="#/odiary"><i>📒</i>업무 일지</a>
        <a class="tile" href="#/handover"><i>🤝</i>인수인계</a>
        <a class="tile" href="#/notice"><i>📢</i>공지 도우미</a>
        <a class="tile" href="#/sched"><i>🗓</i>정기점검</a>
        <a class="tile" href="#/orecs?k=업체 작업"><i>🏗</i>업체 이력</a>
        <a class="tile" href="#/orecs?k=민원"><i>📝</i>민원 현황</a>
      </div></div>`;
}

/* ───────── 기록 목록 ───────── */
async function viewOfficeRecs() {
  setTitle('관리사무소 기록', true);
  const recs = (await DB.all('office')).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
  let kind = qs.get('k') || '전체', state = '미처리', q = '';
  function draw() {
    const list = recs.filter((r) => (kind === '전체' || r.kind === kind) && (state === '전체' || (state === '미처리' ? !r.done : r.done))
      && (!q || [r.text, r.loc, r.cat, r.vendor, r.unit].join(' ').toLowerCase().includes(q)));
    $('#recList').innerHTML = list.map(recLine).join('') || '<div class="empty">해당 기록이 없습니다.</div>';
    document.querySelectorAll('#kChips .chip').forEach((c) => c.classList.toggle('on', c.dataset.v === kind));
    document.querySelectorAll('#sChips .chip').forEach((c) => c.classList.toggle('on', c.dataset.v === state));
    if (kind === '업체 작업') {
      const by = {};
      recs.filter((r) => r.kind === '업체 작업').forEach((r) => { const v = r.vendor || '업체명 미입력'; by[v] = (by[v] || 0) + 1; });
      $('#vendorBox').innerHTML = Object.keys(by).length ? `<div class="card"><h2>업체별 작업 수</h2>${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([v, n]) => `<div class="row spread"><span>${esc(v)}</span><b>${n}건</b></div>`).join('')}</div>` : '';
    } else $('#vendorBox').innerHTML = '';
  }
  view().innerHTML = `
    <input id="q" type="search" placeholder="내용·위치·업체·세대 검색" style="margin-bottom:10px">
    <div class="chips" id="kChips">${['전체', ...OFFICE_KINDS].map((v) => `<button class="chip" data-v="${v}">${v}</button>`).join('')}</div>
    <div class="chips" id="sChips">${['미처리', '완료', '전체'].map((v) => `<button class="chip" data-v="${v}">${v}</button>`).join('')}</div>
    <div id="vendorBox"></div>
    <div id="recList"></div>`;
  $('#kChips').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { kind = b.dataset.v; draw(); } };
  $('#sChips').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { state = b.dataset.v; draw(); } };
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
  fab('#/orec/new?m=voice');
}

/* ───────── 기록 입력·상세 ───────── */
async function viewOfficeRec(id) {
  const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
  const mode = qs.get('m');
  const rec = id ? await DB.get('office', id) : null;
  if (id && !rec) { setTitle('기록', true); view().innerHTML = '<div class="empty">기록을 찾을 수 없습니다.</div>'; return; }
  const r = rec || { kind: qs.get('k') || '점검·이상', cat: '기타', status: qs.get('k') === '민원' ? '조치 중' : '이상 발견', action: '조치 검토', done: false };
  setTitle(rec ? '관리사무소 기록' : '새 기록', true);
  const pending = []; // 저장 전에 찍은 사진
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  view().innerHTML = `
    <div class="card">
      <label for="o_text">내용 (말하거나 적고 '자동 정리')</label>
      <textarea id="o_text" rows="4" placeholder="예: 지하 2층 주차장 배수펌프 주변 누수 흔적 확인. 점검업체 확인 필요.">${esc(r.text)}</textarea>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn" id="o_mic" type="button">🎤 말로 입력</button>
        <button class="btn primary" id="o_auto" type="button">✨ 자동 정리</button>
      </div>
      <div id="o_micState" class="muted" style="margin-top:6px"></div>
    </div>
    <form id="o_form" class="card" autocomplete="off">
      <div class="grid2">
        <div><label for="o_kind">종류</label><select id="o_kind">${opts(OFFICE_KINDS, r.kind)}</select></div>
        <div><label for="o_cat">업무 분류</label><select id="o_cat">${opts(OFFICE_CATS, r.cat)}</select></div>
      </div>
      <label for="o_loc">위치</label>
      <input id="o_loc" value="${esc(r.loc)}" placeholder="예: 지하 2층 주차장">
      <div class="grid2">
        <div><label for="o_status">상태</label><select id="o_status">${opts(OFFICE_STATUS, r.status)}</select></div>
        <div><label for="o_action">조치</label><select id="o_action">${opts(OFFICE_ACTIONS.includes(r.action) || !r.action ? OFFICE_ACTIONS : [...OFFICE_ACTIONS, r.action], r.action)}</select></div>
      </div>
      <div class="grid2">
        <div><label for="o_done">처리 상태</label><select id="o_done">${opts(['미완료', '완료'], r.done ? '완료' : '미완료')}</select></div>
        <div><label for="o_due">후속 일정(기한)</label><input id="o_due" type="date" value="${esc(r.due)}"></div>
      </div>
      <div class="grid2">
        <div><label for="o_vendor">업체</label><input id="o_vendor" value="${esc(r.vendor)}" placeholder="예: OO설비"></div>
        <div><label for="o_unit">세대(민원)</label><input id="o_unit" value="${esc(r.unit)}" placeholder="예: 101동 1203호"></div>
      </div>
      <label for="o_result">조치 결과·메모</label>
      <textarea id="o_result" rows="2" placeholder="예: 11/25 OO설비 방문, 패킹 교체">${esc(r.result)}</textarea>
      <div class="row spread" style="margin-top:12px"><h2 style="margin:0">사진</h2><span class="muted" id="o_pcount"></span></div>
      <div class="row" style="margin-top:6px">
        <label class="btn" style="margin:0;color:var(--ink)">📷 촬영<input id="o_cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn" style="margin:0;color:var(--ink)">🖼 앨범<input id="o_alb" type="file" accept="image/*" multiple hidden></label>
      </div>
      <div class="photos" id="o_photos" style="margin-top:8px"></div>
      <label class="row" style="margin-top:12px;color:var(--ink);font-size:15px"><input type="checkbox" id="o_addTask" style="width:22px;min-height:22px;flex:none"> 기한 날 체크리스트에도 추가</label>
      <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button>
    </form>
    ${rec ? '<button class="btn danger block" id="o_del" type="button">기록 삭제</button>' : ''}`;

  // 사진
  const urls = [];
  async function drawPhotos() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const saved = rec ? await DB.by('photos', 'jobId', rec.id) : [];
    const all = [...saved.map((p) => ({ p, saved: true })), ...pending.map((b, i) => ({ p: { blob: b, kind: '새 사진', i }, saved: false }))];
    $('#o_pcount').textContent = all.length ? `${all.length}장` : '';
    $('#o_photos').innerHTML = '';
    all.forEach(({ p, saved }) => {
      const u = URL.createObjectURL(p.blob); urls.push(u);
      const d = document.createElement('div'); d.className = 'photo';
      d.innerHTML = `<img src="${u}" alt="현장 사진">${saved ? '' : '<span>저장 전</span>'}`;
      if (saved) d.onclick = () => openViewer(p, u, drawPhotos);
      else d.onclick = () => { if (confirm('이 사진을 뺄까요?')) { pending.splice(p.i, 1); drawPhotos(); } };
      $('#o_photos').appendChild(d);
    });
  }
  const addPhotos = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) { try { pending.push(await shrink(f, 1600, 0.82)); } catch (err) { toast(err.message); } }
    drawPhotos();
  };
  $('#o_cam').onchange = addPhotos;
  $('#o_alb').onchange = addPhotos;
  drawPhotos();

  // 자동 정리
  const applyAuto = () => {
    const a = autoOrganize($('#o_text').value);
    if (!$('#o_text').value.trim()) { toast('내용을 먼저 말하거나 적어 주세요'); return; }
    $('#o_kind').value = qs.get('k') && !rec ? qs.get('k') : a.kind;
    $('#o_cat').value = a.cat;
    if (a.loc) $('#o_loc').value = a.loc;
    $('#o_status').value = a.status;
    $('#o_action').value = a.action;
    $('#o_done').value = a.done ? '완료' : '미완료';
    $('#o_due').value = a.due;
    if (a.vendor) $('#o_vendor').value = a.vendor;
    if (a.unit) $('#o_unit').value = a.unit;
    $('#o_addTask').checked = !!a.due;
    toast('자동 정리했습니다. 틀린 곳은 고쳐 주세요');
  };
  $('#o_auto').onclick = applyAuto;

  // 음성
  let recg = null;
  $('#o_mic').onclick = () => {
    if (!SR) { toast('이 브라우저는 음성 입력을 지원하지 않습니다. 키보드의 🎤 버튼을 쓰세요'); $('#o_text').focus(); return; }
    if (recg) { recg.stop(); return; }
    recg = new SR();
    recg.lang = 'ko-KR'; recg.interimResults = true; recg.continuous = true;
    const base = $('#o_text').value;
    let fin = '';
    recg.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) fin += t + ' '; else interim += t;
      }
      $('#o_text').value = (base ? base + ' ' : '') + fin + interim;
    };
    recg.onstart = () => { $('#o_mic').textContent = '⏹ 그만 듣기'; $('#o_micState').textContent = '듣는 중… 다 말하면 그만 듣기를 누르세요'; };
    recg.onerror = (ev) => { $('#o_micState').textContent = ev.error === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '음성 인식 오류: ' + ev.error; };
    recg.onend = () => {
      recg = null; $('#o_mic').textContent = '🎤 말로 입력';
      if ($('#o_micState').textContent.startsWith('듣는 중')) $('#o_micState').textContent = '';
      if ($('#o_text').value.trim() && !rec) applyAuto(); // 말이 끝나면 바로 자동 정리
    };
    try { recg.start(); } catch { toast('음성 입력을 시작할 수 없습니다'); recg = null; }
  };

  $('#o_form').onsubmit = async (e) => {
    e.preventDefault();
    if (recg) recg.stop();
    const text = $('#o_text').value.trim();
    if (!text && !pending.length) { toast('내용이나 사진을 넣어 주세요'); return; }
    const now = new Date().toISOString();
    const done = $('#o_done').value === '완료';
    const data = {
      ...(rec || { id: uid(), createdAt: now }),
      text, kind: $('#o_kind').value, cat: $('#o_cat').value, loc: $('#o_loc').value.trim(), status: $('#o_status').value,
      action: $('#o_action').value, done, due: $('#o_due').value, vendor: $('#o_vendor').value.trim(), unit: $('#o_unit').value.trim(),
      result: $('#o_result').value.trim(), updatedAt: now,
    };
    if (done && !data.doneAt) data.doneAt = now;
    if (!done) data.doneAt = '';
    await DB.put('office', data);
    for (const b of pending) await DB.put('photos', { id: uid(), jobId: data.id, kind: '현장', blob: b, createdAt: now });
    if ($('#o_addTask').checked && data.due && !done) {
      await DB.put('tasks', { id: uid(), text: `${data.loc ? data.loc + ' ' : ''}${data.action !== '없음' ? data.action : '확인'}`.trim(), area: '관리사무소', date: data.due, done: false, createdAt: now, officeId: data.id });
    }
    toast('저장했습니다');
    location.replace(rec ? '#/orecs' : '#/office');
  };

  if (rec) {
    $('#o_del').onclick = async () => {
      if (!confirm('이 기록과 사진을 지울까요?')) return;
      for (const p of await DB.by('photos', 'jobId', rec.id)) await DB.del('photos', p.id);
      await DB.del('office', rec.id);
      location.replace('#/orecs');
    };
  }
  if (mode === 'voice' && !rec) setTimeout(() => $('#o_mic').click(), 300);
  if (mode === 'photo' && !rec) setTimeout(() => $('#o_cam').click(), 300);
}

/* ───────── 정기점검 ───────── */
const SCHED_EXAMPLES = [
  ['소방시설 자체점검', '소방', '매년'], ['승강기 정기검사', '승강기', '매년'], ['승강기 자체점검', '승강기', '매월'],
  ['전기설비 점검', '전기', '매월'], ['저수조 청소', '기계', '반기'], ['배수펌프 작동 점검', '기계', '매주'],
  ['소화기 압력 확인', '소방', '매월'], ['공용 조명 점검', '전기', '매주'],
];
async function viewSched() {
  setTitle('정기점검', true);
  const scheds = (await DB.all('schedules')).map((s) => ({ ...s, next: schedNext(s) })).sort((a, b) => a.next.localeCompare(b.next));
  const today = todayStr();
  view().innerHTML = `
    <div class="card">
      ${scheds.length ? scheds.map((s) => `<div class="item">
        <div class="row spread"><span class="t">${esc(s.name)}</span><b style="${s.next <= today ? 'color:var(--red)' : ''}">${esc(fmtDate(s.next))}${s.next < today ? ' 지남' : s.next === today ? ' 오늘' : ''}</b></div>
        <div class="muted">${esc(s.cat)} · ${esc(s.cycle)} · 마지막 ${s.lastDone ? esc(fmtDate(s.lastDone)) : '기록 없음'}${s.vendor ? ' · ' + esc(s.vendor) : ''}</div>
        <div class="row" style="margin-top:6px"><button class="btn small primary" data-done="${s.id}" type="button">✅ 오늘 점검함</button><button class="btn small danger" data-del="${s.id}" type="button">삭제</button></div>
      </div>`).join('') : '<div class="muted">등록된 정기점검이 없습니다. 아래에서 추가하세요.</div>'}
    </div>
    <form class="card" id="s_form" autocomplete="off">
      <h2>정기점검 추가</h2>
      <label for="s_name">점검 이름</label><input id="s_name" list="s_ex" placeholder="예: 저수조 청소">
      <datalist id="s_ex">${SCHED_EXAMPLES.map((x) => `<option value="${esc(x[0])}">`).join('')}</datalist>
      <div class="grid2">
        <div><label for="s_cat">분류</label><select id="s_cat">${opts(OFFICE_CATS)}</select></div>
        <div><label for="s_cycle">주기</label><select id="s_cycle">${opts(Object.keys(CYCLES), '매월')}</select></div>
      </div>
      <div class="grid2">
        <div><label for="s_first">다음 점검일</label><input id="s_first" type="date" value="${todayStr()}"></div>
        <div><label for="s_vendor">업체(선택)</label><input id="s_vendor"></div>
      </div>
      <div class="muted" style="margin-top:6px">법정 점검 주기는 단지 규모·계약에 따라 다를 수 있으니 실제 기준에 맞춰 넣으세요.</div>
      <button class="btn primary block" type="submit" style="margin-top:10px">+ 추가</button>
    </form>`;
  $('#s_name').oninput = (e) => {
    const ex = SCHED_EXAMPLES.find((x) => x[0] === e.target.value);
    if (ex) { $('#s_cat').value = ex[1]; $('#s_cycle').value = ex[2]; }
  };
  $('#s_form').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#s_name').value.trim();
    if (!name) { toast('점검 이름을 넣어 주세요'); return; }
    await DB.put('schedules', { id: uid(), name, cat: $('#s_cat').value, cycle: $('#s_cycle').value, firstDue: $('#s_first').value || todayStr(), lastDone: '', vendor: $('#s_vendor').value.trim(), createdAt: new Date().toISOString() });
    toast('추가했습니다'); render();
  };
  view().querySelectorAll('[data-done]').forEach((b) => {
    b.onclick = async () => {
      const s = await DB.get('schedules', b.dataset.done);
      const now = new Date().toISOString();
      await DB.put('schedules', { ...s, lastDone: todayStr() });
      await DB.put('office', { id: uid(), kind: '점검·이상', cat: s.cat, loc: '', text: `정기점검: ${s.name}`, status: '정상', action: '없음', done: true, doneAt: now, due: '', vendor: s.vendor || '', unit: '', result: '', createdAt: now, updatedAt: now, schedId: s.id });
      toast('점검 완료로 기록했습니다'); render();
    };
  });
  view().querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => { if (confirm('이 정기점검을 지울까요?')) { await DB.del('schedules', b.dataset.del); render(); } };
  });
}

/* ───────── 업무 일지(날짜별 자동 정리) ───────── */
async function viewDiary() {
  setTitle('업무 일지', true);
  const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
  const day = qs.get('d') || todayStr();
  const [recs, tasks, notes, scheds] = await Promise.all([DB.all('office'), DB.all('tasks'), DB.all('notes'), DB.all('schedules')]);
  const on = (s) => (s || '').slice(0, 10) === day;
  const made = recs.filter((r) => on(r.createdAt));
  const closed = recs.filter((r) => r.done && on(r.doneAt) && !on(r.createdAt));
  const tdone = tasks.filter((t) => t.area === '관리사무소' && t.done && (on(t.doneAt) || t.date === day));
  const nts = notes.filter((n) => n.tag === '관리사무소' && on(n.createdAt));
  const open = recs.filter((r) => !r.done);
  const line = (r) => `- [${r.cat}] ${locPrefix(r)}${r.text}${r.action && r.action !== '없음' ? ` → ${r.action}` : ''}${r.done ? ' (완료)' : r.due ? ` (기한 ${r.due.slice(5)})` : ''}`;
  const text = [
    `[업무 일지] ${day} ${WEEKDAYS[new Date(day + 'T00:00').getDay()]}`,
    '',
    `■ 점검·업무 기록 ${made.length}건`, ...made.map(line),
    ...(closed.length ? ['', `■ 처리 완료 ${closed.length}건`, ...closed.map((r) => `- ${locPrefix(r)}${r.text}${r.result ? ' / ' + r.result : ''}`)] : []),
    ...(tdone.length ? ['', '■ 완료한 할 일', ...tdone.map((t) => `- ${t.text}`)] : []),
    ...(nts.length ? ['', '■ 메모', ...nts.map((n) => `- ${(n.text || '').replace(/\n/g, ' ')}`)] : []),
    '', `■ 미처리 ${open.length}건`, ...open.slice(0, 20).map(line),
  ].join('\n');
  view().innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <a class="btn small" href="#/odiary?d=${addDays(-1, new Date(day + 'T00:00'))}">‹ 전날</a>
      <input type="date" id="d_day" value="${day}" style="flex:1">
      <a class="btn small" href="#/odiary?d=${addDays(1, new Date(day + 'T00:00'))}">다음날 ›</a>
    </div>
    <div class="card"><textarea id="d_text" rows="18" style="font-size:14px">${esc(text)}</textarea>
      <div class="muted">자동으로 만든 초안입니다. 고친 뒤 복사해서 일지 양식에 붙여넣으세요.</div>
      <button class="btn primary block" id="d_copy" type="button" style="margin-top:8px">📋 일지 복사</button></div>`;
  $('#d_day').onchange = (e) => { location.hash = `#/odiary?d=${e.target.value}`; };
  $('#d_copy').onclick = () => copyText($('#d_text').value);
}

/* ───────── 인수인계 ───────── */
async function viewHandover() {
  setTitle('인수인계', true);
  const [recs, scheds, tasks] = await Promise.all([DB.all('office'), DB.all('schedules'), DB.all('tasks')]);
  const open = recs.filter((r) => !r.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const soon = scheds.map((s) => ({ ...s, next: schedNext(s) })).filter((s) => s.next <= addDays(14)).sort((a, b) => a.next.localeCompare(b.next));
  const t = tasks.filter((x) => x.area === '관리사무소' && !x.done);
  const text = [
    `[인수인계] ${todayStr()} 기준`,
    '',
    `■ 미처리 업무 ${open.length}건`,
    ...open.map((r) => `- ${r.due ? `(기한 ${r.due.slice(5)}) ` : ''}[${r.cat}] ${locPrefix(r)}${r.text}${r.action && r.action !== '없음' ? ` → ${r.action}` : ''}${r.vendor ? ` / 업체 ${r.vendor}` : ''}${r.unit ? ` / ${r.unit}` : ''}`),
    ...(t.length ? ['', '■ 남은 할 일', ...t.map((x) => `- ${x.date.slice(5)} ${x.text}`)] : []),
    ...(soon.length ? ['', '■ 2주 안 정기점검', ...soon.map((s) => `- ${s.next.slice(5)} ${s.name} (${s.cycle}${s.vendor ? ', ' + s.vendor : ''})`)] : []),
    '', '■ 전달 사항', '- ',
  ].join('\n');
  view().innerHTML = `<div class="card"><textarea id="h_text" rows="18" style="font-size:14px">${esc(text)}</textarea>
    <div class="muted">미처리 업무·남은 할 일·정기점검을 모았습니다. '전달 사항'을 채운 뒤 복사하세요.</div>
    <button class="btn primary block" id="h_copy" type="button" style="margin-top:8px">📋 인수인계 복사</button></div>`;
  $('#h_copy').onclick = () => copyText($('#h_text').value);
}

/* ───────── 공지 도우미 ───────── */
const NOTICE_TYPES = {
  '단수': { title: '단수 안내', body: (v) => `${v.place} 급수 설비 ${v.detail || '점검'} 작업으로 아래와 같이 단수됩니다.`, tip: '작업 시간 전에 생활용수를 미리 받아 두시기 바랍니다.' },
  '정전': { title: '정전 안내', body: (v) => `${v.place} 전기 설비 ${v.detail || '점검'} 작업으로 아래와 같이 정전됩니다.`, tip: '정전 중 승강기 운행이 중지되며, 전자제품은 전원을 꺼 두시기 바랍니다.' },
  '승강기 점검': { title: '승강기 점검 안내', body: (v) => `${v.place} 승강기 ${v.detail || '정기 점검'}으로 아래 시간 동안 운행이 중지됩니다.`, tip: '점검 시간에는 계단을 이용해 주시기 바랍니다.' },
  '소독': { title: '소독 안내', body: (v) => `${v.place} ${v.detail || '정기 소독'}을 아래와 같이 실시합니다.`, tip: '세대 소독을 원하시는 분은 해당 시간에 계셔 주시기 바랍니다.' },
  '주차장 청소': { title: '주차장 청소 안내', body: (v) => `${v.place} ${v.detail || '바닥 물청소'}를 아래와 같이 실시합니다.`, tip: '작업 시간 전까지 차량을 지상 또는 다른 구역으로 옮겨 주시기 바랍니다.' },
  '일반 공지': { title: '안내', body: (v) => `${v.detail || ''}`, tip: '' },
};
function viewNotice() {
  setTitle('공지 도우미', true);
  view().innerHTML = `
    <form class="card" id="nt_form" autocomplete="off">
      <label for="nt_type">공지 종류</label><select id="nt_type">${opts(Object.keys(NOTICE_TYPES))}</select>
      <div class="grid2">
        <div><label for="nt_date">날짜</label><input id="nt_date" type="date" value="${addDays(1)}"></div>
        <div><label for="nt_time">시간</label><input id="nt_time" placeholder="예: 10:00 ~ 12:00"></div>
      </div>
      <label for="nt_place">대상·장소</label><input id="nt_place" placeholder="예: 101동 전 세대 / 지하 1~2층 주차장">
      <label for="nt_detail">내용(작업 내용)</label><input id="nt_detail" placeholder="예: 저수조 청소">
      <label for="nt_from">보내는 곳</label><input id="nt_from" value="${esc(localStorage.getItem('noticeFrom') || '관리사무소')}">
    </form>
    <div class="card"><textarea id="nt_text" rows="14" style="font-size:15px"></textarea>
      <button class="btn primary block" id="nt_copy" type="button" style="margin-top:8px">📋 공지문 복사</button></div>`;
  const make = () => {
    const ty = NOTICE_TYPES[$('#nt_type').value];
    const d = $('#nt_date').value;
    const v = { place: $('#nt_place').value.trim() || '단지', detail: $('#nt_detail').value.trim() };
    const when = d ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일(${'일월화수목금토'[new Date(d + 'T00:00').getDay()]})` : '';
    try { localStorage.setItem('noticeFrom', $('#nt_from').value); } catch { /* 무시 */ }
    $('#nt_text').value = [
      `[${ty.title}]`, '',
      '입주민 여러분, 안녕하십니까.',
      ty.body(v), '',
      `■ 일시: ${when} ${$('#nt_time').value.trim()}`.trim(),
      `■ 대상: ${v.place}`,
      ...(v.detail ? [`■ 내용: ${v.detail}`] : []),
      '', ...(ty.tip ? [ty.tip] : []),
      '입주민 여러분의 양해와 협조 부탁드립니다.', '',
      $('#nt_from').value.trim(),
    ].join('\n');
  };
  $('#nt_form').oninput = make;
  $('#nt_form').onchange = make;
  make();
  $('#nt_copy').onclick = () => copyText($('#nt_text').value);
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('복사했습니다'); }
  catch { prompt('아래 내용을 길게 눌러 복사하세요', t); }
}

// 내용에 위치가 이미 들어 있으면 앞에 다시 붙이지 않는다
function locPrefix(r) { return r.loc && !(r.text || '').includes(r.loc) ? r.loc + ': ' : ''; }
