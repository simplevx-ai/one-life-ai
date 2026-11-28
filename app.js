/* ONE LIFE AI — 1단계: 홈 + 사업 관리
 * 모든 데이터는 이 폰(브라우저)의 IndexedDB에만 저장된다. 서버로 보내지 않는다.
 */
'use strict';

const APP_VERSION = '0.19.0';
const STATUSES = ['접수', '견적', '예약', '완료', '취소'];
const METHODS = ['계좌이체', '현금', '카드', '기타'];
const PHOTO_KINDS = ['시공 전', '시공 후', '기타', '고객 사진'];
const DEFAULT_LISTS = {
  jobTypes: ['컴퓨터', '방충망', 'TV 설치', 'LED 시계', '타일 복원', '기타'],
  sources: ['블로그', '전화', '지인', '문자·카톡', '기타'],
};

/* ───────── 저장소(IndexedDB) ───────── */
const DB = (() => {
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('onelife', 6);
      r.onupgradeneeded = () => {
        const d = r.result;
        const has = (n) => d.objectStoreNames.contains(n);
        // v1: 사업 관리
        if (!has('customers')) d.createObjectStore('customers', { keyPath: 'id' });
        if (!has('jobs')) d.createObjectStore('jobs', { keyPath: 'id' }).createIndex('customerId', 'customerId');
        if (!has('payments')) d.createObjectStore('payments', { keyPath: 'id' }).createIndex('jobId', 'jobId');
        if (!has('photos')) d.createObjectStore('photos', { keyPath: 'id' }).createIndex('jobId', 'jobId');
        if (!has('settings')) d.createObjectStore('settings', { keyPath: 'key' });
        // v2: 홈 업무 체크리스트·빠른 기록
        if (!has('tasks')) d.createObjectStore('tasks', { keyPath: 'id' });
        if (!has('notes')) d.createObjectStore('notes', { keyPath: 'id' });
        // v2: 관리사무소(기록·정기점검). 사진은 photos 저장소에 jobId=기록 id로 넣는다
        if (!has('office')) d.createObjectStore('office', { keyPath: 'id' });
        if (!has('schedules')) d.createObjectStore('schedules', { keyPath: 'id' });
        // v3: 투자 분석(관심종목 watch·시나리오 scenario·기록 journal을 type으로 구분)
        if (!has('invest')) d.createObjectStore('invest', { keyPath: 'id' });
        // v4: 마케팅 콘텐츠(채널별 초안·발행 기록)
        if (!has('mkt')) d.createObjectStore('mkt', { keyPath: 'id' });
        // v5: 운동노트(run·shoe·race·table·tablerun·dive를 type으로 구분)
        if (!has('sport')) d.createObjectStore('sport', { keyPath: 'id' });
        // v6: 현장노트 장부 지출
        if (!has('expense')) d.createObjectStore('expense', { keyPath: 'id' });
      };
      r.onblocked = () => alert('앱이 다른 탭에서도 열려 있습니다. 다른 탭을 닫고 다시 열어 주세요.');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      let out;
      const req = fn(t.objectStore(store));
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('저장 취소됨'));
    });
  }
  return {
    all: (s) => run(s, 'readonly', (st) => st.getAll()),
    get: (s, id) => run(s, 'readonly', (st) => st.get(id)),
    put: (s, v) => run(s, 'readwrite', (st) => st.put(v)),
    del: (s, id) => run(s, 'readwrite', (st) => st.delete(id)),
    by: (s, idx, v) => run(s, 'readonly', (st) => st.index(idx).getAll(v)),
    clear: (s) => run(s, 'readwrite', (st) => st.clear()),
  };
})();

async function getSetting(key, def) {
  const r = await DB.get('settings', key);
  return r ? r.value : def;
}
const setSetting = (key, value) => DB.put('settings', { key, value });
async function lists() {
  const l = await getSetting('lists', null);
  const out = { ...DEFAULT_LISTS, ...(l || {}) };
  const oldDefault = ['방충망 교체', '방충망 수리', '안전방충망', 'TV 설치', '타일', '기타'];
  if (l && l.jobTypes) out.jobTypes = [...new Set([...DEFAULT_LISTS.jobTypes.filter((t) => t !== '기타'), ...l.jobTypes.filter((t) => !oldDefault.includes(t) || t === '기타'), '기타'])];
  return out;
}

/* ───────── 도우미 ───────── */
const $ = (s, el = document) => el.querySelector(s);
const view = () => $('#view');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (Number(n) || 0).toLocaleString('ko-KR') + '원';
const digits = (s) => String(s || '').replace(/\D/g, '');
// 날짜·진동 도우미(예전 운동노트 sport.js에 있던 것 — 현장노트 biz.js가 같이 씀)
function weekStart(d = new Date()) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return nowISO(x).slice(0, 10); }
function addD(iso, n) { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return nowISO(d).slice(0, 10); }
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch { /* 무시 */ } }
function prettyPhone(s) {
  const d = digits(s);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return d.startsWith('02') ? `02-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return s || '';
}
const pad = (n) => String(n).padStart(2, '0');
// 한국 시간 그대로 저장(+09:00). 앞 10글자가 그 지역의 날짜가 되도록
function nowISO(d = new Date()) {
  const o = -d.getTimezoneOffset(), a = Math.abs(o);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${o >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
function fmtDate(s) {
  if (!s) return '';
  const [date, time] = s.split('T');
  const [, m, d] = date.split('-');
  const wd = '일월화수목금토'[new Date(date + 'T00:00').getDay()];
  return `${+m}/${+d}(${wd})${time ? ' ' + time.slice(0, 5) : ''}`;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('on'), 2200);
}
function setTitle(t, back) {
  $('#title').textContent = t;
  $('#backBtn').hidden = !back;
}
const opts = (arr, sel) => arr.map((v) => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
function paidOf(jobId, pays) { return pays.filter((p) => p.jobId === jobId).reduce((a, p) => a + (Number(p.amount) || 0), 0); }
const nameOf = (c) => (c && (c.name || c.company)) || (c && c.phone ? `이름 미확인(${digits(c.phone).slice(-4)})` : '이름 미확인');

/* ───────── 라우터 ───────── */
const routes = [
  [/^#?\/?$/, 'home', viewHome],
  [/^#\/jobs$/, 'jobs', viewJobs],
  [/^#\/job\/new$/, 'jobs', () => viewJob(null)],
  [/^#\/job\/([\w-]+)$/, 'jobs', (m) => viewJob(m[1])],
  [/^#\/customers$/, 'customers', viewCustomers],
  [/^#\/customer\/([\w-]+)$/, 'customers', (m) => viewCustomer(m[1])],
  [/^#\/sales$/, 'sales', viewLedger],
  // 현장노트 (biz.js)
  [/^#\/biz$/, 'jobs', viewBiz],
  [/^#\/cal$/, 'jobs', viewCal],
  [/^#\/fc\/([\w-]+)$/, 'jobs', (m) => viewFieldCheck(m[1])],
  [/^#\/est\/([\w-]+)$/, 'jobs', (m) => viewEstimate(m[1])],
  [/^#\/prices$/, 'jobs', viewPrices],
  [/^#\/bizset$/, 'jobs', viewBizSet],
  [/^#\/ledger$/, 'sales', viewLedger],
  // 간이영수증 (rcpt.js) — 홈 화면 바로가기
  [/^#\/rcpt$/, 'sales', viewRcptList],
  [/^#\/rcpt\/new$/, 'sales', viewRcptNew],
  [/^#\/rcptset$/, 'sales', viewRcptSet],
  [/^#\/rcpt\/([\w-]+)$/, 'sales', (m) => viewRcpt(m[1])],
  [/^#\/exp\/new$/, 'sales', () => viewExpense(null)],
  [/^#\/exp\/([\w-]+)$/, 'sales', (m) => viewExpense(m[1])],
  [/^#\/settings$/, 'settings', viewSettings],
  [/^#\/notes$/, 'home', viewNotes],
  [/^#\/note\/new$/, 'home', () => viewNote(null, new URLSearchParams(location.hash.split('?')[1] || '').get('m'))],
  [/^#\/note\/([\w-]+)$/, 'home', (m) => viewNote(m[1])],
  // 관리사무소 (office.js)
  [/^#\/office$/, 'home', viewOffice],
  [/^#\/orecs$/, 'home', viewOfficeRecs],
  [/^#\/orec\/new$/, 'home', () => viewOfficeRec(null)],
  [/^#\/orec\/([\w-]+)$/, 'home', (m) => viewOfficeRec(m[1])],
  [/^#\/sched$/, 'home', viewInspList],
  // 관리실 업무수첩 (office2.js)
  [/^#\/insp$/, 'home', viewInspList],
  [/^#\/insp\/edit\/([\w-]+)$/, 'home', (m) => viewInspEdit(m[1])],
  [/^#\/insp\/run\/([\w-]+)$/, 'home', (m) => viewInspRun(m[1])],
  [/^#\/insps$/, 'home', viewInspRecs],
  [/^#\/cmps$/, 'home', viewCmps],
  [/^#\/cmp\/new$/, 'home', () => viewCmp(null)],
  [/^#\/cmp\/([\w-]+)$/, 'home', (m) => viewCmp(m[1])],
  [/^#\/vworks$/, 'home', viewVWorks],
  [/^#\/vwork\/new$/, 'home', () => viewVWork(null)],
  [/^#\/vwork\/([\w-]+)$/, 'home', (m) => viewVWork(m[1])],
  [/^#\/oset$/, 'home', viewOSet],
  [/^#\/odiary$/, 'home', viewDiary],
  [/^#\/handover$/, 'home', viewHandover],
  [/^#\/notice$/, 'home', viewNotice],
  [/^#\/ai$/, 'home', viewAI], // ai.js
  // 음성 기록 (voice.js)
  [/^#\/voice$/, 'home', viewVoiceList],
  [/^#\/voice\/new$/, 'home', viewVoiceNew],
  [/^#\/voice\/([\w-]+)$/, 'home', (m) => viewVoice(m[1])],
  // 연락처·단체 문자 (contacts.js), 블로그 자동 작성 (blogauto.js)
  [/^#\/contacts$/, 'home', viewContacts],
  [/^#\/blogauto$/, 'home', viewBlogAuto],
  // 마케팅 (mkt.js)
  [/^#\/mkt$/, 'home', viewMkt],
  [/^#\/mktnew$/, 'home', viewMktNew],
  [/^#\/mktset$/, 'home', viewMktSet],
  [/^#\/mkt\/([\w-]+)$/, 'home', (m) => viewMktItem(m[1])],
  // 현장 보고서 (report.js)
  [/^#\/reports$/, 'home', viewReports],
  [/^#\/report\/new$/, 'home', viewReportNew],
  [/^#\/report\/([\w-]+)$/, 'home', (m) => viewReport(m[1])],
];
async function render() {
  const h = (location.hash || '#/').split('?')[0]; // ?뒤 값은 각 화면이 직접 읽는다
  for (const [re, tab, fn] of routes) {
    const m = h.match(re);
    if (m) {
      document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
      document.querySelector('.fab')?.remove();
      try { await fn(m); } catch (e) { console.error(e); view().innerHTML = `<div class="card warnbox">오류: ${esc(e.message)}</div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', render);
$('#backBtn').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));
function fab(href) {
  const b = document.createElement('button');
  b.className = 'fab'; b.textContent = '+'; b.setAttribute('aria-label', '새 작업');
  b.onclick = () => { location.hash = href; };
  document.body.appendChild(b);
}

