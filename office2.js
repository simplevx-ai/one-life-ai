/* ONE LIFE AI — 관리실 업무수첩 (관리사무소 모듈 확장)
 * 점검 체크리스트·점검 실행·점검 기록(이상만·수치 추이·월간 보고서), 민원 접수·처리·통계, 업체 작업 이력(설비별),
 * 업무일지(자동 + 직접 메모 + 인수인계란, 내보내기), 단지 설정(동·호 목록·직원·업체·시험일), 새 관리사무소 홈.
 * office.js 다음, app.js 앞에 불러온다. 데이터: office(kind로 구분), schedules(점검 목록, items=체크리스트), photos.
 * 2차(미포함): 검침(숫자 인식), QR로 체크리스트 열기, 공부(문제 풀기).
 */
'use strict';

const CMP_CATS = ['누수', '소음', '주차', '시설', '기타'];
const CMP_STATUS = ['접수', '처리중', '완료'];
const INSP_CYCLES = ['매일', '매주', '매월', '분기', '반기', '매년'];
const CHECK_STATES = ['정상', '이상', '해당없음'];
// 기본 체크리스트(예시). 단지 기준에 맞게 고쳐 쓰는 것을 전제로 한다
const CHECK_TEMPLATES = {
  '일일 순찰': { cat: '기타', cycle: '매일', items: [['공용 조명 점등'], ['출입문·비상구 상태'], ['주차장 배수·누수'], ['승강기 운행'], ['소화기 위치·상태'], ['분리수거장 정리']] },
  '소방 작동점검': { cat: '소방', cycle: '매월', items: [['수신기 상태(화재·고장 표시)'], ['옥내소화전 펌프 압력', 'MPa'], ['스프링클러 펌프 압력', 'MPa'], ['유도등 점등'], ['비상방송 작동']] },
  '저수조': { cat: '기계', cycle: '매월', items: [['저수조 수위', '%'], ['잔류염소', 'mg/L'], ['맨홀 잠금'], ['누수·이물질']] },
  '기계실·펌프': { cat: '기계', cycle: '매주', items: [['급수펌프 토출압력', 'MPa'], ['배수펌프 작동'], ['누수·이상 소음'], ['기동반 표시']] },
  '전기실': { cat: '전기', cycle: '매주', items: [['수전 전압', 'V'], ['변압기 온도', '℃'], ['분전반 이상음·냄새'], ['비상발전기 연료', '%']] },
  '승강기': { cat: '승강기', cycle: '매월', items: [['운행 상태'], ['도어 개폐'], ['비상통화 작동'], ['점검업체 방문 확인']] },
};

async function oCfg() {
  return { units: [], staff: [], vendors: [], examName: '', examDate: '', inspector: '', ...(await getSetting('officeCfg', {})) };
}
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 0);
const isWork = (r) => !['점검실행', '일지'].includes(r.kind); // 업무 목록에 보이는 기록

/* 내보내기 */
function csvDownload(name, rows) {
  const s = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + s], { type: 'text/csv;charset=utf-8' }); // 엑셀에서 한글이 안 깨지게 BOM
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function printHtml(title, html) {
  view().innerHTML = `<div class="noprint row" style="margin-bottom:10px"><button class="btn primary block" onclick="window.print()" type="button">🖨 PDF로 저장 / 인쇄</button><button class="btn block" onclick="history.back()" type="button">닫기</button></div>
    <div class="printable"><h1 style="font-size:20px">${esc(title)}</h1>${html}</div>`;
  setTimeout(() => window.print(), 400);
}

/* ───────── 관리사무소 홈(새로 구성) ───────── */
async function viewOffice() {
  setTitle('관리실 업무수첩', true);
  const [recs, scheds, tasks, cfg] = await Promise.all([DB.all('office'), DB.all('schedules'), DB.all('tasks'), oCfg()]);
  const today = todayStr();
  const work = recs.filter(isWork);
  const due = scheds.map((s) => ({ ...s, next: schedNext(s) })).filter((s) => s.next <= today).sort((a, b) => a.next.localeCompare(b.next));
  const visits = scheds.map((s) => ({ ...s, next: schedNext(s) })).filter((s) => s.vendor && s.next > today && s.next <= addDays(3));
  const ttasks = tasks.filter((t) => t.area === '관리사무소' && !t.done && t.date <= today);
  const cmpOpen = work.filter((r) => r.kind === '민원' && !r.done);
  const cmpLate = cmpOpen.filter((r) => daysSince(r.createdAt) >= 3);
  const anom = work.filter((r) => r.kind === '점검·이상' && !r.done);
  const ho = recs.filter((r) => r.kind === '일지' && r.handover && !r.handoverAck).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const exam = cfg.examDate ? Math.round((new Date(cfg.examDate + 'T00:00') - new Date(today + 'T00:00')) / 864e5) : null;
  const openSorted = work.filter((r) => !r.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 8);
  view().innerHTML = `
    ${ho ? `<div class="card" style="border-color:var(--gold)"><div class="row spread"><h2 style="margin:0">🤝 인수인계 메모 <span class="muted">${esc(fmtDate(ho.date))}</span></h2><button class="btn small" id="hoAck" type="button">확인함</button></div>
      <div style="white-space:pre-wrap;margin-top:6px">${esc(ho.handover)}</div></div>` : ''}
    <div class="card"><h2>📋 오늘 할 일</h2>
      ${due.map((s) => `<div class="item row spread" style="padding:9px 12px"><span>${s.next < today ? '<b style="color:var(--red)">지남</b> ' : ''}${esc(s.name)} <span class="muted">${esc(s.cycle)}${s.vendor ? ' · ' + esc(s.vendor) : ''}</span></span><a class="btn small primary" href="#/insp/run/${s.id}">▶ 점검</a></div>`).join('')}
      ${visits.map((s) => `<div class="item" style="padding:9px 12px">🏗 ${esc(fmtDate(s.next))} 업체 방문 예정: ${esc(s.vendor)} (${esc(s.name)})</div>`).join('')}
      ${ttasks.map((t) => `<div class="item" style="padding:9px 12px">☑️ ${esc(t.text)}</div>`).join('')}
      ${due.length + visits.length + ttasks.length ? '' : '<div class="muted">오늘 예정된 점검·방문이 없습니다.</div>'}</div>
    <div class="grid2" style="margin-bottom:12px">
      <a class="stat ${cmpLate.length ? 'warn' : ''}" href="#/cmps" style="text-decoration:none;color:inherit"><span class="muted">미처리 민원</span><b>${cmpOpen.length}</b><span class="muted" style="font-size:12px">${cmpLate.length ? `3일 넘음 ${cmpLate.length}` : ''}</span></a>
      <a class="stat ${anom.length ? 'warn' : ''}" href="#/orecs?k=점검·이상" style="text-decoration:none;color:inherit"><span class="muted">이상 항목</span><b>${anom.length}</b></a>
      <div class="stat"><span class="muted">검침 진행률</span><b>-</b><span class="muted" style="font-size:12px">2차 예정</span></div>
      <a class="stat" href="#/oset" style="text-decoration:none;color:inherit"><span class="muted">${esc(cfg.examName || '시험')}</span><b>${exam == null ? '-' : exam === 0 ? 'D-DAY' : exam > 0 ? 'D-' + exam : '지남'}</b><span class="muted" style="font-size:12px">${cfg.examDate ? esc(cfg.examDate) : '설정에서 시험일'}</span></a>
    </div>
    <a class="btn primary block" href="#/orec/new?m=voice" style="min-height:56px;font-size:17px">🎤 이상 빠른 기록 (사진·말 → 자동 정리)</a>
    <div class="grid2" style="margin:8px 0 12px">
      <a class="btn" href="#/cmp/new">📝 민원 접수</a><a class="btn" href="#/vwork/new">🏗 업체 작업</a>
      <a class="btn" href="#/insp">✅ 점검 목록</a><a class="btn" href="#/orec/new?k=일반 업무">✏️ 일반 업무</a>
    </div>
    <div class="card"><div class="row spread"><h2 style="margin:0">⏳ 미처리 업무</h2><a class="btn small" href="#/orecs">전체 ›</a></div>
      <div style="margin-top:8px">${openSorted.map((r) => r.kind === '민원' ? cmpLine(r) : recLine(r)).join('') || '<div class="muted">미처리 업무가 없습니다.</div>'}</div></div>
    <div class="card"><h2>메뉴</h2><div class="tiles">
      <a class="tile" href="#/insp"><i>✅</i>점검 목록</a><a class="tile" href="#/insps"><i>📊</i>점검 기록</a><a class="tile" href="#/cmps"><i>📝</i>민원</a>
      <a class="tile" href="#/vworks"><i>🏗</i>업체 작업</a><a class="tile" href="#/odiary"><i>📒</i>업무일지</a><a class="tile" href="#/handover"><i>🤝</i>인수인계</a>
      <a class="tile" href="#/notice"><i>📢</i>공지 초안</a><a class="tile" href="#/oset"><i>⚙️</i>단지 설정</a><span class="tile off"><i>💧</i>검침<br><small>2차</small></span></div></div>`;
  if (ho) $('#hoAck').onclick = async () => { await DB.put('office', { ...ho, handoverAck: nowISO() }); render(); };
}

