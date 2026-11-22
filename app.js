/* ONE LIFE AI — 1단계: 홈 + 사업 관리
 * 모든 데이터는 이 폰(브라우저)의 IndexedDB에만 저장된다. 서버로 보내지 않는다.
 */
'use strict';

const APP_VERSION = '0.2.0';
const STATUSES = ['접수', '견적', '예약', '완료', '취소'];
const METHODS = ['계좌이체', '현금', '카드', '기타'];
const PHOTO_KINDS = ['시공 전', '시공 후', '기타'];
const DEFAULT_LISTS = {
  jobTypes: ['방충망 교체', '방충망 수리', '안전방충망', 'TV 설치', '타일', '기타'],
  sources: ['블로그', '전화', '지인', '문자·카톡', '기타'],
};

/* ───────── 저장소(IndexedDB) ───────── */
const DB = (() => {
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('onelife', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('customers', { keyPath: 'id' });
        d.createObjectStore('jobs', { keyPath: 'id' }).createIndex('customerId', 'customerId');
        d.createObjectStore('payments', { keyPath: 'id' }).createIndex('jobId', 'jobId');
        d.createObjectStore('photos', { keyPath: 'id' }).createIndex('jobId', 'jobId');
        d.createObjectStore('settings', { keyPath: 'key' });
      };
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
  return { ...DEFAULT_LISTS, ...(l || {}) };
}

/* ───────── 도우미 ───────── */
const $ = (s, el = document) => el.querySelector(s);
const view = () => $('#view');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (Number(n) || 0).toLocaleString('ko-KR') + '원';
const digits = (s) => String(s || '').replace(/\D/g, '');
function prettyPhone(s) {
  const d = digits(s);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return d.startsWith('02') ? `02-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return s || '';
}
const pad = (n) => String(n).padStart(2, '0');
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
const nameOf = (c) => (c && c.name) || (c && c.phone ? `이름 미확인(${digits(c.phone).slice(-4)})` : '이름 미확인');

/* ───────── 라우터 ───────── */
const routes = [
  [/^#?\/?$/, 'home', viewHome],
  [/^#\/jobs$/, 'jobs', viewJobs],
  [/^#\/job\/new$/, 'jobs', () => viewJob(null)],
  [/^#\/job\/([\w-]+)$/, 'jobs', (m) => viewJob(m[1])],
  [/^#\/customers$/, 'customers', viewCustomers],
  [/^#\/customer\/([\w-]+)$/, 'customers', (m) => viewCustomer(m[1])],
  [/^#\/sales$/, 'sales', viewSales],
  [/^#\/settings$/, 'settings', viewSettings],
];
async function render() {
  const h = location.hash || '#/';
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
async function viewHome() {
  setTitle('ONE LIFE AI');
  const [jobs, pays, custs, lastBackup, sheetCfg, lastSync] = await Promise.all([DB.all('jobs'), DB.all('payments'), DB.all('customers'), getSetting('lastBackup', null), getSetting('sheet', {}), getSetting('lastSync', null)]);
  const sheetOn = !!(sheetCfg && sheetCfg.url && sheetCfg.key);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const today = todayStr();
  const week = new Date(); week.setDate(week.getDate() + 7);
  const weekStr = `${week.getFullYear()}-${pad(week.getMonth() + 1)}-${pad(week.getDate())}`;
  const upcoming = jobs.filter((j) => j.status === '예약' && j.scheduledAt && j.scheduledAt.slice(0, 10) >= today && j.scheduledAt.slice(0, 10) <= weekStr)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const overdue = jobs.filter((j) => j.status === '예약' && j.scheduledAt && j.scheduledAt.slice(0, 10) < today);
  const waiting = jobs.filter((j) => j.status === '접수' || j.status === '견적').length;
  const month = monthStr();
  const monthSales = pays.filter((p) => (p.date || '').startsWith(month)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const unpaid = jobs.filter((j) => j.status === '완료').reduce((a, j) => a + Math.max(0, (Number(j.quote) || 0) - paidOf(j.id, pays)), 0);
  const daysSinceBackup = lastBackup ? Math.floor((Date.now() - lastBackup) / 864e5) : null;
  const needBackup = jobs.length > 0 && (daysSinceBackup === null || daysSinceBackup >= 7);

  const line = (j) => {
    const c = cmap[j.customerId] || {};
    return `<a class="item" href="#/job/${j.id}"><div class="row spread"><span class="t">${esc(fmtDate(j.scheduledAt))} · ${esc(nameOf(c))}</span><span class="badge s-${j.status}">${j.status}</span></div>
      <div class="muted">${esc([j.area || c.area, j.type, j.product].filter(Boolean).join(' · '))}</div></a>`;
  };

  view().innerHTML = `
    <div class="card hero">
      <div class="muted">${esc(fmtDate(today))} 오늘</div>
      <div style="font-size:20px;font-weight:800;margin-top:2px">개인사업 현황</div>
      <div class="grid2" style="margin-top:10px">
        <div><div class="muted">이번 달 매출(입금)</div><b style="font-size:22px">${won(monthSales)}</b></div>
        <div><div class="muted">미수금</div><b style="font-size:22px;color:${unpaid ? '#FFD1D1' : '#fff'}">${won(unpaid)}</b></div>
      </div>
    </div>
    ${needBackup ? `<div class="card warnbox"><b>백업이 필요합니다</b><div class="muted">${daysSinceBackup === null ? '아직 한 번도 백업하지 않았습니다.' : `마지막 백업 ${daysSinceBackup}일 전.`} 폰 데이터가 지워지면 복구할 수 없습니다.</div><a class="btn small" style="margin-top:8px" href="#/settings">백업하러 가기</a></div>` : ''}
    <div class="grid2" style="margin-bottom:12px">
      <a class="stat" href="#/jobs" onclick="sessionStorage.setItem('jobsTab','대기')" style="text-decoration:none;color:inherit"><span class="muted">처리 대기(접수·견적)</span><b>${waiting}건</b></a>
      <a class="stat ${overdue.length ? 'warn' : ''}" href="#/jobs" onclick="sessionStorage.setItem('jobsTab','예약')" style="text-decoration:none;color:inherit"><span class="muted">지난 예약(완료 처리 안 함)</span><b>${overdue.length}건</b></a>
    </div>
    <div class="card">
      <h2>앞으로 7일 예약</h2>
      ${upcoming.length ? upcoming.map(line).join('') : '<div class="muted">예약된 작업이 없습니다.</div>'}
    </div>
    <div class="row" style="margin-bottom:12px">
      <a class="btn primary block" href="#/job/new" style="flex:2">+ 새 문의·작업</a>
      ${sheetOn ? '<button class="btn" id="homeSync" type="button" style="flex:1">🔄 시트</button>' : ''}
    </div>
    ${sheetOn ? `<div class="muted" style="margin:-6px 0 12px;text-align:right">시트 동기화: ${lastSync ? esc(new Date(lastSync).toLocaleString('ko-KR')) : '아직 안 함'}</div>` : ''}
    <div class="card">
      <h2>ONE LIFE 모듈</h2>
      <div class="tiles">
        <a class="tile" href="#/jobs"><i>🛠</i>사업 관리</a>
        <span class="tile off"><i>🏢</i>관리사무소<br><small>준비 중</small></span>
        <span class="tile off"><i>🤖</i>AI 비서<br><small>준비 중</small></span>
        <span class="tile off"><i>📈</i>투자 분석<br><small>준비 중</small></span>
        <span class="tile off"><i>🏃</i>마라톤<br><small>준비 중</small></span>
        <span class="tile off"><i>🤿</i>프리다이빙<br><small>준비 중</small></span>
      </div>
    </div>
    <div class="muted" style="text-align:center">v${APP_VERSION} · 데이터는 이 폰에 저장${sheetOn ? ' · 구글 시트 동기화 켜짐' : ''}</div>`;
  if (sheetOn) $('#homeSync').onclick = (e) => runSync(e.target);
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
  const cust = job ? (await DB.get('customers', job.customerId)) || {} : {};
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
        <select id="f_type" name="type">${opts(typeList, j.type)}</select>
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
      <h2>블로그·공유</h2>
      <button class="btn block" id="copyBlog" type="button">📋 블로그 자료 복사</button>
      <div class="muted" style="margin-top:6px">지역·작업·제품·문제·해결·키워드를 정리해 복사합니다. Claude나 블로그 글쓰기에 붙여넣으세요.</div>
    </div>
    <button class="btn danger block" id="delJob" type="button">작업 삭제</button>` : ''}`;

  $('#f_phone').addEventListener('blur', (e) => { e.target.value = prettyPhone(e.target.value); });
  $('#f_sched').addEventListener('change', (e) => { if (e.target.value && $('#f_status').value !== '완료') $('#f_status').value = '예약'; });

  $('#jobForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    if (!f.name.trim() && !digits(f.phone)) { toast('이름이나 연락처를 넣어 주세요'); return; }
    const now = new Date().toISOString();
    // 고객: 기존 작업이면 그 고객을 고치고, 새 작업이면 같은 전화번호 고객을 찾아 연결
    let c = job ? cust : null;
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
        await DB.put('photos', { id: uid(), jobId: job.id, kind, blob, createdAt: new Date().toISOString(), taken: file.lastModified ? new Date(file.lastModified).toISOString() : '' });
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
    await DB.put('payments', { id: uid(), jobId: job.id, amount: amt, date: $('#p_date').value || todayStr(), method: $('#p_method').value, createdAt: new Date().toISOString() });
    $('#p_amt').value = '';
    toast('입금 기록했습니다');
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
}

/* ───────── 고객 ───────── */
async function viewCustomers() {
  setTitle('고객');
  const [custs, jobs, pays] = await Promise.all([DB.all('customers'), DB.all('jobs'), DB.all('payments')]);
  let q = '';
  function draw() {
    const list = custs.filter((c) => !q || [c.name, c.phone, c.area].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    $('#custList').innerHTML = list.length ? list.map((c) => {
      const js = jobs.filter((j) => j.customerId === c.id);
      const total = js.reduce((a, j) => a + paidOf(j.id, pays), 0);
      return `<a class="item" href="#/customer/${c.id}"><div class="row spread"><span class="t">${esc(nameOf(c))}</span><span class="muted">${js.length}건 · ${won(total)}</span></div>
        <div class="muted">${esc([prettyPhone(c.phone), c.area].filter(Boolean).join(' · '))}</div></a>`;
    }).join('') : '<div class="empty">고객이 없습니다. 작업을 저장하면 자동으로 생깁니다.</div>';
  }
  view().innerHTML = `<input id="q" type="search" placeholder="이름·전화·지역 검색" style="margin-bottom:10px"><div id="custList"></div>`;
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
  fab('#/job/new');
}

async function viewCustomer(id) {
  const c = await DB.get('customers', id);
  setTitle(c ? nameOf(c) : '고객', true);
  if (!c) { view().innerHTML = '<div class="empty">고객을 찾을 수 없습니다.</div>'; return; }
  const [jobs, pays] = await Promise.all([DB.by('jobs', 'customerId', id), DB.all('payments')]);
  jobs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const total = jobs.reduce((a, j) => a + paidOf(j.id, pays), 0);
  view().innerHTML = `
    <div class="card">
      <div class="t" style="font-size:20px;font-weight:800">${esc(nameOf(c))}</div>
      <div class="muted">${esc([prettyPhone(c.phone), c.area, c.address].filter(Boolean).join(' · '))}</div>
      <div class="muted">유입: ${esc(c.source || '-')} · 작업 ${jobs.length}건 · 받은 금액 ${won(total)}</div>
      ${c.phone ? `<div class="row" style="margin-top:10px"><a class="btn small" href="tel:${digits(c.phone)}">📞 전화</a><a class="btn small" href="sms:${digits(c.phone)}">💬 문자</a></div>` : ''}
    </div>
    <h2 style="font-size:16px">작업 이력</h2>
    ${jobs.map((j) => `<a class="item" href="#/job/${j.id}"><div class="row spread"><span class="t">${esc(j.type || '작업')}</span><span class="badge s-${j.status}">${j.status}</span></div>
      <div class="muted">${esc([j.scheduledAt ? fmtDate(j.scheduledAt) : (j.createdAt || '').slice(0, 10), j.product, j.quote ? won(j.quote) : ''].filter(Boolean).join(' · '))}</div></a>`).join('') || '<div class="empty">작업이 없습니다.</div>'}
    <button class="btn danger block" id="delCust" type="button" style="margin-top:12px">고객 삭제</button>`;
  $('#delCust').onclick = async () => {
    if (jobs.length) { toast('작업이 남아 있어 지울 수 없습니다. 작업을 먼저 지우세요.'); return; }
    if (confirm('이 고객을 지울까요?')) { await DB.del('customers', id); location.replace('#/customers'); }
  };
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
  let r;
  try {
    // kind '연결 테스트'를 같이 보내 옛 스크립트(v1)가 시트에 줄을 추가하지 않게 한다
    r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ key: cfg.key, kind: '연결 테스트', action, ...extra }) });
  } catch { throw new Error('인터넷 연결이나 웹 앱 주소를 확인하세요'); }
  const t = await r.text();
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
  const now = new Date().toISOString();
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
    const miss = missingOf(res, photoCnt(j.id), r[8]);
    if (miss !== r[10]) cols.K = miss;
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

async function runSync(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '동기화 중…'; }
  try {
    const r = await syncSheet();
    toast(`동기화 완료: 새로 가져옴 ${r.created} · 시트 반영 ${r.fromSheet} · 시트로 보냄 ${r.sent + r.added} · 작업사례 ${r.cases}`);
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

async function exportBackup() {
  toast('백업 파일 만드는 중…');
  const [customers, jobs, payments, photos, settings] = await Promise.all(['customers', 'jobs', 'payments', 'photos', 'settings'].map((s) => DB.all(s)));
  const ph = [];
  for (const p of photos) ph.push({ ...p, blob: undefined, data: await blobToDataURL(p.blob) });
  const out = { app: 'ONE LIFE AI', version: APP_VERSION, exportedAt: new Date().toISOString(), customers, jobs, payments, settings: settings.filter((s) => s.key !== 'lastBackup'), photos: ph };
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
  for (const s of ['customers', 'jobs', 'payments', 'photos', 'settings']) await DB.clear(s);
  for (const x of d.customers || []) await DB.put('customers', x);
  for (const x of d.jobs) await DB.put('jobs', x);
  for (const x of d.payments || []) await DB.put('payments', x);
  for (const x of photos) await DB.put('photos', x);
  for (const x of d.settings || []) await DB.put('settings', x);
  await setSetting('lastBackup', Date.now());
}

/* ───────── 시작 ───────── */
(async () => {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* 무시 */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
})();