/* ───────── 홈 ───────── */
const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const TASK_AREAS = ['사업', '관리사무소', '개인'];

/* 홈에 보일 알림: 예약·일정·미처리 업무를 규칙으로 뽑는다 */
function buildAlerts({ jobs, pays, tasks, cmap, today, needBackup, daysSinceBackup, oa }) {
  const out = [];
  const nm = (j) => nameOf(cmap[j.customerId]);
  jobs.filter((j) => j.status === '예약' && j.scheduledAt && j.scheduledAt.slice(0, 10) === today)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .forEach((j) => out.push({ lv: 'info', icon: '📅', text: `오늘 ${j.scheduledAt.slice(11, 16) || ''} ${nm(j)} · ${j.type || '작업'}`, href: `#/job/${j.id}` }));
  jobs.filter((j) => j.status === '예약' && j.scheduledAt && j.scheduledAt.slice(0, 10) < today)
    .forEach((j) => out.push({ lv: 'warn', icon: '⏰', text: `지난 예약 완료 처리 안 함: ${fmtDate(j.scheduledAt)} ${nm(j)}`, href: `#/job/${j.id}` }));
  const old = jobs.filter((j) => j.status === '접수' && j.createdAt && (Date.now() - new Date(j.createdAt).getTime()) / 864e5 >= 2);
  if (old.length) out.push({ lv: 'warn', icon: '📨', text: `2일 넘게 답하지 않은 접수 ${old.length}건`, href: '#/jobs', tab: '대기' });
  const unpaidJobs = jobs.filter((j) => j.status === '완료' && (Number(j.quote) || 0) - paidOf(j.id, pays) > 0);
  if (unpaidJobs.length) out.push({ lv: 'warn', icon: '💸', text: `미수금 있는 완료 작업 ${unpaidJobs.length}건`, href: '#/sales' });
  const lateTasks = tasks.filter((t) => !t.done && t.date < today);
  if (lateTasks.length) out.push({ lv: 'warn', icon: '☑️', text: `지난 날짜의 미완료 체크리스트 ${lateTasks.length}개`, href: '#/' });
  if (oa) {
    if (oa.late.length) out.push({ lv: 'warn', icon: '🏢', text: `관리사무소 기한 지난 업무 ${oa.late.length}건`, href: '#/office' });
    if (oa.cmpLate && oa.cmpLate.length) out.push({ lv: 'warn', icon: '📝', text: `3일 넘게 미처리된 민원 ${oa.cmpLate.length}건`, href: '#/cmps' });
    if (oa.dueToday.length) out.push({ lv: 'info', icon: '🏢', text: `관리사무소 오늘 기한 업무 ${oa.dueToday.length}건`, href: '#/office' });
    oa.schedDue.filter((s) => s.next <= today).forEach((s) => out.push({ lv: 'warn', icon: '🗓', text: `정기점검 ${s.next < today ? '지남' : '오늘'}: ${s.name}`, href: '#/sched' }));
  }
  if (needBackup) out.push({ lv: 'warn', icon: '💾', text: daysSinceBackup === null ? '아직 백업하지 않았습니다' : `마지막 백업 ${daysSinceBackup}일 전`, href: '#/settings' });
  return out;
}

/* AI 브리핑: 지금은 앱 안의 데이터로 만든 자동 요약(외부 AI 없음) */
function buildBriefing({ todayJobs, waiting, overdue, monthSales, unpaid, openTasks, notesToday, oa }) {
  const s = [];
  s.push(todayJobs.length ? `오늘 방문·작업 ${todayJobs.length}건이 있습니다(첫 일정 ${todayJobs[0].scheduledAt.slice(11, 16) || '시간 미정'}).` : '오늘 잡힌 방문·작업은 없습니다.');
  if (overdue) s.push(`지난 예약 ${overdue}건을 완료 처리해야 합니다.`);
  if (waiting) s.push(`답하거나 견적 낼 문의가 ${waiting}건 남아 있습니다.`);
  if (openTasks) s.push(`오늘 체크리스트 ${openTasks}개가 남았습니다.`);
  if (oa && oa.open.length) s.push(`관리사무소 미처리 ${oa.open.length}건${oa.late.length ? `(기한 지남 ${oa.late.length}건)` : ''}.`);
  if (oa) { const sd = oa.schedDue.filter((x) => x.next <= todayStr()); if (sd.length) s.push(`오늘까지 할 정기점검: ${sd.map((x) => x.name).join(', ')}.`); }
  s.push(`이번 달 입금 ${won(monthSales)}${unpaid ? `, 미수금 ${won(unpaid)}` : ''}.`);
  if (notesToday) s.push(`오늘 빠른 기록 ${notesToday}건.`);
  return s;
}