/* ───────── 점검 목록(체크리스트) ───────── */
async function viewInspList() {
  setTitle('점검 목록', true);
  const scheds = (await DB.all('schedules')).map((s) => ({ ...s, next: schedNext(s) })).sort((a, b) => a.next.localeCompare(b.next));
  const today = todayStr();
  const have = new Set(scheds.map((s) => s.name));
  view().innerHTML = `
    ${scheds.map((s) => `<div class="item"><div class="row spread"><span class="t">${esc(s.name)}</span><b style="${s.next <= today ? 'color:var(--red)' : ''}">${esc(fmtDate(s.next))}${s.next < today ? ' 지남' : s.next === today ? ' 오늘' : ''}</b></div>
      <div class="muted">${esc(s.cat || '')} · ${esc(s.cycle)} · 항목 ${(s.items || []).length}개 · 마지막 ${s.lastDone ? esc(fmtDate(s.lastDone)) : '없음'}${s.vendor ? ' · ' + esc(s.vendor) : ''}</div>
      <div class="row" style="margin-top:6px"><a class="btn small primary" href="#/insp/run/${s.id}">▶ 점검 실행</a><a class="btn small" href="#/insp/edit/${s.id}">체크리스트 수정</a></div></div>`).join('') || '<div class="muted" style="margin-bottom:10px">등록된 점검이 없습니다. 아래 기본 체크리스트로 시작해 보세요.</div>'}
    <div class="card" style="margin-top:12px"><h2>기본 체크리스트로 추가</h2>
      <div class="row wrap">${Object.keys(CHECK_TEMPLATES).filter((n) => !have.has(n)).map((n) => `<button class="btn small" data-tpl="${esc(n)}" type="button">+ ${esc(n)}</button>`).join('') || '<span class="muted">모두 추가했습니다.</span>'}</div>
      <div class="muted" style="margin-top:6px">항목과 주기는 예시입니다. 단지 기준·법정 주기에 맞게 고쳐 쓰세요.</div>
      <a class="btn block" href="#/insp/edit/new" style="margin-top:8px">+ 직접 만들기</a></div>`;
  view().querySelectorAll('[data-tpl]').forEach((b) => {
    b.onclick = async () => {
      const t = CHECK_TEMPLATES[b.dataset.tpl];
      await DB.put('schedules', { id: uid(), name: b.dataset.tpl, cat: t.cat, cycle: t.cycle, firstDue: todayStr(), lastDone: '', vendor: '', items: t.items.map(([name, unit]) => ({ name, unit: unit || '' })), createdAt: nowISO() });
      render();
    };
  });
}

async function viewInspEdit(id) {
  const s0 = id && id !== 'new' ? await DB.get('schedules', id) : null;
  const s = s0 ? { ...s0, items: [...(s0.items || [])] } : { name: '', cat: '기타', cycle: '매월', firstDue: todayStr(), vendor: '', items: [{ name: '', unit: '' }] };
  setTitle(s0 ? '체크리스트 수정' : '점검 만들기', true);
  const draw = () => {
    view().innerHTML = `<div class="card">
      <label for="ie_name">점검 이름</label><input id="ie_name" value="${esc(s.name)}" placeholder="예: 저수조">
      <div class="grid2"><div><label for="ie_cat">분류</label><select id="ie_cat">${opts(OFFICE_CATS, s.cat)}</select></div><div><label for="ie_cycle">주기</label><select id="ie_cycle">${opts(INSP_CYCLES.includes(s.cycle) ? INSP_CYCLES : [...INSP_CYCLES, s.cycle], s.cycle)}</select></div></div>
      <div class="grid2"><div><label for="ie_next">다음 예정일</label><input id="ie_next" type="date" value="${esc(s0 ? schedNext(s0) : s.firstDue)}"></div><div><label for="ie_vendor">정기 방문 업체(선택)</label><input id="ie_vendor" value="${esc(s.vendor)}"></div></div>
      <h2 style="margin-top:14px">항목 <span class="muted">(단위를 적으면 수치 입력칸이 생김)</span></h2>
      ${s.items.map((it, i) => `<div class="row" style="margin:6px 0"><input data-n="${i}" value="${esc(it.name)}" placeholder="항목" style="flex:2"><input data-u="${i}" value="${esc(it.unit)}" placeholder="단위(MPa·%·V)" style="flex:1"><button class="btn small danger" data-x="${i}" type="button">✕</button></div>`).join('')}
      <button class="btn small" id="ie_add" type="button">+ 항목</button></div>
      <button class="btn primary block" id="ie_save" type="button">💾 저장</button>
      ${s0 ? '<button class="btn danger block" id="ie_del" type="button" style="margin-top:8px">점검 삭제</button>' : ''}`;
    const read = () => {
      s.name = $('#ie_name').value.trim(); s.cat = $('#ie_cat').value; s.cycle = $('#ie_cycle').value; s.vendor = $('#ie_vendor').value.trim(); s.nextIn = $('#ie_next').value;
      s.items = s.items.map((_, i) => ({ name: view().querySelector(`[data-n="${i}"]`).value.trim(), unit: view().querySelector(`[data-u="${i}"]`).value.trim() }));
    };
    $('#ie_add').onclick = () => { read(); s.items.push({ name: '', unit: '' }); draw(); };
    view().querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { read(); s.items.splice(+b.dataset.x, 1); draw(); }; });
    $('#ie_save').onclick = async () => {
      read();
      if (!s.name) { toast('점검 이름을 넣어 주세요'); return; }
      const items = s.items.filter((x) => x.name);
      // 다음 예정일을 바꿨으면 마지막 점검일 기준을 다시 맞춘다
      const rec = { ...(s0 || { id: uid(), createdAt: nowISO() }), name: s.name, cat: s.cat, cycle: s.cycle, vendor: s.vendor, items };
      if (!s0 || s.nextIn !== schedNext(s0)) { rec.firstDue = s.nextIn || todayStr(); rec.lastDone = ''; }
      await DB.put('schedules', rec); toast('저장했습니다'); location.replace('#/insp');
    };
    if (s0) $('#ie_del').onclick = async () => { if (confirm('이 점검과 체크리스트를 지울까요? (점검 기록은 남습니다)')) { await DB.del('schedules', s0.id); location.replace('#/insp'); } };
  };
  draw();
}

/* ───────── 점검 실행 ───────── */
async function viewInspRun(id) {
  const [s, cfg] = await Promise.all([DB.get('schedules', id), oCfg()]);
  if (!s) { setTitle('점검', true); view().innerHTML = '<div class="empty">점검을 찾을 수 없습니다.</div>'; return; }
  setTitle(s.name, true);
  const items = (s.items && s.items.length ? s.items : [{ name: '전체 상태', unit: '' }]).map((x) => ({ ...x, state: '', value: '', memo: '', photos: [] }));
  view().innerHTML = `
    <div class="card"><div class="grid2"><div><label for="ir_who">점검자</label><input id="ir_who" list="ir_staff" value="${esc(cfg.inspector || cfg.staff[0] || '')}"><datalist id="ir_staff">${cfg.staff.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div><label for="ir_date">점검일</label><input id="ir_date" type="date" value="${todayStr()}"></div></div>
      <div class="row" style="margin-top:8px"><button class="btn small" id="ir_allok" type="button">남은 항목 모두 정상</button></div></div>
    ${items.map((it, i) => `<div class="card" id="it${i}">
      <b>${i + 1}. ${esc(it.name)}</b>
      <div class="row" style="margin-top:8px">${CHECK_STATES.map((st) => `<button class="btn small" data-i="${i}" data-s="${st}" type="button" style="flex:1">${st === '정상' ? '✅' : st === '이상' ? '⚠️' : '➖'} ${st}</button>`).join('')}</div>
      ${it.unit ? `<div class="row" style="margin-top:8px"><input data-v="${i}" type="number" inputmode="decimal" step="any" placeholder="수치"><span class="muted">${esc(it.unit)}</span></div>` : ''}
      <div data-bad="${i}" hidden style="margin-top:8px">
        <input data-m="${i}" placeholder="이상 내용(필수) 예: 패킹 부위 누수">
        <label class="btn small" style="margin:6px 0 0;color:var(--ink)">📷 사진(필수)<input data-p="${i}" type="file" accept="image/*" capture="environment" hidden></label>
        <span class="muted" data-pc="${i}"></span>
      </div></div>`).join('')}
    <div class="card"><label for="ir_memo">점검 메모</label><textarea id="ir_memo" rows="2"></textarea></div>
    <button class="btn primary block" id="ir_save" type="button" style="min-height:52px">💾 점검 결과 저장</button>`;
  const paint = (i) => {
    view().querySelectorAll(`[data-i="${i}"]`).forEach((b) => { const on = b.dataset.s === items[i].state; b.style.background = on ? (b.dataset.s === '이상' ? 'var(--red)' : b.dataset.s === '정상' ? 'var(--green)' : 'var(--muted)') : ''; b.style.color = on ? '#fff' : ''; });
    view().querySelector(`[data-bad="${i}"]`).hidden = items[i].state !== '이상';
  };
  view().querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => { items[+b.dataset.i].state = b.dataset.s; paint(+b.dataset.i); }; });
  view().querySelectorAll('[data-p]').forEach((inp) => {
    inp.onchange = async (e) => { const i = +inp.dataset.p; const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { items[i].photos.push(await shrink(f, 1600, 0.82)); view().querySelector(`[data-pc="${i}"]`).textContent = `사진 ${items[i].photos.length}장`; } catch (er) { toast(er.message); } };
  });
  $('#ir_allok').onclick = () => { items.forEach((it, i) => { if (!it.state) { it.state = '정상'; paint(i); } }); };
  $('#ir_save').onclick = async () => {
    items.forEach((it, i) => { const v = view().querySelector(`[data-v="${i}"]`); it.value = v ? v.value : ''; const m = view().querySelector(`[data-m="${i}"]`); it.memo = m ? m.value.trim() : ''; });
    const miss = items.findIndex((it) => !it.state);
    if (miss >= 0) { toast(`${miss + 1}번 항목 결과를 골라 주세요`); $(`#it${miss}`).scrollIntoView({ block: 'center' }); return; }
    const bad = items.findIndex((it) => it.state === '이상' && (!it.memo || !it.photos.length));
    if (bad >= 0) { toast(`${bad + 1}번 이상 항목은 내용과 사진이 필요합니다`); $(`#it${bad}`).scrollIntoView({ block: 'center' }); return; }
    if (!$('#ir_who').value.trim()) { toast('점검자 이름을 넣어 주세요'); return; }
    const now = nowISO(), date = $('#ir_date').value || todayStr(), runId = uid();
    const results = [];
    for (const it of items) {
      const pids = [];
      for (const b of it.photos) { const pid = uid(); await DB.put('photos', { id: pid, jobId: runId, kind: '점검', blob: b, createdAt: now }); pids.push(pid); }
      results.push({ name: it.name, unit: it.unit, state: it.state, value: it.value, memo: it.memo, photoIds: pids });
    }
    const nBad = results.filter((r) => r.state === '이상').length;
    await DB.put('office', { id: runId, kind: '점검실행', done: true, schedId: s.id, schedName: s.name, cat: s.cat, date, inspector: $('#ir_who').value.trim(), results, memo: $('#ir_memo').value.trim(), bad: nBad, createdAt: now, updatedAt: now, text: `${s.name} 점검` });
    // 이상 항목은 후속 조치용 '점검·이상' 업무로 만든다(사진도 같이)
    for (const r of results.filter((x) => x.state === '이상')) {
      const rid = uid();
      await DB.put('office', { id: rid, kind: '점검·이상', cat: s.cat || '기타', loc: s.name, text: `${r.name}: ${r.memo}${r.value ? ` (${r.value}${r.unit})` : ''}`, status: '이상 발견', action: '조치 검토', done: false, due: addDays(3), vendor: s.vendor || '', unit: '', result: '', fromRun: runId, createdAt: now, updatedAt: now });
      for (const pid of r.photoIds) { const p = await DB.get('photos', pid); await DB.put('photos', { ...p, id: uid(), jobId: rid }); }
    }
    await DB.put('schedules', { ...s, lastDone: date });
    if ($('#ir_who').value.trim() !== cfg.inspector) await setSetting('officeCfg', { ...cfg, inspector: $('#ir_who').value.trim() });
    toast(nBad ? `저장했습니다. 이상 ${nBad}건은 미처리 업무로 올렸습니다` : '저장했습니다. 모두 정상');
    location.replace('#/office');
  };
}