async function viewHome() {
  setTitle('ONE LIFE AI');
  const [jobs, pays, custs, tasks, notes, offRecs, scheds, lastBackup, sheetCfg, lastSync] = await Promise.all([
    DB.all('jobs'), DB.all('payments'), DB.all('customers'), DB.all('tasks'), DB.all('notes'), DB.all('office'), DB.all('schedules'),
    getSetting('lastBackup', null), getSetting('sheet', {}), getSetting('lastSync', null)]);
  const oa = officeAlerts(offRecs, scheds);
  const sheetOn = !!(sheetCfg && sheetCfg.url && sheetCfg.key);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const now = new Date();
  const today = todayStr();
  const week = new Date(); week.setDate(week.getDate() + 7);
  const weekStr = `${week.getFullYear()}-${pad(week.getMonth() + 1)}-${pad(week.getDate())}`;
  const sched = jobs.filter((j) => j.status === '예약' && j.scheduledAt).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const todayJobs = sched.filter((j) => j.scheduledAt.slice(0, 10) === today);
  const nextJobs = sched.filter((j) => j.scheduledAt.slice(0, 10) > today && j.scheduledAt.slice(0, 10) <= weekStr);
  const overdue = sched.filter((j) => j.scheduledAt.slice(0, 10) < today).length;
  const waiting = jobs.filter((j) => j.status === '접수' || j.status === '견적').length;
  const month = monthStr();
  const monthSales = pays.filter((p) => (p.date || '').startsWith(month)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const unpaid = jobs.filter((j) => j.status === '완료').reduce((a, j) => a + Math.max(0, (Number(j.quote) || 0) - paidOf(j.id, pays)), 0);
  const daysSinceBackup = lastBackup ? Math.floor((Date.now() - lastBackup) / 864e5) : null;
  const needBackup = (jobs.length + notes.length + offRecs.length) > 0 && (daysSinceBackup === null || daysSinceBackup >= 7);
  // 체크리스트: 오늘 것 + 지난 날짜에 못 끝낸 것
  const dayTasks = tasks.filter((t) => t.date === today || (!t.done && t.date < today))
    .sort((a, b) => (a.done - b.done) || (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const openTasks = dayTasks.filter((t) => !t.done).length;
  const notesToday = notes.filter((n) => (n.createdAt || '').slice(0, 10) === today).length;
  // 현장노트: 내일 일정(전날 알림)·연락할 고객
  const tmrJobs = jobs.filter((j) => j.status !== '취소' && (j.scheduledAt || '').slice(0, 10) === addDays(1));
  const contacts = contactList(jobs, custs);
  const bizAl = [...(tmrJobs.length ? [{ lv: 'info', icon: '🔔', text: `내일 작업 ${tmrJobs.length}건: ${tmrJobs.map((j) => `${(j.scheduledAt || '').slice(11, 16)} ${nameOf(cmap[j.customerId])}`).join(', ')}`, href: '#/biz' }] : []),
    ...(contacts.length ? [{ lv: 'info', icon: '☎️', text: `연락할 고객 ${contacts.length}명 (${contacts.slice(0, 2).map((x) => nameOf(x.c)).join(', ')}${contacts.length > 2 ? ' 외' : ''})`, href: '#/biz' }] : [])];
  const alerts = [...buildAlerts({ jobs, pays, tasks, cmap, today, needBackup, daysSinceBackup, oa }), ...bizAl];
  const brief = buildBriefing({ todayJobs, waiting, overdue, monthSales, unpaid, openTasks, notesToday, oa });
  // 구글 캘린더(동기화 때 받아 둔 것): 오늘·앞으로 7일
  const gevs = await gcalEvents();
  const gToday = gcalOn(gevs, today);
  const gNext = [...Array(7)].flatMap((_, i) => gcalOn(gevs, addDays(i + 1)).filter((e) => e.start.slice(0, 10) === addDays(i + 1)).map((e) => ({ e, d: addDays(i + 1) })));
  if (gToday.length) brief.splice(1, 0, `구글 캘린더 오늘 일정 ${gToday.length}건: ${gToday.slice(0, 3).map((e) => `${gcalTime(e, today)} ${e.title}`).join(', ')}${gToday.length > 3 ? ' 외' : ''}.`);
  const gLine = (e, d, showDate) => `<a class="item" href="#" data-gcal="${esc(e.id)}" style="border-left:4px solid var(--gold)"><div class="row spread"><span class="t">${esc(showDate ? fmtDate(d) + ' ' : '')}${esc(gcalTime(e, d))} · ${esc(e.title)}</span><span class="badge">📆 구글</span></div>${e.location ? `<div class="muted">📍 ${esc(e.location)}</div>` : ''}</a>`;

  const jobLine = (j, showDate) => {
    const c = cmap[j.customerId] || {};
    const when = showDate ? fmtDate(j.scheduledAt) : (j.scheduledAt.slice(11, 16) || '시간 미정');
    return `<a class="item" href="#/job/${j.id}"><div class="row spread"><span class="t">${esc(when)} · ${esc(nameOf(c))}</span><span class="badge s-${j.status}">${j.status}</span></div>
      <div class="muted">${esc([j.area || c.area, j.type, j.product].filter(Boolean).join(' · '))}</div></a>`;
  };

  view().innerHTML = `
    <div class="card hero">
      <div style="font-size:15px;color:#C9D6F5">${now.getFullYear()}년</div>
      <div style="font-size:26px;font-weight:800;line-height:1.2">${now.getMonth() + 1}월 ${now.getDate()}일 <span style="color:var(--gold)">${WEEKDAYS[now.getDay()]}</span></div>
    </div>

    <div class="card">
      <div class="row spread"><h2 style="margin:0">🤖 AI 브리핑</h2><a class="btn small primary" href="#/ai?m=voice">🎤 AI 비서에게 말하기</a></div>
      <ul style="margin:8px 0 0;padding-left:18px">${brief.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>

    ${alerts.length ? `<div class="card ${alerts.some((a) => a.lv === 'warn') ? 'warnbox' : ''}">
      <h2>🔔 알림 <span class="muted">${alerts.length}</span></h2>
      ${alerts.map((a, i) => `<a class="item" href="${a.href}" data-alert="${i}" style="padding:9px 12px"><span>${a.icon}</span> ${esc(a.text)}</a>`).join('')}
    </div>` : ''}

    <div class="card">
      <div class="row spread"><h2 style="margin:0">📅 작업 일정</h2><a class="btn small" href="#/job/new">+ 새 작업</a></div>
      <div class="muted" style="margin:8px 0 4px">오늘</div>
      ${todayJobs.length ? todayJobs.map((j) => jobLine(j, false)).join('') : '<div class="muted">오늘 일정 없음</div>'}
      <div class="muted" style="margin:10px 0 4px">앞으로 7일</div>
      ${nextJobs.length ? nextJobs.map((j) => jobLine(j, true)).join('') : '<div class="muted">예정 없음</div>'}
      ${gevs.length ? `<div class="muted" style="margin:12px 0 4px">📆 구글 캘린더 (오늘·7일)</div>
      ${[...gToday.map((e) => gLine(e, today, false)), ...gNext.map((x) => gLine(x.e, x.d, true))].join('') || '<div class="muted">구글 캘린더 일정 없음</div>'}` : ''}
    </div>

    <a class="card hero" href="#/sales" style="display:block;text-decoration:none">
      <div class="row spread"><b>💰 ${now.getMonth() + 1}월 매출</b><span class="muted">처리 대기 ${waiting}건 ›</span></div>
      <div class="grid2" style="margin-top:8px">
        <div><div class="muted">입금</div><b style="font-size:22px">${won(monthSales)}</b></div>
        <div><div class="muted">미수금</div><b style="font-size:22px;color:${unpaid ? '#FFD1D1' : '#fff'}">${won(unpaid)}</b></div>
      </div>
    </a>

    <div class="card">
      <div class="row spread"><h2 style="margin:0">☑️ 업무 체크리스트</h2><span class="muted">${dayTasks.length - openTasks}/${dayTasks.length} 완료</span></div>
      <ul class="list" id="taskList" style="margin-top:8px">${dayTasks.map((t) => `
        <li class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">
          <input type="checkbox" data-done="${t.id}" ${t.done ? 'checked' : ''} style="width:24px;min-height:24px;flex:none" aria-label="완료">
          <span style="flex:1;${t.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.text)}
            <span class="badge">${esc(t.area || '개인')}</span>${t.date < today ? ` <span class="badge" style="color:var(--red)">${esc(fmtDate(t.date))}</span>` : ''}</span>
          <button class="btn small" data-deltask="${t.id}" type="button" aria-label="삭제">✕</button>
        </li>`).join('') || '<li class="muted">오늘 할 일을 추가하세요.</li>'}</ul>
      <form id="taskForm" class="row" style="margin-top:8px">
        <select id="taskArea" style="width:auto;flex:none">${opts(TASK_AREAS, sessionStorage.getItem('taskArea') || '사업')}</select>
        <input id="taskText" placeholder="할 일 입력" autocomplete="off">
        <button class="btn primary" type="submit" style="flex:none">추가</button>
      </form>
    </div>

    <div class="card">
      <div class="row spread"><h2 style="margin:0">✍️ 빠른 기록</h2><a class="btn small" href="#/notes">전체 ${notes.length} ›</a></div>
      <div class="grid2" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
        <a class="btn" href="#/note/new?m=voice">🎤 음성</a>
        <a class="btn" href="#/note/new?m=text">📝 텍스트</a>
        <a class="btn" href="#/note/new?m=photo">📷 사진</a>
      </div>
    </div>

    ${sheetOn ? `<div class="row" style="margin-bottom:6px"><button class="btn block" id="homeSync" type="button">🔄 구글 시트 동기화</button></div>
      <div class="muted" style="margin-bottom:12px;text-align:right">마지막 동기화: ${lastSync ? esc(new Date(lastSync).toLocaleString('ko-KR')) : '아직 안 함'}</div>` : ''}

    <div class="card">
      <h2>ONE LIFE 모듈</h2>
      <div class="tiles">
        <a class="tile" href="#/biz"><i>🛠</i>현장노트</a>
        <a class="tile" href="#/office"><i>🏢</i>관리사무소${oa.open.length ? `<br><small style="color:var(--red)">미처리 ${oa.open.length}</small>` : ''}</a>
        <a class="tile" href="#/ai"><i>🤖</i>AI 비서</a>
        <a class="tile" href="#/reports"><i>📸</i>현장 보고서</a>
        <a class="tile" href="#/mkt"><i>📣</i>마케팅</a>
        <a class="tile" href="#/contacts"><i>📇</i>연락처·단체 문자</a>
        <a class="tile" href="#/blogauto"><i>✍️</i>블로그 자동 작성</a>
      </div>
    </div>
    <div class="muted" style="text-align:center">v${APP_VERSION} · 데이터는 이 폰에 저장${sheetOn ? ' · 구글 시트 동기화 켜짐' : ''}</div>`;

  if (sheetOn) $('#homeSync').onclick = (e) => runSync(e.target);
  view().querySelectorAll('[data-gcal]').forEach((a) => {
    a.onclick = (ev) => { ev.preventDefault(); const e = gevs.find((x) => x.id === a.dataset.gcal); if (e) gcalInfo(e); };
  });
  view().querySelectorAll('[data-alert]').forEach((a) => {
    const al = alerts[+a.dataset.alert];
    if (al.tab) a.addEventListener('click', () => sessionStorage.setItem('jobsTab', al.tab));
  });
  $('#taskForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#taskText').value.trim();
    if (!text) return;
    const area = $('#taskArea').value;
    sessionStorage.setItem('taskArea', area);
    await DB.put('tasks', { id: uid(), text, area, date: today, done: false, createdAt: nowISO() });
    render();
  };
  $('#taskList').onclick = async (e) => {
    const d = e.target.closest('[data-deltask]');
    if (d) { await DB.del('tasks', d.dataset.deltask); render(); }
  };
  $('#taskList').onchange = async (e) => {
    const id = e.target.dataset.done;
    if (!id) return;
    const t = await DB.get('tasks', id);
    // 지난 날짜 일을 오늘 끝내면 오늘 기록으로 옮긴다
    await DB.put('tasks', { ...t, done: e.target.checked, doneAt: e.target.checked ? nowISO() : '', date: e.target.checked ? today : t.date });
    render();
  };
}

/* ───────── 빠른 기록(음성·텍스트·사진) ───────── */
const NOTE_TAGS = ['사업', '관리사무소', '개인', '아이디어', '투자'];

async function viewNotes() {
  setTitle('빠른 기록', true);
  const notes = (await DB.all('notes')).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  let tag = sessionStorage.getItem('noteTag') || '전체';
  let q = '';
  const urls = [];
  function draw() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const list = notes.filter((n) => (tag === '전체' || n.tag === tag) && (!q || (n.text || '').toLowerCase().includes(q)));
    $('#noteList').innerHTML = list.length ? list.map((n) => {
      let img = '';
      if (n.photo) { const u = URL.createObjectURL(n.photo); urls.push(u); img = `<img src="${u}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none">`; }
      return `<a class="item row" href="${n.via === 'voice-rec' ? '#/voice/' : '#/note/'}${n.id}" style="align-items:flex-start">${img}<div style="flex:1;min-width:0">
        <div class="muted">${esc(fmtDate((n.createdAt || '').slice(0, 10)))} ${esc((n.createdAt || '').slice(11, 16))} · ${esc(n.tag || '')} ${n.via === 'voice' ? '🎤' : ''}${n.done ? ' · ✅ 처리함' : ''}</div>
        <div style="white-space:pre-wrap;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">${esc(n.text || '(사진만)')}</div></div></a>`;
    }).join('') : '<div class="empty">기록이 없습니다.</div>';
    document.querySelectorAll('#noteTags .chip').forEach((c) => c.classList.toggle('on', c.dataset.t === tag));
  }
  view().innerHTML = `
    <div class="grid2" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">
      <a class="btn" href="#/note/new?m=voice">🎤 음성</a><a class="btn" href="#/note/new?m=text">📝 텍스트</a><a class="btn" href="#/note/new?m=photo">📷 사진</a>
    </div>
    <input id="q" type="search" placeholder="기록 검색" style="margin-bottom:10px">
    <div class="chips" id="noteTags">${['전체', ...NOTE_TAGS].map((t) => `<button class="chip" data-t="${t}">${t}</button>`).join('')}</div>
    <div id="noteList"></div>`;
  $('#noteTags').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; tag = b.dataset.t; sessionStorage.setItem('noteTag', tag); draw(); };
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
}