/* ───────── 점검 기록 ───────── */
async function viewInspRecs() {
  setTitle('점검 기록', true);
  const runs = (await DB.all('office')).filter((r) => r.kind === '점검실행').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  let onlyBad = false, month = monthStr();
  const numItems = [...new Set(runs.flatMap((r) => r.results.filter((x) => x.unit).map((x) => `${r.schedName}|${x.name}|${x.unit}`)))];
  const draw = () => {
    const list = runs.filter((r) => (r.date || '').startsWith(month) && (!onlyBad || r.bad));
    $('#irList').innerHTML = list.map((r) => `<div class="item"><div class="row spread"><span class="t">${esc(fmtDate(r.date))} · ${esc(r.schedName)}</span>${r.bad ? `<span class="badge" style="color:var(--red)">이상 ${r.bad}</span>` : '<span class="badge s-완료">정상</span>'}</div>
      <div class="muted">점검자 ${esc(r.inspector || '-')}</div>
      ${r.results.filter((x) => !onlyBad || x.state === '이상').map((x) => `<div style="font-size:14px">${x.state === '이상' ? '⚠️' : x.state === '정상' ? '✅' : '➖'} ${esc(x.name)}${x.value ? ` <b>${esc(x.value)}${esc(x.unit)}</b>` : ''}${x.memo ? ` — ${esc(x.memo)}` : ''}</div>`).join('')}</div>`).join('') || '<div class="empty">이 달 점검 기록이 없습니다.</div>';
  };
  view().innerHTML = `
    <div class="row" style="margin-bottom:10px"><input type="month" id="ir_m" value="${month}" style="flex:1"><label class="row" style="margin:0;color:var(--ink);font-size:14px;flex:none"><input type="checkbox" id="ir_bad" style="width:20px;min-height:20px"> 이상만</label></div>
    <div class="row" style="margin-bottom:10px"><button class="btn small" id="ir_csv" type="button">⬇ 월간 보고서 엑셀(CSV)</button><button class="btn small" id="ir_pdf" type="button">🖨 월간 보고서 PDF</button></div>
    <div class="card"><h2>수치 추이</h2><select id="ir_num">${numItems.length ? numItems.map((k) => `<option value="${esc(k)}">${esc(k.split('|').slice(0, 2).join(' · '))} (${esc(k.split('|')[2])})</option>`).join('') : '<option>수치 항목 기록 없음</option>'}</select><div id="ir_trend" style="margin-top:8px"></div></div>
    <div id="irList"></div>`;
  const trend = () => {
    const k = $('#ir_num').value; if (!k || !k.includes('|')) { $('#ir_trend').innerHTML = ''; return; }
    const [sn, nm] = k.split('|');
    const pts = runs.filter((r) => r.schedName === sn).map((r) => ({ d: r.date, v: +((r.results.find((x) => x.name === nm) || {}).value) })).filter((p) => !isNaN(p.v) && p.v !== 0).reverse().slice(-15);
    if (!pts.length) { $('#ir_trend').innerHTML = '<div class="muted">기록 없음</div>'; return; }
    const hi = Math.max(...pts.map((p) => p.v)), lo = Math.min(...pts.map((p) => p.v));
    $('#ir_trend').innerHTML = `<div style="display:flex;align-items:flex-end;gap:4px;height:100px">${pts.map((p) => `<div style="flex:1;text-align:center"><div style="background:var(--blue);height:${Math.round(15 + ((p.v - lo) / (hi - lo || 1)) * 70)}px;border-radius:4px 4px 0 0"></div><div style="font-size:10px">${p.v}</div><div class="muted" style="font-size:9px">${p.d.slice(5)}</div></div>`).join('')}</div>`;
  };
  $('#ir_m').onchange = (e) => { month = e.target.value; draw(); };
  $('#ir_bad').onchange = (e) => { onlyBad = e.target.checked; draw(); };
  $('#ir_num').onchange = trend;
  $('#ir_csv').onclick = () => {
    const rows = [['날짜', '점검', '점검자', '항목', '결과', '수치', '단위', '메모']];
    runs.filter((r) => (r.date || '').startsWith(month)).forEach((r) => r.results.forEach((x) => rows.push([r.date, r.schedName, r.inspector, x.name, x.state, x.value, x.unit, x.memo])));
    csvDownload(`점검보고서-${month}.csv`, rows);
  };
  $('#ir_pdf').onclick = () => {
    const list = runs.filter((r) => (r.date || '').startsWith(month)).reverse();
    const bad = list.reduce((a, r) => a + (r.bad || 0), 0);
    printHtml(`${month} 월간 점검 보고서`, `<p>점검 ${list.length}회 · 이상 ${bad}건</p><table><thead><tr><th>날짜</th><th>점검</th><th>점검자</th><th>항목</th><th>결과</th><th>수치</th><th>메모</th></tr></thead><tbody>
      ${list.flatMap((r) => r.results.map((x) => `<tr><td>${esc(r.date)}</td><td>${esc(r.schedName)}</td><td>${esc(r.inspector)}</td><td>${esc(x.name)}</td><td>${esc(x.state)}</td><td>${esc(x.value)}${esc(x.unit)}</td><td>${esc(x.memo)}</td></tr>`)).join('')}</tbody></table>`);
  };
  draw(); trend();
}