async function viewNote(id, mode) {
  const note = id ? await DB.get('notes', id) : null;
  if (id && !note) { setTitle('기록', true); view().innerHTML = '<div class="empty">기록을 찾을 수 없습니다.</div>'; return; }
  const n = note || { tag: sessionStorage.getItem('noteTag') && sessionStorage.getItem('noteTag') !== '전체' ? sessionStorage.getItem('noteTag') : '사업' };
  setTitle(note ? '기록' : '새 기록', true);
  let photo = n.photo || null;
  let via = n.via || (mode === 'voice' ? 'voice' : 'text');
  let tagTouched = false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  view().innerHTML = `
    <div class="card">
      <label for="n_tag">분류</label>
      <select id="n_tag">${opts(NOTE_TAGS, n.tag)}</select>
      <label for="n_text">내용</label>
      <textarea id="n_text" rows="6" placeholder="말하거나 적으세요">${esc(n.text)}</textarea>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn" id="micBtn" type="button">🎤 말로 입력</button>
        <label class="btn" style="margin:0;color:var(--ink)">📷 사진<input id="n_cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn" style="margin:0;color:var(--ink)">🖼 앨범<input id="n_alb" type="file" accept="image/*" hidden></label>
      </div>
      <div id="micState" class="muted" style="margin-top:6px"></div>
      <div id="n_photo" style="margin-top:10px"></div>
      ${note ? `<label class="row" style="margin-top:10px;color:var(--ink);font-size:15px"><input type="checkbox" id="n_done" ${note.done ? 'checked' : ''} style="width:22px;min-height:22px;flex:none"> 처리함</label>` : ''}
    </div>
    <button class="btn primary block" id="n_save" type="button">💾 저장</button>
    ${note ? `<div class="row" style="margin-top:8px">
      <button class="btn block" id="n_toTask" type="button">☑️ 오늘 할 일로</button>
      <button class="btn block" id="n_toJob" type="button">🛠 새 작업으로</button></div>
      <button class="btn block" id="n_copy" type="button" style="margin-top:8px">📋 내용 복사</button>
      <button class="btn danger block" id="n_del" type="button" style="margin-top:8px">기록 삭제</button>` : ''}`;

  let url = '';
  function drawPhoto() {
    if (url) URL.revokeObjectURL(url);
    url = photo ? URL.createObjectURL(photo) : '';
    $('#n_photo').innerHTML = photo ? `<div class="photo" style="width:140px"><img src="${url}" alt="기록 사진"></div><button class="btn small danger" id="n_rmPhoto" type="button" style="margin-top:6px">사진 빼기</button>` : '';
    if (photo) $('#n_rmPhoto').onclick = () => { photo = null; drawPhoto(); };
  }
  drawPhoto();
  $('#n_tag').onchange = () => { tagTouched = true; };
  const takePhoto = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { photo = await shrink(f, 1600, 0.82); drawPhoto(); } catch (err) { toast(err.message); }
  };
  $('#n_cam').onchange = takePhoto;
  $('#n_alb').onchange = takePhoto;

  // 음성 받아쓰기(크롬 기본 기능, 인터넷 필요). 지원 안 되면 키보드의 마이크 버튼 안내
  let rec = null;
  $('#micBtn').onclick = () => {
    if (!SR) { toast('이 브라우저는 음성 입력을 지원하지 않습니다. 키보드의 🎤 버튼을 쓰세요'); $('#n_text').focus(); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = true;
    const base = $('#n_text').value;
    let finalText = '';
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t + ' '; else interim += t;
      }
      $('#n_text').value = (base ? base + '\n' : '') + finalText + interim;
    };
    rec.onstart = () => { $('#micBtn').textContent = '⏹ 그만 듣기'; $('#micState').textContent = '듣는 중… 말씀하세요'; via = 'voice'; };
    rec.onerror = (ev) => { $('#micState').textContent = ev.error === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '음성 인식 오류: ' + ev.error; };
    rec.onend = () => { rec = null; $('#micBtn').textContent = '🎤 말로 입력'; if ($('#micState').textContent.startsWith('듣는 중')) $('#micState').textContent = ''; };
    try { rec.start(); } catch (err) { toast('음성 입력을 시작할 수 없습니다'); rec = null; }
  };

  const save = async () => {
    if (rec) rec.stop();
    const text = $('#n_text').value.trim();
    if (!text && !photo) { toast('내용이나 사진을 넣어 주세요'); return null; }
    // 새 기록이고 분류를 직접 바꾸지 않았으면 내용을 보고 업무 분야를 자동으로 정한다
    let tag = $('#n_tag').value;
    if (!note && !tagTouched && text) { const a = classifyCommand(text).area; if (NOTE_TAGS.includes(a)) tag = a; }
    const data = { ...(note || { id: uid(), createdAt: nowISO() }), tag, text, photo, via, done: note ? $('#n_done').checked : false, updatedAt: nowISO() };
    await DB.put('notes', data);
    return data;
  };
  $('#n_save').onclick = async () => { if (await save()) { toast('저장했습니다'); history.length > 1 ? history.back() : (location.hash = '#/notes'); } };

  if (mode === 'voice' && !note) setTimeout(() => $('#micBtn').click(), 300);
  if (mode === 'photo' && !note) setTimeout(() => $('#n_cam').click(), 300);
  if (mode === 'text' && !note) $('#n_text').focus();
  if (!note) return;

  $('#n_toTask').onclick = async () => {
    const d = await save(); if (!d) return;
    await DB.put('tasks', { id: uid(), text: (d.text || '사진 기록 확인').split('\n')[0].slice(0, 80), area: TASK_AREAS.includes(d.tag) ? d.tag : '개인', date: todayStr(), done: false, createdAt: nowISO(), noteId: d.id });
    toast('오늘 체크리스트에 추가했습니다');
  };
  $('#n_toJob').onclick = async () => {
    const d = await save(); if (!d) return;
    const now = nowISO();
    const c = { id: uid(), name: '', phone: (d.text.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/) || [''])[0].replace(/\D/g, ''), createdAt: now, updatedAt: now };
    await DB.put('customers', c);
    const j = { id: uid(), customerId: c.id, status: '접수', summary: d.text, createdAt: now, updatedAt: now };
    await DB.put('jobs', j);
    if (d.photo) await DB.put('photos', { id: uid(), jobId: j.id, kind: '기타', blob: d.photo, createdAt: now });
    await DB.put('notes', { ...d, done: true });
    toast('새 작업을 만들었습니다');
    location.hash = `#/job/${j.id}`;
  };
  $('#n_copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#n_text').value); toast('복사했습니다'); } catch { toast('복사하지 못했습니다'); }
  };
  $('#n_del').onclick = async () => {
    if (confirm('이 기록을 지울까요?')) { await DB.del('notes', note.id); location.replace('#/notes'); }
  };
}