/* ───────── 민원 ───────── */
function cmpLine(r) {
  const st = r.cstatus || (r.done ? '완료' : '접수');
  const late = !r.done && daysSince(r.createdAt) >= 3;
  return `<a class="item" href="#/cmp/${r.id}"><div class="row spread"><span class="t">📝 ${esc(r.unit || '세대 미입력')} · ${esc(r.mcat || r.cat || '')}</span><span class="badge ${st === '완료' ? 's-완료' : st === '처리중' ? 's-예약' : 's-접수'}">${esc(st)}</span></div>
    <div class="muted">${esc((r.createdAt || '').slice(0, 10))}${late ? ` · <b style="color:var(--red)">${daysSince(r.createdAt)}일째 미처리</b>` : ''}${r.staff ? ' · 담당 ' + esc(r.staff) : ''}</div>
    <div style="font-size:14px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(r.text)}</div></a>`;
}
async function viewCmps() {
  setTitle('민원', true);
  const all = (await DB.all('office')).filter((r) => r.kind === '민원').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  let st = '미처리', q = '';
  const stOf = (r) => r.cstatus || (r.done ? '완료' : '접수');
  const draw = () => {
    const list = all.filter((r) => (st === '전체' || (st === '미처리' ? stOf(r) !== '완료' : stOf(r) === st)) && (!q || [r.unit, r.text, r.phone, r.mcat].join(' ').includes(q)));
    $('#cl').innerHTML = list.map(cmpLine).join('') || '<div class="empty">해당 민원이 없습니다.</div>';
    document.querySelectorAll('#cs .chip').forEach((c) => c.classList.toggle('on', c.dataset.v === st));
  };
  // 월별 통계(최근 6개월, 분류별)
  const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 5 + i); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; });
  const cnt = months.map((m) => all.filter((r) => (r.createdAt || '').startsWith(m)).length), mx = Math.max(1, ...cnt);
  const thisM = all.filter((r) => (r.createdAt || '').startsWith(monthStr()));
  view().innerHTML = `
    <a class="btn primary block" href="#/cmp/new">+ 민원 접수</a>
    <div class="card" style="margin-top:12px"><h2>월별 민원</h2><div style="display:flex;align-items:flex-end;gap:6px;height:90px">${cnt.map((v, i) => `<div style="flex:1;text-align:center"><div style="background:var(--blue);height:${Math.round((v / mx) * 60)}px;border-radius:4px 4px 0 0"></div><div style="font-size:11px">${v}</div><div class="muted" style="font-size:10px">${+months[i].slice(5)}월</div></div>`).join('')}</div>
      <div class="muted" style="margin-top:6px">이번 달: ${CMP_CATS.map((c) => `${c} ${thisM.filter((r) => r.mcat === c).length}`).join(' · ')} · 완료 ${thisM.filter((r) => stOf(r) === '완료').length}/${thisM.length}</div></div>
    <input id="q" type="search" placeholder="동·호·내용 검색" style="margin-bottom:10px">
    <div class="chips" id="cs">${['미처리', ...CMP_STATUS, '전체'].map((v) => `<button class="chip" data-v="${v}">${v}</button>`).join('')}</div>
    <div id="cl"></div>`;
  $('#cs').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { st = b.dataset.v; draw(); } };
  $('#q').oninput = (e) => { q = e.target.value.trim(); draw(); };
  draw();
}
async function viewCmp(id) {
  const [r0, cfg, allOffice] = await Promise.all([id ? DB.get('office', id) : null, oCfg(), DB.all('office')]);
  const r = r0 || { kind: '민원', mcat: '기타', cstatus: '접수' };
  setTitle(r0 ? '민원 상세' : '민원 접수', true);
  const pending = { 접수: [], 처리: [] };
  const past = r.unit ? allOffice.filter((x) => x.kind === '민원' && x.id !== r.id && x.unit === r.unit).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) : [];
  view().innerHTML = `
    <form class="card" id="cf" autocomplete="off">
      <div class="grid2"><div><label for="c_unit">동·호</label><input id="c_unit" list="c_units" value="${esc(r.unit)}" placeholder="101동 1203호"><datalist id="c_units">${cfg.units.map((u) => `<option value="${esc(u)}">`).join('')}</datalist></div>
        <div><label for="c_phone">연락처</label><input id="c_phone" type="tel" inputmode="tel" value="${esc(r.phone)}"></div></div>
      <label for="c_cat">분류</label><div class="chips" id="c_cat">${CMP_CATS.map((c) => `<button class="chip${c === (r.mcat || '기타') ? ' on' : ''}" data-v="${c}" type="button">${c}</button>`).join('')}</div>
      <label for="c_text">내용</label><textarea id="c_text" rows="3">${esc(r.text)}</textarea>
      <div class="row" style="margin-top:6px"><button class="btn small" id="c_mic" type="button">🎤 말로 입력</button><label class="btn small" style="margin:0;color:var(--ink)">📷 접수 사진<input id="c_p1" type="file" accept="image/*" multiple hidden></label><span class="muted" id="c_p1n"></span></div>
      ${r0 ? `<h2 style="margin-top:14px">처리</h2>
      <div class="grid2"><div><label for="c_st">상태</label><select id="c_st">${opts(CMP_STATUS, r.cstatus || (r.done ? '완료' : '접수'))}</select></div>
        <div><label for="c_staff">담당자</label><input id="c_staff" list="c_stl" value="${esc(r.staff)}"><datalist id="c_stl">${cfg.staff.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div></div>
      <label for="c_res">처리 내용</label><textarea id="c_res" rows="3">${esc(r.result)}</textarea>
      <label class="btn small" style="margin:6px 0 0;color:var(--ink)">📷 처리 사진<input id="c_p2" type="file" accept="image/*" multiple hidden></label> <span class="muted" id="c_p2n"></span>` : ''}
      <button class="btn primary block" type="submit" style="margin-top:12px">💾 ${r0 ? '저장' : '접수 등록'}</button></form>
    ${r0 ? `<div class="card"><h2>사진</h2><div class="photos" id="c_photos"></div></div>
      ${r.phone ? `<div class="row"><a class="btn block" href="tel:${digits(r.phone)}">📞 전화</a><a class="btn block" href="sms:${digits(r.phone)}">💬 문자</a></div>` : ''}
      <div class="card" style="margin-top:12px"><h2>같은 호 과거 민원 ${past.length}</h2>${past.map(cmpLine).join('') || '<div class="muted">없음</div>'}</div>
      <button class="btn danger block" id="c_del" type="button">민원 삭제</button>` : ''}`;
  let mcat = r.mcat || '기타';
  $('#c_cat').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; mcat = b.dataset.v; document.querySelectorAll('#c_cat .chip').forEach((c) => c.classList.toggle('on', c === b)); };
  const addP = (k, inp, lab) => { inp.onchange = async (e) => { for (const f of [...e.target.files]) { try { pending[k].push(await shrink(f, 1600, 0.82)); } catch (er) { toast(er.message); } } e.target.value = ''; lab.textContent = `${pending[k].length}장 추가`; }; };
  addP('접수', $('#c_p1'), $('#c_p1n'));
  if (r0) addP('처리', $('#c_p2'), $('#c_p2n'));
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null;
  $('#c_mic').onclick = () => {
    if (!SR) { toast('키보드의 🎤 버튼을 쓰세요'); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = true;
    const base = $('#c_text').value; let fin = '';
    rec.onresult = (ev) => { let it = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const x = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += x + ' '; else it += x; } $('#c_text').value = (base ? base + ' ' : '') + fin + it; };
    rec.onstart = () => { $('#c_mic').textContent = '⏹ 그만'; };
    rec.onend = () => { rec = null; $('#c_mic').textContent = '🎤 말로 입력'; const t = $('#c_text').value; const u = t.match(/\d+\s*동\s*\d+\s*호/); if (u && !$('#c_unit').value) $('#c_unit').value = u[0].replace(/\s+/g, ' '); };
    try { rec.start(); } catch { rec = null; }
  };
  $('#cf').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#c_text').value.trim();
    if (!text) { toast('민원 내용을 넣어 주세요'); return; }
    const now = nowISO();
    const cst = r0 ? $('#c_st').value : '접수';
    const data = { ...(r0 || { id: uid(), kind: '민원', createdAt: now }), unit: $('#c_unit').value.trim(), phone: $('#c_phone').value.trim(), mcat, cat: mcat, loc: $('#c_unit').value.trim(), text, cstatus: cst, done: cst === '완료', staff: r0 ? $('#c_staff').value.trim() : '', result: r0 ? $('#c_res').value.trim() : '', status: cst, action: cst === '완료' ? '조치 완료' : '조치 검토', updatedAt: now };
    if (cst === '완료' && !data.doneAt) data.doneAt = now;
    if (cst !== '완료') data.doneAt = '';
    await DB.put('office', data);
    for (const [k, list] of Object.entries(pending)) for (const b of list) await DB.put('photos', { id: uid(), jobId: data.id, kind: k, blob: b, createdAt: now });
    toast(r0 ? '저장했습니다' : '접수했습니다'); location.replace(r0 ? '#/cmps' : `#/cmp/${data.id}`);
  };
  if (r0) {
    const urls = [];
    const drawPh = async () => {
      urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      const ps = await DB.by('photos', 'jobId', r0.id);
      $('#c_photos').innerHTML = ps.map((p) => { const u = URL.createObjectURL(p.blob); urls.push(u); return `<div class="photo"><img src="${u}" alt=""><span>${esc(p.kind)}</span></div>`; }).join('') || '<div class="muted" style="grid-column:1/-1">사진 없음</div>';
      $('#c_photos').querySelectorAll('.photo').forEach((el, i) => { el.onclick = () => openViewer(ps[i], urls[i], drawPh); });
    };
    drawPh();
    $('#c_del').onclick = async () => { if (confirm('이 민원을 지울까요?')) { for (const p of await DB.by('photos', 'jobId', r0.id)) await DB.del('photos', p.id); await DB.del('office', r0.id); location.replace('#/cmps'); } };
  }
}

/* ───────── 업체 작업 이력 ───────── */
async function viewVWorks() {
  setTitle('업체 작업 이력', true);
  const list = (await DB.all('office')).filter((r) => r.kind === '업체 작업').sort((a, b) => (b.workDate || b.createdAt || '').localeCompare(a.workDate || a.createdAt || ''));
  const equips = [...new Set(list.map((r) => r.equip).filter(Boolean))];
  let eq = '전체';
  const draw = () => {
    const l = list.filter((r) => eq === '전체' || r.equip === eq);
    const sum = l.reduce((a, r) => a + (Number(r.cost) || 0), 0);
    $('#vl').innerHTML = `${eq !== '전체' ? `<div class="muted" style="margin-bottom:6px">${esc(eq)} 수리 ${l.length}건 · 비용 합계 ${won(sum)}</div>` : ''}` + (l.map((r) => `<a class="item" href="#/vwork/${r.id}"><div class="row spread"><span class="t">🏗 ${esc(r.vendor || '업체 미입력')} · ${esc(r.equip || '')}</span><span class="muted">${esc(fmtDate(r.workDate || (r.createdAt || '').slice(0, 10)))}</span></div>
      <div class="muted">${r.cost ? won(r.cost) + ' · ' : ''}${esc((r.text || '').slice(0, 50))}</div></a>`).join('') || '<div class="empty">업체 작업 기록이 없습니다.</div>');
    document.querySelectorAll('#ve .chip').forEach((c) => c.classList.toggle('on', c.dataset.v === eq));
  };
  view().innerHTML = `<a class="btn primary block" href="#/vwork/new">+ 업체 작업 기록</a>
    <h2 style="font-size:15px;margin:12px 0 4px">설비별 보기</h2><div class="chips" id="ve">${['전체', ...equips].map((v) => `<button class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>
    <div id="vl"></div>`;
  $('#ve').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { eq = b.dataset.v; draw(); } };
  draw();
}
async function viewVWork(id) {
  const [r0, cfg, all] = await Promise.all([id ? DB.get('office', id) : null, oCfg(), DB.all('office')]);
  const r = r0 || { kind: '업체 작업', workDate: todayStr() };
  const equips = [...new Set(all.filter((x) => x.kind === '업체 작업').map((x) => x.equip).filter(Boolean))];
  const vnames = [...new Set([...cfg.vendors.map((v) => v.name), ...all.filter((x) => x.kind === '업체 작업').map((x) => x.vendor).filter(Boolean)])];
  setTitle(r0 ? '업체 작업' : '업체 작업 기록', true);
  const pending = [];
  view().innerHTML = `<form class="card" id="vf" autocomplete="off">
    <div class="grid2"><div><label for="v_name">업체명</label><input id="v_name" list="v_names" value="${esc(r.vendor)}"><datalist id="v_names">${vnames.map((v) => `<option value="${esc(v)}">`).join('')}</datalist></div>
      <div><label for="v_phone">연락처</label><input id="v_phone" type="tel" inputmode="tel" value="${esc(r.vendorPhone)}"></div></div>
    <div class="grid2"><div><label for="v_date">작업일</label><input id="v_date" type="date" value="${esc(r.workDate)}"></div>
      <div><label for="v_eq">대상 설비</label><input id="v_eq" list="v_eqs" value="${esc(r.equip)}" placeholder="예: 1호기 승강기"><datalist id="v_eqs">${equips.map((v) => `<option value="${esc(v)}">`).join('')}</datalist></div></div>
    <label for="v_text">작업 내용</label><textarea id="v_text" rows="3">${esc(r.text)}</textarea>
    <div class="grid2"><div><label for="v_cost">견적·비용(원)</label><input id="v_cost" type="number" inputmode="numeric" step="1000" value="${esc(r.cost)}"></div>
      <div><label>&nbsp;</label><label class="btn" style="margin:0;color:var(--ink)">📷 사진<input id="v_ph" type="file" accept="image/*" multiple hidden></label></div></div>
    <span class="muted" id="v_phn"></span>
    <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button></form>
    ${r.vendorPhone ? `<a class="btn block" href="tel:${digits(r.vendorPhone)}">📞 ${esc(r.vendor || '업체')}에 전화</a>` : ''}
    ${r0 ? `<div class="card" style="margin-top:12px"><h2>사진</h2><div class="photos" id="v_photos"></div></div>
      <div class="card"><h2>이 설비의 과거 작업</h2>${all.filter((x) => x.kind === '업체 작업' && x.equip && x.equip === r.equip && x.id !== r.id).map((x) => `<a class="item" href="#/vwork/${x.id}">${esc(x.workDate || '')} · ${esc(x.vendor || '')} · ${esc((x.text || '').slice(0, 40))}${x.cost ? ' · ' + won(x.cost) : ''}</a>`).join('') || '<div class="muted">없음</div>'}</div>
      <button class="btn danger block" id="v_del" type="button">삭제</button>` : ''}`;
  $('#v_name').oninput = () => { const v = cfg.vendors.find((x) => x.name === $('#v_name').value.trim()); if (v && !$('#v_phone').value) $('#v_phone').value = v.phone; };
  $('#v_ph').onchange = async (e) => { for (const f of [...e.target.files]) { try { pending.push(await shrink(f, 1600, 0.82)); } catch (er) { toast(er.message); } } e.target.value = ''; $('#v_phn').textContent = `사진 ${pending.length}장 추가`; };
  $('#vf').onsubmit = async (e) => {
    e.preventDefault();
    const now = nowISO();
    const data = { ...(r0 || { id: uid(), kind: '업체 작업', createdAt: now }), vendor: $('#v_name').value.trim(), vendorPhone: $('#v_phone').value.trim(), workDate: $('#v_date').value, equip: $('#v_eq').value.trim(), loc: $('#v_eq').value.trim(), text: $('#v_text').value.trim(), cost: $('#v_cost').value === '' ? '' : Number($('#v_cost').value), cat: '기타', status: '조치 완료', action: '조치 완료', done: true, doneAt: now, updatedAt: now };
    if (!data.vendor && !data.text) { toast('업체명이나 작업 내용을 넣어 주세요'); return; }
    await DB.put('office', data);
    for (const b of pending) await DB.put('photos', { id: uid(), jobId: data.id, kind: '업체 작업', blob: b, createdAt: now });
    // 처음 보는 업체는 업체 목록에 추가
    if (data.vendor && !cfg.vendors.some((v) => v.name === data.vendor)) await setSetting('officeCfg', { ...cfg, vendors: [...cfg.vendors, { name: data.vendor, phone: data.vendorPhone, field: data.equip }] });
    toast('저장했습니다'); location.replace('#/vworks');
  };
  if (r0) {
    const urls = [];
    const drawPh = async () => { urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); const ps = await DB.by('photos', 'jobId', r0.id); $('#v_photos').innerHTML = ps.map((p) => { const u = URL.createObjectURL(p.blob); urls.push(u); return `<div class="photo"><img src="${u}" alt=""></div>`; }).join('') || '<div class="muted" style="grid-column:1/-1">사진 없음</div>'; $('#v_photos').querySelectorAll('.photo').forEach((el, i) => { el.onclick = () => openViewer(ps[i], urls[i], drawPh); }); };
    drawPh();
    $('#v_del').onclick = async () => { if (confirm('이 기록을 지울까요?')) { for (const p of await DB.by('photos', 'jobId', r0.id)) await DB.del('photos', p.id); await DB.del('office', r0.id); location.replace('#/vworks'); } };
  }
}

/* ───────── 업무일지(자동 + 직접 메모 + 인수인계란) ───────── */
async function viewDiary() {
  setTitle('업무일지', true);
  const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
  const day = qs.get('d') || todayStr();
  const [recs, tasks] = await Promise.all([DB.all('office'), DB.all('tasks')]);
  const on = (s) => (s || '').slice(0, 10) === day;
  const runs = recs.filter((r) => r.kind === '점검실행' && r.date === day);
  const cmpNew = recs.filter((r) => r.kind === '민원' && on(r.createdAt));
  const cmpDone = recs.filter((r) => r.kind === '민원' && r.done && on(r.doneAt) && !on(r.createdAt));
  const vw = recs.filter((r) => r.kind === '업체 작업' && (r.workDate === day));
  const others = recs.filter((r) => ['점검·이상', '일반 업무'].includes(r.kind) && on(r.createdAt));
  const closed = recs.filter((r) => ['점검·이상', '일반 업무'].includes(r.kind) && r.done && on(r.doneAt) && !on(r.createdAt));
  const tdone = tasks.filter((t) => t.area === '관리사무소' && t.done && (on(t.doneAt) || t.date === day));
  const open = recs.filter((r) => isWork(r) && !r.done);
  const diary = recs.find((r) => r.kind === '일지' && r.date === day) || null;
  const auto = [
    `[업무일지] ${day} ${WEEKDAYS[new Date(day + 'T00:00').getDay()]}`,
    '', `■ 점검 ${runs.length}회`, ...runs.map((r) => `- ${r.schedName} (${r.inspector || '-'}) ${r.bad ? `이상 ${r.bad}건: ${r.results.filter((x) => x.state === '이상').map((x) => x.name).join(', ')}` : '이상 없음'}`),
    '', `■ 민원 접수 ${cmpNew.length}건`, ...cmpNew.map((r) => `- ${r.unit || ''} [${r.mcat || ''}] ${r.text}${r.cstatus ? ` (${r.cstatus})` : ''}`),
    ...(cmpDone.length ? ['', `■ 민원 처리 완료 ${cmpDone.length}건`, ...cmpDone.map((r) => `- ${r.unit || ''} ${r.text}${r.result ? ' → ' + r.result : ''}`)] : []),
    ...(vw.length ? ['', `■ 업체 작업 ${vw.length}건`, ...vw.map((r) => `- ${r.vendor || ''} / ${r.equip || ''}: ${r.text}${r.cost ? ` (${won(r.cost)})` : ''}`)] : []),
    ...(others.length ? ['', `■ 이상·기타 업무 ${others.length}건`, ...others.map((r) => `- [${r.cat}] ${locPrefix(r)}${r.text}${r.action && r.action !== '없음' ? ' → ' + r.action : ''}${r.done ? ' (완료)' : ''}`)] : []),
    ...(closed.length ? ['', '■ 처리 완료', ...closed.map((r) => `- ${locPrefix(r)}${r.text}${r.result ? ' / ' + r.result : ''}`)] : []),
    ...(tdone.length ? ['', '■ 완료한 할 일', ...tdone.map((t) => `- ${t.text}`)] : []),
    '', `■ 미처리 ${open.length}건`, ...open.slice(0, 15).map((r) => `- ${r.kind === '민원' ? (r.unit || '') + ' 민원: ' : ''}${locPrefix(r)}${r.text}`),
  ].join('\n');
  view().innerHTML = `
    <div class="row" style="margin-bottom:10px"><a class="btn small" href="#/odiary?d=${addDays(-1, new Date(day + 'T00:00'))}">‹ 전날</a><input type="date" id="d_day" value="${day}" style="flex:1"><a class="btn small" href="#/odiary?d=${addDays(1, new Date(day + 'T00:00'))}">다음날 ›</a></div>
    <div class="card"><h2>자동 정리</h2><textarea id="d_auto" rows="14" style="font-size:14px">${esc(auto)}</textarea></div>
    <div class="card"><label for="d_memo">직접 메모</label><textarea id="d_memo" rows="3">${esc(diary && diary.memo)}</textarea>
      <label for="d_ho">인수인계 (다음 근무자 홈에 표시)</label><textarea id="d_ho" rows="3" placeholder="예: 3호기 승강기 내일 오전 업체 방문 예정, 키 경비실 보관">${esc(diary && diary.handover)}</textarea>
      ${diary && diary.handoverAck ? `<div class="muted">인수인계 확인함: ${esc(diary.handoverAck.slice(0, 16).replace('T', ' '))}</div>` : ''}
      <button class="btn primary block" id="d_save" type="button" style="margin-top:10px">💾 일지 저장</button></div>
    <div class="row"><button class="btn block" id="d_copy" type="button">📋 복사</button><button class="btn block" id="d_csv" type="button">⬇ 엑셀</button><button class="btn block" id="d_pdf" type="button">🖨 PDF</button></div>`;
  const full = () => `${$('#d_auto').value}${$('#d_memo').value.trim() ? `\n\n■ 메모\n${$('#d_memo').value.trim()}` : ''}${$('#d_ho').value.trim() ? `\n\n■ 인수인계\n${$('#d_ho').value.trim()}` : ''}`;
  $('#d_day').onchange = (e) => { location.hash = `#/odiary?d=${e.target.value}`; };
  $('#d_save').onclick = async () => {
    const now = nowISO();
    const ho = $('#d_ho').value.trim();
    await DB.put('office', { ...(diary || { id: uid(), kind: '일지', date: day, done: true, createdAt: now }), memo: $('#d_memo').value.trim(), handover: ho, handoverAck: diary && diary.handover === ho ? diary.handoverAck : '', text: `${day} 업무일지`, updatedAt: now });
    toast('저장했습니다');
  };
  $('#d_copy').onclick = () => copyText(full());
  $('#d_csv').onclick = () => csvDownload(`업무일지-${day}.csv`, full().split('\n').map((l) => [l]));
  $('#d_pdf').onclick = () => { const t = full(); printHtml(`업무일지 ${day}`, `<pre style="white-space:pre-wrap;font-family:inherit;font-size:14px">${esc(t)}</pre>`); };
}