/* ───────── 작업 목록 ───────── */
async function viewJobs() {
  setTitle('작업');
  const [jobs, custs, pays] = await Promise.all([DB.all('jobs'), DB.all('customers'), DB.all('payments')]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const tabs = ['대기', '예약', '완료', '취소', '전체'];
  let tab = sessionStorage.getItem('jobsTab') || '대기';
  let q = '';
  const match = (j) => {
    if (tab === '대기' && !(j.status === '접수' || j.status === '견적')) return false;
    if (['예약', '완료', '취소'].includes(tab) && j.status !== tab) return false;
    if (!q) return true;
    const c = cmap[j.customerId] || {};
    return [c.name, c.phone, digits(c.phone), j.area, c.area, j.type, j.product, j.memo].join(' ').toLowerCase().includes(q);
  };
  const sortKey = (j) => (tab === '예약' ? j.scheduledAt || '9' : '') + (j.updatedAt || j.createdAt || '');
  function draw() {
    let list = jobs.filter(match);
    list.sort((a, b) => (tab === '예약' ? sortKey(a).localeCompare(sortKey(b)) : (b.updatedAt || '').localeCompare(a.updatedAt || '')));
    $('#jobList').innerHTML = list.length ? list.map((j) => {
      const c = cmap[j.customerId] || {};
      const paid = paidOf(j.id, pays);
      const left = (Number(j.quote) || 0) - paid;
      return `<a class="item" href="#/job/${j.id}">
        <div class="row spread"><span class="t">${esc(nameOf(c))} <span class="muted">${esc(prettyPhone(c.phone))}</span></span><span class="badge s-${j.status}">${j.status}</span></div>
        <div class="muted">${esc([j.area || c.area, j.type, j.product].filter(Boolean).join(' · ') || '작업 내용 미입력')}</div>
        <div class="muted">${j.scheduledAt ? '예약 ' + esc(fmtDate(j.scheduledAt)) + ' · ' : ''}${j.quote ? '견적 ' + won(j.quote) : ''}${j.status === '완료' && left > 0 ? ` · <b style="color:var(--red)">미수 ${won(left)}</b>` : ''}</div>
      </a>`;
    }).join('') : '<div class="empty">해당하는 작업이 없습니다.</div>';
    document.querySelectorAll('#jobTabs .chip').forEach((c) => c.classList.toggle('on', c.dataset.t === tab));
  }
  view().innerHTML = `
    <input id="q" type="search" placeholder="이름·전화·지역·작업 검색" style="margin-bottom:10px">
    <div class="chips" id="jobTabs">${tabs.map((t) => `<button class="chip" data-t="${t}">${t}</button>`).join('')}</div>
    <div id="jobList"></div>`;
  $('#jobTabs').onclick = (e) => { const t = e.target.closest('.chip'); if (!t) return; tab = t.dataset.t; sessionStorage.setItem('jobsTab', tab); draw(); };
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
  fab('#/job/new');
}

/* ───────── 작업 상세·입력 ───────── */
async function viewJob(id) {
  const L = await lists();
  const job = id ? await DB.get('jobs', id) : null;
  if (id && !job) { view().innerHTML = '<div class="empty">작업을 찾을 수 없습니다.</div>'; setTitle('작업', true); return; }
  const preC = !job && new URLSearchParams(location.hash.split('?')[1] || '').get('c');
  const cust = job ? (await DB.get('customers', job.customerId)) || {} : (preC ? (await DB.get('customers', preC)) || {} : {});
  const j = job || { status: '접수', source: L.sources[0] };
  setTitle(job ? nameOf(cust) : '새 문의·작업', true);
  const typeList = j.type && !L.jobTypes.includes(j.type) ? [...L.jobTypes, j.type] : L.jobTypes;
  const curSrc = j.source || cust.source;
  const srcList = curSrc && !L.sources.includes(curSrc) ? [...L.sources, curSrc] : L.sources;
  const statusList = j.status && !STATUSES.includes(j.status) ? [...STATUSES, j.status] : STATUSES;

  view().innerHTML = `
    ${job && job.sheetId ? `<div class="card"><div class="row spread"><b>시트 ${esc(job.sheetId)}</b><span class="muted">${job.syncedAt ? '동기화 ' + esc(new Date(job.syncedAt).toLocaleString('ko-KR')) : ''}</span></div>
      ${job.missing ? `<div class="muted">빠진 항목: ${esc(job.missing)}</div>` : ''}
      ${job.photoLink ? `<div class="muted">시트의 현장 사진: ${/^https?:\/\//.test(job.photoLink) ? `<a href="${esc(job.photoLink)}" target="_blank" rel="noopener">열기</a>` : esc(job.photoLink)}</div>` : ''}</div>` : ''}
    <form id="jobForm" autocomplete="off">
      <div class="card">
        <h2>고객</h2>
        ${!job ? `<label for="f_find">기존 고객 찾기</label><input id="f_find" type="search" placeholder="이름·전화·아파트로 검색"><div id="f_found"></div>` : ''}
        <label for="f_name">이름 <span class="muted">(이름이나 연락처 중 하나는 필수)</span></label>
        <input id="f_name" name="name" value="${esc(cust.name)}" placeholder="예: 김OO">
        <label for="f_phone">연락처</label>
        <input id="f_phone" name="phone" type="tel" inputmode="tel" value="${esc(prettyPhone(cust.phone))}" placeholder="010-0000-0000">
        ${cust.phone ? `<div class="row" style="margin-top:8px"><a class="btn small" href="tel:${digits(cust.phone)}">📞 전화</a><a class="btn small" href="sms:${digits(cust.phone)}">💬 문자</a></div>` : ''}
        <label for="f_area">지역(아파트·동)</label>
        <input id="f_area" name="area" value="${esc(j.area || cust.area)}" placeholder="예: 수성구 범어동 OO아파트">
        <label for="f_address">상세 주소</label>
        <input id="f_address" name="address" value="${esc(j.address || cust.address)}" placeholder="동·호수 등">
        <label for="f_source">유입 경로</label>
        <select id="f_source" name="source">${opts(srcList, curSrc)}</select>
      </div>
      <div class="card">
        <h2>작업</h2>
        <label for="f_status">상태</label>
        <select id="f_status" name="status">${opts(statusList, j.status)}</select>
        <label for="f_type">작업 종류</label>
        <select id="f_type" name="type">${j.type ? '' : '<option value="" selected>작업 종류 선택(미정)</option>'}${opts(typeList, j.type)}</select>
        <label for="f_product">제품·크기·수량</label>
        <input id="f_product" name="product" value="${esc(j.product)}" placeholder="예: 미세방충망 1200×1500 3개">
        <div class="grid2">
          <div><label for="f_wish">희망 일정</label><input id="f_wish" name="wishDate" value="${esc(j.wishDate)}" placeholder="예: 11/25 오전"></div>
          <div><label for="f_sched">예약 일시</label><input id="f_sched" name="scheduledAt" type="datetime-local" value="${esc(j.scheduledAt)}"></div>
        </div>
        <label for="f_quote">견적 금액(원)</label>
        <input id="f_quote" name="quote" type="number" inputmode="numeric" min="0" step="1000" value="${esc(j.quote)}" placeholder="0">
        <label for="f_summary">고객이 말한 내용(요약)</label>
        <textarea id="f_summary" name="summary">${esc(j.summary)}</textarea>
        <label for="f_check">추가 확인 사항</label>
        <input id="f_check" name="check" value="${esc(j.check)}" placeholder="예: 사진 받기, 방문 실측 필요">
        <label for="f_memo">메모</label>
        <textarea id="f_memo" name="memo">${esc(j.memo)}</textarea>
      </div>
      <div class="card">
        <h2>블로그 자료 <span class="muted">(선택 · 고객 이름·번호는 들어가지 않습니다)</span></h2>
        <label for="f_problem">문제 상황(고객 불편)</label>
        <textarea id="f_problem" name="problem" placeholder="예: 방충망이 삭아서 찢어지고 벌레가 들어옴">${esc(j.problem)}</textarea>
        <label for="f_solution">해결 방법</label>
        <textarea id="f_solution" name="solution" placeholder="예: 미세방충망으로 전체 교체, 틈새 모헤어 보강">${esc(j.solution)}</textarea>
        <div class="grid2">
          <div><label for="f_dur">소요 시간</label><input id="f_dur" name="duration" value="${esc(j.duration)}" placeholder="예: 1시간 30분"></div>
          <div><label for="f_kw">키워드</label><input id="f_kw" name="keywords" value="${esc(j.keywords)}" placeholder="예: 수성구 방충망"></div>
        </div>
        <label for="f_blog">블로그 글 주소(발행 후)</label>
        <input id="f_blog" name="blogUrl" type="url" value="${esc(j.blogUrl)}" placeholder="https://blog.naver.com/...">
      </div>
      <button class="btn primary block" type="submit">💾 저장</button>
    </form>
    ${job ? `
    <div class="card" style="margin-top:12px">
      <div class="row spread"><h2 style="margin:0">사진</h2><span class="muted" id="photoCount"></span></div>
      <div class="chips" id="kindChips" style="margin-top:8px">${PHOTO_KINDS.map((k, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-k="${k}" type="button">${k}</button>`).join('')}</div>
      <div class="row">
        <label class="btn" style="margin:0;color:var(--ink)">📷 촬영<input id="camIn" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn" style="margin:0;color:var(--ink)">🖼 앨범<input id="albIn" type="file" accept="image/*" multiple hidden></label>
      </div>
      <div class="photos" id="photoGrid" style="margin-top:10px"></div>
    </div>
    <div class="card">
      <h2>입금</h2>
      <div id="payBox"></div>
      <div class="grid2">
        <div><label for="p_amt">금액(원)</label><input id="p_amt" type="number" inputmode="numeric" min="0" step="1000" placeholder="${j.quote ? esc(j.quote) : '0'}"></div>
        <div><label for="p_date">입금일</label><input id="p_date" type="date" value="${todayStr()}"></div>
      </div>
      <label for="p_method">방법</label>
      <select id="p_method">${opts(METHODS)}</select>
      <button class="btn block" id="addPay" type="button" style="margin-top:10px">+ 입금 기록</button>
    </div>
    <div class="card">
      <h2>현장 체크·견적·보고서</h2>
      <div class="row" style="margin-bottom:8px"><a class="btn block" href="#/fc/${job.id}">📋 현장 체크</a><a class="btn block" href="#/est/${job.id}">🧾 견적서</a><a class="btn block" href="#/rcpt/${job.id}">🧾 영수증</a></div>
      <a class="btn primary block" href="#/report/${job.id}" style="margin-bottom:8px">📄 현장 보고서 (사진으로 고객용 보고서)</a>
      <button class="btn block" id="copyBlog" type="button">📋 블로그 자료 복사</button>
      <div class="muted" style="margin-top:6px">지역·작업·제품·문제·해결·키워드를 정리해 복사합니다. Claude나 블로그 글쓰기에 붙여넣으세요.</div>
    </div>
    <button class="btn danger block" id="delJob" type="button">작업 삭제</button>` : ''}`;

  $('#f_phone').addEventListener('blur', (e) => { e.target.value = prettyPhone(e.target.value); });
  $('#f_sched').addEventListener('change', async (e) => {
    if (e.target.value && $('#f_status').value !== '완료') $('#f_status').value = '예약';
    if (e.target.value && isOfficeDay(await bizCfg(), e.target.value.slice(0, 10))) toast('🏢 이날은 관리사무소 근무일입니다');
  });
  if ($('#f_find')) {
    const all = await DB.all('customers');
    $('#f_find').oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      const hit = q ? all.filter((x) => [x.name, x.phone, digits(x.phone), x.area, x.address].join(' ').toLowerCase().includes(q)).slice(0, 6) : [];
      $('#f_found').innerHTML = hit.map((x) => `<button class="btn small block" data-cid="${x.id}" type="button" style="margin-top:4px;justify-content:flex-start">👤 ${esc(nameOf(x))} · ${esc(prettyPhone(x.phone))} · ${esc(x.area || '')}</button>`).join('');
      $('#f_found').querySelectorAll('[data-cid]').forEach((b) => { b.onclick = () => {
        const x = all.find((y) => y.id === b.dataset.cid); Object.assign(cust, x);
        $('#f_name').value = x.name || ''; $('#f_phone').value = prettyPhone(x.phone); $('#f_area').value = x.area || ''; $('#f_address').value = x.address || '';
        $('#f_found').innerHTML = `<div class="muted">✅ ${esc(nameOf(x))} 고객으로 접수합니다</div>`; $('#f_find').value = ''; }; });
    };
  }

  $('#jobForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    if (!f.name.trim() && !digits(f.phone)) { toast('이름이나 연락처를 넣어 주세요'); return; }
    const now = nowISO();
    // 고객: 기존 작업이면 그 고객을 고치고, 새 작업이면 같은 전화번호 고객을 찾아 연결
    let c = job ? cust : (cust.id ? cust : null);
    if (!c || !c.id) {
      const ph = digits(f.phone);
      if (ph) c = (await DB.all('customers')).find((x) => digits(x.phone) === ph) || null;
    }
    c = { ...(c || { id: uid(), createdAt: now }), name: f.name.trim(), phone: digits(f.phone), area: f.area.trim(), address: f.address.trim(), source: f.source, updatedAt: now };
    await DB.put('customers', c);
    const data = {
      ...(job || { id: uid(), createdAt: now }),
      customerId: c.id, status: f.status, type: f.type, product: f.product.trim(), area: f.area.trim(), address: f.address.trim(), source: f.source,
      wishDate: f.wishDate, scheduledAt: f.scheduledAt, quote: f.quote === '' ? '' : Number(f.quote), memo: f.memo.trim(), summary: f.summary.trim(), check: f.check.trim(),
      problem: f.problem.trim(), solution: f.solution.trim(), duration: f.duration.trim(), keywords: f.keywords.trim(), blogUrl: f.blogUrl.trim(),
      updatedAt: now,
    };
    if (data.status === '완료' && !data.doneAt) data.doneAt = now;
    await DB.put('jobs', data);
    toast('저장했습니다');
    if (!job) location.replace(`#/job/${data.id}`); else render();
  };

  if (!job) return;

  /* 사진 */
  let kind = PHOTO_KINDS[0];
  $('#kindChips').onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    kind = b.dataset.k;
    document.querySelectorAll('#kindChips .chip').forEach((x) => x.classList.toggle('on', x === b));
  };
  const urls = [];
  async function drawPhotos() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const ps = (await DB.by('photos', 'jobId', job.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    $('#photoCount').textContent = ps.length ? `${ps.length}장` : '';
    $('#photoGrid').innerHTML = ps.length ? '' : '<div class="muted" style="grid-column:1/-1">아직 사진이 없습니다.</div>';
    ps.forEach((p) => {
      const u = URL.createObjectURL(p.blob); urls.push(u);
      const d = document.createElement('div');
      d.className = 'photo';
      d.innerHTML = `<img src="${u}" alt="${esc(p.kind)} 사진" loading="lazy"><span>${esc(p.kind)}</span>`;
      d.onclick = () => openViewer(p, u, drawPhotos);
      $('#photoGrid').appendChild(d);
    });
  }
  async function addFiles(files) {
    if (!files || !files.length) return;
    toast('사진 저장 중…');
    let n = 0;
    for (const file of files) {
      try {
        const blob = await shrink(file, 1600, 0.82);
        await DB.put('photos', { id: uid(), jobId: job.id, kind, blob, createdAt: nowISO(), taken: file.lastModified ? new Date(file.lastModified).toISOString() : '' });
        n++;
      } catch (err) { console.error(err); }
    }
    toast(`사진 ${n}장 저장`);
    drawPhotos();
  }
  $('#camIn').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('#albIn').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  drawPhotos();

  /* 입금 */
  async function drawPays() {
    const ps = (await DB.by('payments', 'jobId', job.id)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const paid = ps.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const quote = Number((await DB.get('jobs', job.id)).quote) || 0;
    $('#payBox').innerHTML = `
      ${ps.length ? `<table><tbody>${ps.map((p) => `<tr><td>${esc(fmtDate(p.date))}</td><td>${esc(p.method)}</td><td class="r">${won(p.amount)}</td><td class="r"><button class="btn small danger" data-del="${p.id}" type="button">삭제</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted">입금 기록이 없습니다.</div>'}
      <div class="row spread" style="margin-top:8px"><span>받은 금액 <b>${won(paid)}</b></span><span>남은 금액 <b style="color:${quote - paid > 0 ? 'var(--red)' : 'inherit'}">${won(Math.max(0, quote - paid))}</b></span></div>`;
    $('#payBox').querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => { if (confirm('이 입금 기록을 지울까요?')) { await DB.del('payments', b.dataset.del); drawPays(); } };
    });
  }
  $('#addPay').onclick = async () => {
    const amt = Number($('#p_amt').value || $('#p_amt').placeholder);
    if (!amt) { toast('금액을 넣어 주세요'); return; }
    await DB.put('payments', { id: uid(), jobId: job.id, amount: amt, date: $('#p_date').value || todayStr(), method: $('#p_method').value, createdAt: nowISO() });
    $('#p_amt').value = '';
    toast('입금 기록했습니다');
    { const jj = await DB.get('jobs', job.id); const paidNow = (await DB.by('payments', 'jobId', job.id)).reduce((a, p) => a + (+p.amount || 0), 0);
      if (+jj.quote > 0 && paidNow >= +jj.quote && jj.status !== '완료' && confirm('입금이 다 됐습니다. 작업을 완료로 바꿀까요?')) { await DB.put('jobs', { ...jj, status: '완료', doneAt: jj.doneAt || nowISO(), updatedAt: nowISO() }); render(); return; } }
    drawPays();
  };
  drawPays();

  /* 블로그 자료 복사 (고객 이름·연락처·상세 주소 제외) */
  $('#copyBlog').onclick = async () => {
    const x = await DB.get('jobs', job.id);
    const ps = await DB.by('photos', 'jobId', job.id);
    const cnt = (k) => ps.filter((p) => p.kind === k).length;
    const text = [
      `[작업 사례] ${x.area || ''} / ${x.type || ''}`.trim(),
      `- 작업일: ${x.scheduledAt ? x.scheduledAt.slice(0, 10) : x.doneAt ? x.doneAt.slice(0, 10) : ''}`,
      `- 제품·크기: ${x.product || ''}`,
      `- 문제 상황: ${x.problem || ''}`,
      `- 해결 방법: ${x.solution || ''}`,
      `- 소요 시간: ${x.duration || ''}`,
      `- 키워드: ${x.keywords || ''}`,
      `- 사진: 시공 전 ${cnt('시공 전')}장, 시공 후 ${cnt('시공 후')}장, 기타 ${cnt('기타')}장`,
    ].join('\n');
    try { await navigator.clipboard.writeText(text); toast('블로그 자료를 복사했습니다'); }
    catch { prompt('아래 내용을 길게 눌러 복사하세요', text); }
  };

  $('#delJob').onclick = async () => {
    if (!confirm('이 작업과 사진·입금 기록을 모두 지울까요? 되돌릴 수 없습니다.')) return;
    for (const p of await DB.by('photos', 'jobId', job.id)) await DB.del('photos', p.id);
    for (const p of await DB.by('payments', 'jobId', job.id)) await DB.del('payments', p.id);
    await DB.del('jobs', job.id);
    toast('삭제했습니다');
    location.replace('#/jobs');
  };
}

/* 사진 줄이기: 긴 변 max px, JPEG */
function shrink(file, max, q) {
  return new Promise((res, rej) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(u);
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? res(b) : rej(new Error('사진 변환 실패'))), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('사진을 열 수 없습니다')); };
    img.src = u;
  });
}

function openViewer(p, url, after) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<img src="${url}" alt="사진 크게 보기"><div class="row">
    <button class="btn small" data-a="close" type="button">닫기</button>
    <select data-a="kind" style="width:auto">${opts(PHOTO_KINDS, p.kind)}</select>
    <button class="btn small" data-a="share" type="button">공유</button>
    <button class="btn small" data-a="mark" type="button">✏️ 표시</button>
    <button class="btn small danger" data-a="del" type="button">삭제</button></div>`;
  document.body.appendChild(v);
  const close = () => v.remove();
  v.querySelector('[data-a=close]').onclick = close;
  v.querySelector('[data-a=kind]').onchange = async (e) => { await DB.put('photos', { ...p, kind: e.target.value }); toast('구분을 바꿨습니다'); close(); after(); };
  v.querySelector('[data-a=share]').onclick = async () => {
    const f = new File([p.blob], `photo-${p.id}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); } catch { /* 취소 */ } }
    else toast('이 기기는 공유를 지원하지 않습니다');
  };
  v.querySelector('[data-a=del]').onclick = async () => { if (confirm('이 사진을 지울까요?')) { await DB.del('photos', p.id); close(); after(); } };
  v.querySelector('[data-a=mark]').onclick = () => { close(); markPhoto(p, after); };
}

/* ───────── 고객 ───────── */
async function viewCustomers() {
  setTitle('고객');
  const [custs, jobs, pays] = await Promise.all([DB.all('customers'), DB.all('jobs'), DB.all('payments')]);
  let q = '';
  function draw() {
    const list = custs.filter((c) => !q || [c.name, c.company, c.phone, c.area, c.address].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    $('#custList').innerHTML = list.length ? list.map((c) => {
      const js = jobs.filter((j) => j.customerId === c.id);
      const total = js.reduce((a, j) => a + paidOf(j.id, pays), 0);
      return `<a class="item" href="#/customer/${c.id}"><div class="row spread"><span class="t">${esc(nameOf(c))}</span><span class="muted">${js.length}건 · ${won(total)}</span></div>
        <div class="muted">${esc([prettyPhone(c.phone), c.area].filter(Boolean).join(' · '))}</div></a>`;
    }).join('') : '<div class="empty">고객이 없습니다. 작업을 저장하면 자동으로 생깁니다.</div>';
  }
  view().innerHTML = `<input id="q" type="search" placeholder="이름·업체명·전화·지역 검색" style="margin-bottom:10px"><a class="btn block" href="#/contacts" style="margin-bottom:10px">📇 연락처 가져오기·업체 찾기·단체 문자</a><div id="custList"></div>`;
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
  fab('#/job/new');
}

/* ───────── 매출 ───────── */
async function viewSales() {
  setTitle('매출');
  const [jobs, pays, custs] = await Promise.all([DB.all('jobs'), DB.all('payments'), DB.all('customers')]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const jmap = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const months = {};
  pays.forEach((p) => { const m = (p.date || '').slice(0, 7); if (m) months[m] = (months[m] || 0) + (Number(p.amount) || 0); });
  const keys = Object.keys(months).sort().reverse();
  let sel = keys.includes(monthStr()) ? monthStr() : keys[0] || monthStr();
  const unpaid = jobs.filter((j) => j.status === '완료').map((j) => ({ j, left: (Number(j.quote) || 0) - paidOf(j.id, pays) })).filter((x) => x.left > 0);
  const max = Math.max(1, ...Object.values(months));

  function draw() {
    const list = pays.filter((p) => (p.date || '').startsWith(sel)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('#payList').innerHTML = list.length ? `<table><thead><tr><th>날짜</th><th>고객·작업</th><th class="r">금액</th></tr></thead><tbody>${list.map((p) => {
      const j = jmap[p.jobId] || {}; const c = cmap[j.customerId] || {};
      return `<tr onclick="location.hash='#/job/${p.jobId}'" style="cursor:pointer"><td>${esc(fmtDate(p.date))}</td><td>${esc(nameOf(c))} · ${esc(j.type || '')}<div class="muted">${esc(p.method)}</div></td><td class="r">${won(p.amount)}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="muted">이 달 입금 기록이 없습니다.</div>';
    $('#selTotal').textContent = won(months[sel] || 0);
    document.querySelectorAll('#monthChips .chip').forEach((c) => c.classList.toggle('on', c.dataset.m === sel));
  }
  view().innerHTML = `
    <div class="card hero"><div class="muted">${esc(sel)} 매출(입금 기준)</div><b id="selTotal" style="font-size:26px"></b></div>
    <div class="card"><h2>월별</h2>
      ${keys.length ? keys.slice(0, 12).map((m) => `<div class="row" style="margin:4px 0"><span style="width:64px" class="muted">${m.slice(2).replace('-', '.')}</span>
        <div style="flex:1;background:var(--bg);border-radius:6px;height:14px"><div style="width:${Math.round(months[m] / max * 100)}%;background:var(--blue);height:100%;border-radius:6px"></div></div>
        <span style="width:100px;text-align:right;font-size:14px">${won(months[m])}</span></div>`).join('') : '<div class="muted">아직 입금 기록이 없습니다.</div>'}
    </div>
    <div class="chips" id="monthChips">${(keys.length ? keys : [sel]).map((m) => `<button class="chip" data-m="${m}">${m}</button>`).join('')}</div>
    <div class="card"><h2>입금 내역</h2><div id="payList"></div></div>
    <div class="card"><h2>미수금 (완료했지만 덜 받은 작업)</h2>
      ${unpaid.length ? unpaid.map(({ j, left }) => `<a class="item" href="#/job/${j.id}"><div class="row spread"><span class="t">${esc(nameOf(cmap[j.customerId]))}</span><b style="color:var(--red)">${won(left)}</b></div><div class="muted">${esc([j.type, j.area].filter(Boolean).join(' · '))}</div></a>`).join('') : '<div class="muted">미수금이 없습니다.</div>'}
    </div>`;
  $('#monthChips').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; sel = b.dataset.m; draw(); };
  draw();
}

/* ───────── 구글 시트 동기화 (2단계) ─────────
 * 시트 '문의' 탭 ↔ 앱 작업. 마지막 동기화 때 값(sheetBase)을 기억해 3자 비교:
 *  앱만 바뀜 → 앱 값을 시트로 / 시트만 바뀜 → 시트 값을 앱으로 / 둘 다 바뀜 → 앱 우선(메모는 두 쪽 줄을 합침)
 * 완료 작업의 블로그 자료는 '작업사례' 탭으로 보낸다. 고객 상세 주소는 시트로 보내지 않는다.
 */
const SHEET_KEYS = ['C', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'M', 'N', 'O'];
const normV = (k, v) => (k === 'D' ? digits(v) : String(v ?? '').replace(/\r/g, '').trim());
function appVals(j, c) {
  return { C: c.name || '', D: prettyPhone(c.phone) || '', E: j.area || '', F: j.type || '', G: j.product || '', H: j.wishDate || '', J: j.check || '', L: j.source || '', M: j.status || '', N: j.summary || '', O: j.memo || '' };
}
const rowVals = (r) => ({ C: r[2], D: r[3], E: r[4], F: r[5], G: r[6], H: r[7], J: r[9], L: r[11], M: r[12], N: r[13], O: r[14] });
function applyVals(j, c, v) {
  c.name = v.C || c.name || ''; c.phone = digits(v.D) || c.phone || ''; j.area = v.E; c.area = c.area || v.E; j.type = v.F; j.product = v.G; j.wishDate = v.H;
  j.check = v.J; j.source = v.L; c.source = c.source || v.L; j.status = v.M; j.summary = v.N; j.memo = v.O;
}
function mergeLines(a, b) {
  const have = new Set(String(a).split('\n').map((x) => x.trim()));
  const add = String(b).split('\n').filter((x) => x.trim() && !have.has(x.trim()));
  return [a, ...add].filter(Boolean).join('\n');
}
function missingOf(v, photoCount, photoLink) {
  const m = [];
  if (!v.C) m.push('고객 이름');
  if (!v.E) m.push('작업 지역');
  if (!v.F) m.push('작업 종류');
  if (!v.G) m.push('제품·작업 크기');
  if (!v.H) m.push('희망 날짜');
  if (!photoCount && !photoLink) m.push('현장 사진');
  return m.join(', ');
}
const sheetTime = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 16).replace(' ', 'T') : '');
const isoToSheet = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '');