/* ───────── 인수인계(모아보기) ───────── */
async function viewHandover() {
  setTitle('인수인계', true);
  const [recs, scheds, tasks] = await Promise.all([DB.all('office'), DB.all('schedules'), DB.all('tasks')]);
  const open = recs.filter((r) => isWork(r) && !r.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const soon = scheds.map((s) => ({ ...s, next: schedNext(s) })).filter((s) => s.next <= addDays(14)).sort((a, b) => a.next.localeCompare(b.next));
  const t = tasks.filter((x) => x.area === '관리사무소' && !x.done);
  const memos = recs.filter((r) => r.kind === '일지' && r.handover).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
  const text = [
    `[인수인계] ${todayStr()} 기준`, '',
    `■ 미처리 업무 ${open.length}건`,
    ...open.map((r) => `- ${r.due ? `(기한 ${r.due.slice(5)}) ` : ''}${r.kind === '민원' ? `[민원 ${r.cstatus || '접수'}] ${r.unit || ''} ` : `[${r.cat}] `}${locPrefix(r)}${r.text}${r.action && r.action !== '없음' && r.kind !== '민원' ? ` → ${r.action}` : ''}${r.vendor ? ` / 업체 ${r.vendor}` : ''}`),
    ...(t.length ? ['', '■ 남은 할 일', ...t.map((x) => `- ${x.date.slice(5)} ${x.text}`)] : []),
    ...(soon.length ? ['', '■ 2주 안 점검', ...soon.map((s) => `- ${s.next.slice(5)} ${s.name} (${s.cycle}${s.vendor ? ', ' + s.vendor : ''})`)] : []),
    ...(memos.length ? ['', '■ 최근 인수인계 메모', ...memos.map((m) => `- ${m.date.slice(5)} ${m.handover.replace(/\n/g, ' ')}`)] : []),
    '', '■ 전달 사항', '- ',
  ].join('\n');
  view().innerHTML = `<div class="card"><textarea id="h_text" rows="18" style="font-size:14px">${esc(text)}</textarea>
    <div class="muted">미처리 업무·민원·할 일·점검 일정·최근 메모를 모았습니다. 홈에 띄울 메모는 업무일지의 '인수인계'칸에 적으세요.</div>
    <div class="row" style="margin-top:8px"><button class="btn primary block" id="h_copy" type="button">📋 복사</button><a class="btn block" href="#/odiary">📒 오늘 일지에 메모</a></div></div>`;
  $('#h_copy').onclick = () => copyText($('#h_text').value);
}

/* ───────── 단지 설정 ───────── */
async function viewOSet() {
  setTitle('단지 설정', true);
  const c = await oCfg();
  view().innerHTML = `<div class="card">
    <h2>동·호 목록 <span class="muted">${c.units.length}세대</span></h2>
    <textarea id="o_units" rows="6" placeholder="한 줄에 하나: 101동 101호 / 101,101 / 101-101 (엑셀에서 동·호 두 칸을 복사해 붙여넣어도 됩니다)">${esc(c.units.join('\n'))}</textarea>
    <details style="margin-top:8px"><summary class="muted">자동으로 만들기(동·층·호)</summary>
      <div class="grid2"><div><label for="g_dong">동(쉼표)</label><input id="g_dong" placeholder="101,102,103"></div><div><label for="g_fl">층수</label><input id="g_fl" type="number" inputmode="numeric" placeholder="15"></div></div>
      <div class="grid2"><div><label for="g_ho">층당 호수</label><input id="g_ho" type="number" inputmode="numeric" placeholder="4"></div><div><label>&nbsp;</label><button class="btn block" id="g_make" type="button">목록 만들기</button></div></div></details>
    <h2 style="margin-top:14px">직원 이름</h2><input id="o_staff" value="${esc(c.staff.join(', '))}" placeholder="쉼표로 구분: 김OO, 이OO">
    <label for="o_insp">기본 점검자</label><input id="o_insp" value="${esc(c.inspector)}">
    <h2 style="margin-top:14px">업체 목록</h2><textarea id="o_vendors" rows="4" placeholder="한 줄에 하나: 업체명, 전화, 분야">${esc(c.vendors.map((v) => [v.name, v.phone, v.field].filter((x) => x !== undefined).join(', ')).join('\n'))}</textarea>
    <h2 style="margin-top:14px">자격 시험</h2>
    <div class="grid2"><div><label for="o_exam">시험 이름</label><input id="o_exam" list="o_exl" value="${esc(c.examName)}"><datalist id="o_exl"><option value="전기산업기사"><option value="소방안전관리자 2급"><option value="기계설비유지관리자"></datalist></div>
      <div><label for="o_examd">시험일</label><input id="o_examd" type="date" value="${esc(c.examDate)}"></div></div>
    <div class="muted" style="margin-top:6px">문제 풀이·오답노트는 2차에서 넣습니다.</div>
    <button class="btn primary block" id="o_save" type="button" style="margin-top:12px">💾 저장</button></div>
    <div class="card"><div class="muted">백업은 ONE LIFE 설정 → '백업 파일 받기'에 관리사무소 기록·사진까지 함께 들어갑니다.</div><a class="btn small" href="#/settings" style="margin-top:6px">백업하러 가기</a></div>`;
  $('#g_make').onclick = () => {
    const ds = $('#g_dong').value.split(',').map((x) => x.trim()).filter(Boolean), fl = +$('#g_fl').value, ho = +$('#g_ho').value;
    if (!ds.length || !fl || !ho) { toast('동·층수·층당 호수를 넣어 주세요'); return; }
    const out = []; ds.forEach((d) => { for (let f = 1; f <= fl; f++) for (let h = 1; h <= ho; h++) out.push(`${d}동 ${f}${pad(h)}호`); });
    $('#o_units').value = out.join('\n'); toast(`${out.length}세대를 만들었습니다. 저장을 누르세요`);
  };
  $('#o_save').onclick = async () => {
    const units = [...new Set($('#o_units').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.replace(/동|호/g, ' ').split(/[\s,\t\-]+/).filter(Boolean);
      return m.length >= 2 && /^\d+$/.test(m[0]) && /^\d+$/.test(m[1]) ? `${m[0]}동 ${m[1]}호` : l;
    }))];
    const vendors = $('#o_vendors').value.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((a) => a[0]).map(([name, phone, field]) => ({ name, phone: phone || '', field: field || '' }));
    await setSetting('officeCfg', { ...c, units, staff: $('#o_staff').value.split(',').map((x) => x.trim()).filter(Boolean), inspector: $('#o_insp').value.trim(), vendors, examName: $('#o_exam').value.trim(), examDate: $('#o_examd').value });
    toast(`저장했습니다 (${units.length}세대)`);
  };
}