async function callSheet(action, extra) {
  const cfg = await getSetting('sheet', {});
  if (!cfg.url || !cfg.key) throw new Error('설정에서 시트 웹 앱 주소와 비밀 키를 먼저 넣어 주세요');
  let r, t;
  // 구글 스크립트는 오래 안 쓰면 처음 응답이 10~20초 걸릴 수 있어 40초까지 기다리고, 넘으면 멈춘 채로 두지 않고 알려 준다.
  // 시트에 줄을 쓰는 요청이 두 번 들어가지 않게 자동 재시도는 하지 않는다.
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 40000);
  try {
    // kind '연결 테스트'를 같이 보내 옛 스크립트(v1)가 시트에 줄을 추가하지 않게 한다
    r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ key: cfg.key, kind: '연결 테스트', action, ...extra }), signal: ac.signal });
    t = await r.text();
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? '시트 연결이 너무 느립니다(40초). 잠시 뒤 다시 시도하세요 — 시트에 이미 들어갔을 수 있으니 시트를 먼저 확인하세요' : '인터넷 연결이나 웹 앱 주소를 확인하세요');
  } finally { clearTimeout(timer); }
  if (t.trim() === 'test ok') throw new Error('시트 스크립트가 옛 버전입니다. 새 코드로 바꾸고 새 버전으로 배포해 주세요');
  if (t.trim() === 'denied') throw new Error('비밀 키가 다릅니다');
  let d;
  try { d = JSON.parse(t); } catch { throw new Error('시트 응답을 읽지 못했습니다(웹 앱 주소·배포 설정 확인)'); }
  if (!d.ok) throw new Error(d.error === 'denied' ? '비밀 키가 다릅니다' : d.error || '시트 오류');
  return d;
}

async function syncSheet() {
  const ping = await callSheet('ping');
  if (!ping.version || ping.version < 2) throw new Error('시트 스크립트를 새 버전으로 바꿔 주세요');
  const { rows } = await callSheet('pull');
  const [jobs, custs, photos] = await Promise.all([DB.all('jobs'), DB.all('customers'), DB.all('photos')]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const photoCnt = (id) => photos.filter((p) => p.jobId === id).length;
  const byId = Object.fromEntries(jobs.filter((j) => j.sheetId).map((j) => [j.sheetId, j]));
  const now = nowISO();
  const updates = [], appends = [], cases = [], touched = new Map();
  let created = 0, fromSheet = 0;

  for (const r of rows) {
    const sv = rowVals(r);
    let j = byId[r[0]];
    if (!j) {
      // 아직 연결 안 된 시트 줄: 같은 번호의 진행 중 앱 작업이 있으면 연결, 없으면 새로 만든다
      const ph = digits(r[3]);
      j = ph && jobs.find((x) => !x.sheetId && !touched.has(x.id) && ['접수', '견적', '예약'].includes(x.status) && digits((cmap[x.customerId] || {}).phone) === ph);
      if (j) { j.sheetId = r[0]; j.sheetBase = null; }
      else {
        let c = ph ? custs.find((x) => digits(x.phone) === ph) : null;
        if (!c) { c = { id: uid(), createdAt: now, name: '', phone: '', area: '', source: '' }; custs.push(c); cmap[c.id] = c; }
        j = { id: uid(), createdAt: sheetTime(r[1]) || now, customerId: c.id, sheetId: r[0], status: '접수' };
        applyVals(j, c, sv);
        j.sheetBase = sv; j.photoLink = r[8]; j.missing = r[10]; j.syncedAt = now; j.updatedAt = now;
        jobs.push(j); touched.set(j.id, c); created++;
        continue;
      }
    }
    const c = cmap[j.customerId] || (cmap[j.customerId] = { id: j.customerId, createdAt: now });
    const av = appVals(j, c), base = j.sheetBase || {}, res = {}, cols = {};
    let sheetWon = false;
    for (const k of SHEET_KEYS) {
      const a = av[k], s = sv[k] ?? '', b = base[k];
      let v;
      if (normV(k, a) === normV(k, s)) v = a;
      else if (!j.sheetBase) v = k === 'O' || k === 'N' ? mergeLines(a, s) : a || s; // 처음 연결: 메모·요약은 합치고, 나머지는 앱 값 우선(비었으면 시트 값)
      else if (normV(k, a) === normV(k, b)) { v = s; sheetWon = true; } // 시트에서만 바뀜
      else if (normV(k, s) === normV(k, b)) v = a; // 앱에서만 바뀜
      else v = k === 'O' ? mergeLines(a, s) : a; // 둘 다 바뀜
      res[k] = v;
      if (normV(k, v) !== normV(k, s)) cols[k] = v;
      if (normV(k, v) !== normV(k, a)) sheetWon = true;
    }
    // 빠진 항목(K)은 문의 정리 작업이 더 자세히 적으므로 이미 있는 줄은 건드리지 않는다(새 줄만 앱이 계산)
    const miss = r[10];
    if (Object.keys(cols).length) updates.push({ id: r[0], cols });
    if (sheetWon) { applyVals(j, c, res); fromSheet++; }
    j.sheetBase = res; j.photoLink = r[8]; j.missing = miss; j.syncedAt = now;
    touched.set(j.id, c);
  }

  // 시트에 없는 앱 작업 → 새 줄로 추가
  for (const j of jobs) {
    if (j.sheetId) continue;
    const c = cmap[j.customerId] || {};
    const v = appVals(j, c), miss = missingOf(v, photoCnt(j.id), '');
    appends.push({ tmp: j.id, row: [isoToSheet(j.createdAt), v.C, v.D, v.E, v.F, v.G, v.H, '', v.J, miss, v.L, v.M, v.N, v.O] });
    j.sheetBase = v; j.missing = miss; j.syncedAt = now;
    touched.set(j.id, c);
  }

  // 완료 작업의 블로그 자료 → 작업사례
  for (const j of jobs) {
    if (j.status !== '완료' || !(j.problem || j.solution || j.keywords || j.blogUrl)) continue;
    cases.push({
      inquiryId: j.sheetId || '', tmp: j.sheetId ? '' : j.id,
      row: { date: (j.scheduledAt || j.doneAt || '').slice(0, 10), area: j.area || '', type: j.type || '', product: j.product || '', duration: j.duration || '', problem: j.problem || '', solution: j.solution || '', keywords: j.keywords || '', published: j.blogUrl ? 'Y' : 'N', url: j.blogUrl || '' },
    });
  }

  const res = await callSheet('push', { updates, appends, cases });
  for (const a of res.appended || []) { const j = jobs.find((x) => x.id === a.tmp); if (j) j.sheetId = a.id; }
  for (const [id, c] of touched) {
    const j = jobs.find((x) => x.id === id);
    if (c && c.id) await DB.put('customers', c);
    await DB.put('jobs', j);
  }
  await setSetting('lastSync', Date.now());
  return { created, fromSheet, sent: updates.length, added: (res.appended || []).length, cases: res.cases || 0 };
}

/* ───────── 구글 캘린더(읽기 전용) ─────────
   시트 스크립트 v4의 gcal로 지난 7일~앞으로 60일 일정을 받아 settings 'gcal'에 저장한다.
   앱에서 캘린더를 고치지는 않는다(보기 전용). */
async function syncGcal() {
  const r = await callSheet('gcal', { from: addDays(-7), to: addDays(60) });
  const events = (r.events || []).map((e) => ({ id: String(e.id), title: String(e.title || ''), start: String(e.start || ''), end: String(e.end || ''), allDay: !!e.allDay, location: String(e.location || ''), cal: String(e.cal || '') }));
  await setSetting('gcal', { at: Date.now(), events });
  return events.length;
}
async function gcalEvents() { return ((await getSetting('gcal', null)) || {}).events || []; }
// 그날 보일 일정: 종일 일정은 end 전날까지, 시간 일정은 시작일~끝나는 날
function gcalOn(evs, d) {
  return evs.filter((e) => {
    const s = e.start.slice(0, 10);
    if (e.allDay) return s <= d && d < (e.end || addD(s, 1));
    const en = (e.end || e.start).slice(0, 10);
    const endsAtMidnight = (e.end || '').slice(11, 16) === '00:00';
    return s === d || (s < d && (d < en || (d === en && !endsAtMidnight)));
  });
}
const gcalTime = (e, d) => (e.allDay ? '종일' : e.start.slice(0, 10) === d ? e.start.slice(11, 16) : '계속');
function gcalInfo(e) {
  alert(`📆 ${e.title}\n${e.allDay ? `${fmtDate(e.start)} 종일` : `${fmtDate(e.start)} ${e.start.slice(11, 16)} ~ ${e.end.slice(0, 10) === e.start.slice(0, 10) ? e.end.slice(11, 16) : fmtDate(e.end) + ' ' + e.end.slice(11, 16)}`}${e.location ? `\n📍 ${e.location}` : ''}\n캘린더: ${e.cal}\n\n※ 구글 캘린더 일정은 보기만 됩니다. 수정은 구글 캘린더 앱에서 하세요.`);
}

async function runSync(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '동기화 중…'; }
  try {
    const r = await syncSheet();
    let cal = '';
    try { cal = ` · 캘린더 ${await syncGcal()}건`; }
    catch (e) { cal = /옛 버전|새 버전/.test(e.message) ? ' · 캘린더: 시트 스크립트 v4로 바꿔야 함' : ` · 캘린더 실패(${e.message})`; }
    toast(`동기화 완료: 새로 가져옴 ${r.created} · 시트 반영 ${r.fromSheet} · 시트로 보냄 ${r.sent + r.added} · 작업사례 ${r.cases}${cal}`);
    render();
  } catch (e) {
    alert('동기화 실패: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '🔄 구글 시트 동기화'; }
  }
}

/* ───────── 설정·백업 ───────── */
async function viewSettings() {
  setTitle('설정');
  const L = await lists();
  const last = await getSetting('lastBackup', null);
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(1)}MB 사용`; } catch { /* 미지원 */ }
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const sheetCfg = await getSetting('sheet', {});
  const lastSync = await getSetting('lastSync', null);
  view().innerHTML = `
    <div class="card">
      <h2>구글 시트 연결 <span class="muted">(선택)</span></h2>
      <div class="muted">'Google Sheet DB'의 문의 탭과 작업을 주고받습니다. NO.1 콜백으로 들어온 문의도 여기로 들어옵니다.</div>
      <label for="s_url">웹 앱 주소</label>
      <input id="s_url" value="${esc(sheetCfg.url)}" placeholder="https://script.google.com/macros/s/.../exec">
      <label for="s_key">비밀 키</label>
      <input id="s_key" type="password" value="${esc(sheetCfg.key)}" placeholder="텔레그램으로 받은 키">
      <div class="row" style="margin-top:10px">
        <button class="btn" id="s_save" type="button">💾 저장·연결 확인</button>
        <button class="btn primary" id="s_sync" type="button">🔄 지금 동기화</button>
      </div>
      <div class="muted" style="margin-top:6px">마지막 동기화: ${lastSync ? new Date(lastSync).toLocaleString('ko-KR') : '없음'}</div>
    </div>
    <div class="card">
      <h2>백업 (꼭 해 주세요)</h2>
      <div class="muted">데이터는 이 폰에만 있습니다. 백업 파일을 받아 구글 드라이브·PC 등에 보관하세요.</div>
      <div class="muted">마지막 백업: ${last ? new Date(last).toLocaleString('ko-KR') : '없음'} · ${esc(usage)} · 저장 보호 ${persisted ? '켜짐' : '꺼짐'}</div>
      <button class="btn primary block" id="exportBtn" type="button" style="margin-top:10px">⬇ 백업 파일 받기</button>
      <label class="btn block" style="margin-top:8px;color:var(--ink)">⬆ 백업 파일로 복원<input id="importIn" type="file" accept="application/json,.json" hidden></label>
    </div>
    <div class="card">
      <h2>작업 종류</h2>
      <textarea id="typesTa" rows="6">${esc(L.jobTypes.join('\n'))}</textarea>
      <h2 style="margin-top:12px">유입 경로</h2>
      <textarea id="srcTa" rows="5">${esc(L.sources.join('\n'))}</textarea>
      <div class="muted">한 줄에 하나씩. 순서대로 목록에 나옵니다.</div>
      <button class="btn block" id="saveLists" type="button" style="margin-top:10px">💾 목록 저장</button>
    </div>
    <div class="card">
      <h2>앱 정보</h2>
      <div class="muted">ONE LIFE AI v${APP_VERSION} · 1단계(홈 + 사업 관리)<br>폰 홈 화면에 추가: 크롬 ⋮ → '홈 화면에 추가' 또는 '앱 설치'</div>
      ${updButton(APP_VERSION)}
    </div>`;

  $('#saveLists').onclick = async () => {
    const parse = (s) => [...new Set(s.split('\n').map((x) => x.trim()).filter(Boolean))];
    const jobTypes = parse($('#typesTa').value), sources = parse($('#srcTa').value);
    if (!jobTypes.length || !sources.length) { toast('목록이 비어 있습니다'); return; }
    await setSetting('lists', { jobTypes, sources });
    toast('목록을 저장했습니다');
  };
  $('#s_save').onclick = async () => {
    const url = $('#s_url').value.trim(), key = $('#s_key').value.trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { toast('웹 앱 주소 형식이 아닙니다(…/exec 로 끝나야 함)'); return; }
    await setSetting('sheet', { url, key });
    if (!url) { toast('시트 연결을 껐습니다'); return; }
    try { const p = await callSheet('ping'); toast(p.version >= 2 ? '✅ 시트 연결 확인' : '시트 스크립트를 새 버전으로 바꿔 주세요'); }
    catch (e) { alert('연결 실패: ' + e.message); }
  };
  $('#s_sync').onclick = async (e) => {
    await setSetting('sheet', { url: $('#s_url').value.trim(), key: $('#s_key').value.trim() });
    runSync(e.target);
  };
  $('#exportBtn').onclick = exportBackup;
  $('#importIn').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!confirm('지금 폰에 있는 데이터를 모두 지우고 백업 파일 내용으로 바꿉니다. 계속할까요?')) return;
    try { await importBackup(await f.text()); toast('복원했습니다'); location.hash = '#/'; }
    catch (err) { alert('복원 실패: ' + err.message); }
  };
}

const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }

const BACKUP_STORES = ['customers', 'jobs', 'payments', 'photos', 'settings', 'tasks', 'notes', 'office', 'schedules', 'invest', 'mkt', 'sport', 'expense'];
async function exportBackup() {
  toast('백업 파일 만드는 중…');
  const [customers, jobs, payments, photos, settings, tasks, notes, office, schedules, invest, mkt, sport, expense] = await Promise.all(BACKUP_STORES.map((s) => DB.all(s)));
  const ph = [];
  for (const p of photos) ph.push({ ...p, blob: undefined, data: await blobToDataURL(p.blob) });
  const nt = [];
  for (const n of notes) nt.push({ ...n, photo: undefined, photoData: n.photo ? await blobToDataURL(n.photo) : '', audio: undefined, audioData: n.audio ? await blobToDataURL(n.audio) : '' });
  const out = { app: 'ONE LIFE AI', version: APP_VERSION, exportedAt: nowISO(), customers, jobs, payments, settings: settings.filter((s) => s.key !== 'lastBackup' && s.key !== 'vault') /* 계정 메모(암호화)는 백업에서 뺌 */, photos: ph, tasks, notes: nt, office, schedules, invest, mkt, sport, expense };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const name = `onelife-backup-${todayStr()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  let done = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); done = true; } catch (e) { if (e.name === 'AbortError') return; }
  }
  if (!done) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  await setSetting('lastBackup', Date.now());
  toast('백업 파일을 만들었습니다');
}

async function importBackup(text) {
  const d = JSON.parse(text);
  if (d.app !== 'ONE LIFE AI' || !Array.isArray(d.jobs)) throw new Error('ONE LIFE AI 백업 파일이 아닙니다');
  const photos = [];
  for (const p of d.photos || []) { const { data, ...rest } = p; photos.push({ ...rest, blob: await dataURLToBlob(data) }); }
  const notes = [];
  for (const n of d.notes || []) { const { photoData, audioData, ...rest } = n; notes.push({ ...rest, photo: photoData ? await dataURLToBlob(photoData) : null, audio: audioData ? await dataURLToBlob(audioData) : null }); }
  for (const s of BACKUP_STORES) await DB.clear(s);
  for (const x of d.customers || []) await DB.put('customers', x);
  for (const x of d.jobs) await DB.put('jobs', x);
  for (const x of d.payments || []) await DB.put('payments', x);
  for (const x of photos) await DB.put('photos', x);
  for (const x of d.settings || []) await DB.put('settings', x);
  for (const x of d.tasks || []) await DB.put('tasks', x);
  for (const x of notes) await DB.put('notes', x);
  for (const x of d.office || []) await DB.put('office', x);
  for (const x of d.schedules || []) await DB.put('schedules', x);
  for (const x of d.invest || []) await DB.put('invest', x);
  for (const x of d.mkt || []) await DB.put('mkt', x);
  for (const x of d.sport || []) await DB.put('sport', x);
  for (const x of d.expense || []) await DB.put('expense', x);
  await setSetting('lastBackup', Date.now());
}

/* ───────── 시작 ───────── */
(async () => {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* 무시 */ }
  if ('serviceWorker' in navigator) {
    const hadSW = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // 앱을 다시 볼 때마다 새 버전이 있는지 확인
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    // 새 버전이 켜지면 화면을 한 번 새로 불러온다. 쓰는 중인 화면이면 지우지 않도록 알림만
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadSW || reloaded) return;
      if (/#\/(new|edit|copy)|#\/(job|ledger)\/|#\/rcpt\/new/.test(location.hash) || document.querySelector('input:focus, textarea:focus')) { toast('새 버전이 나왔습니다. 저장한 뒤 앱을 다시 열면 바뀝니다'); return; }
      reloaded = true; location.reload();
    });
  }
  render();
})();
