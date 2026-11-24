/* ───────── 간이영수증 (홈 화면 바로가기 '간이영수증' → #/rcpt) ─────────
   현장노트의 작업·견적(est)을 그대로 영수증으로 만들고, 입금 기록은 장부(payments)에 바로 들어간다.
   보내기: 이미지(공유 → 문자·카톡·메일 선택), 문자(글), 이메일(글), 복사.
   외부 서버로 보내지 않는다 — 문자·메일은 폰의 기본 앱이 열리고 사장님이 직접 보낸다. */

// 작업의 영수증 내용: 견적서(est)가 있으면 그대로, 없으면 현장 체크 → 그것도 없으면 견적 금액 한 줄
async function rcptDoc(j) {
  if (j.est && (j.est.lines || []).length) return JSON.parse(JSON.stringify(j.est));
  const P = await priceTable();
  const lines = linesFromCheck(j, P).filter((l) => (+l.qty || 0) * (+l.price || 0) > 0);
  if (lines.length) return { lines, trip: '', discount: '', vat: false, note: '' };
  if (+j.quote > 0) return { lines: [{ name: `${j.type || '작업'}${j.product ? ' ' + j.product : ''}`, qty: 1, unit: '', price: +j.quote, src: 'quote' }], trip: '', discount: '', vat: false, note: '' };
  return { lines: [], trip: '', discount: '', vat: false, note: '' };
}

// 문자·이메일용 글 영수증
function rcptText(e, T, j, c, b, paid) {
  const rows = (e.lines || []).filter((l) => l.name && (+l.qty || 0) * (+l.price || 0) > 0);
  const L = [`[영수증] ${b.name || ''}`.trim(), `날짜: ${fmtDate(todayStr())}`];
  L.push(`고객: ${c.name ? c.name + ' 님' : '고객님'}`);
  if (j.type || j.area) L.push(`작업: ${[j.type, j.area].filter(Boolean).join(' · ')}`);
  L.push('');
  rows.forEach((l) => L.push(`- ${l.name} ${l.qty}${l.unit || ''} × ${won(+l.price)} = ${won((+l.qty || 0) * (+l.price || 0))}`));
  if (T.trip) L.push(`- 출장비 ${won(T.trip)}`);
  if (T.disc) L.push(`- 할인 -${won(T.disc)}`);
  if (e.vat) L.push(`- 부가세(10%) ${won(T.vat)}`);
  L.push('', `합계: ${won(T.total)}`, `받은 금액: ${won(paid)}`, paid >= T.total ? '완납되었습니다. 감사합니다.' : `남은 금액: ${won(T.total - paid)}`);
  if (e.note) L.push(`비고: ${e.note}`);
  if (b.phone) L.push('', `문의: ${b.name ? b.name + ' ' : ''}${b.phone}`);
  return L.join('\n');
}

/* 목록 */
async function viewRcptList() {
  setTitle('간이영수증', true);
  const [jobs, custs, pays] = await Promise.all([DB.all('jobs'), DB.all('customers'), DB.all('payments')]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const when = (j) => j.doneAt || j.scheduledAt || j.updatedAt || j.createdAt || '';
  const list = jobs.filter((j) => j.status !== '취소' && (+j.quote > 0 || (j.est && (j.est.lines || []).length)))
    .sort((a, b) => when(b).localeCompare(when(a)));
  let q = '';
  const draw = () => {
    const s = q.trim(), sd = digits(s);
    const L = list.filter((j) => { const c = cmap[j.customerId] || {}; return !s || (c.name || '').includes(s) || (sd && digits(c.phone).includes(sd)) || (j.type || '').includes(s) || (j.area || '').includes(s); }).slice(0, 60);
    $('#rc_list').innerHTML = L.map((j) => {
      const c = cmap[j.customerId] || {}, total = +j.quote || 0, paid = paidOf(j.id, pays), left = total - paid;
      const st = total && left <= 0 ? '<span class="badge s-완료">완납</span>' : paid ? `<span class="badge" style="color:var(--red)">미수 ${won(left)}</span>` : `<span class="badge s-${j.status}">${esc(j.status)}</span>`;
      return `<a class="item" href="#/rcpt/${j.id}"><div class="row spread"><span class="t">${tIcon(j.type)} ${esc(nameOf(c))}</span>${st}</div>
        <div class="row spread muted"><span>${esc(fmtDate(when(j)))} · ${esc(j.type || '')}${j.area ? ' · ' + esc(j.area) : ''}</span><b style="color:var(--ink)">${won(total)}</b></div></a>`;
    }).join('') || '<div class="muted">해당하는 작업이 없습니다. 현장노트에서 견적을 넣거나, 위의 ‘바로 영수증 쓰기’를 쓰세요.</div>';
  };
  view().innerHTML = `
    <div class="card hero"><b style="font-size:18px">🧾 간이영수증</b><div class="muted" style="margin-top:4px">현장노트 작업을 고르면 견적 내용이 영수증으로 바로 만들어집니다. 받은 돈은 장부에 같이 기록됩니다.</div></div>
    <div class="row" style="margin-bottom:10px"><a class="btn primary block" href="#/rcpt/new">✍️ 바로 영수증 쓰기</a><a class="btn block" href="#/ledger">📒 작업장부</a></div>
    <a class="btn small" href="#/rcptset" style="margin-bottom:10px">⚙️ 영수증 설정(사업자번호·상호·도장)</a>
    <input id="rc_q" placeholder="고객 이름·전화·작업 종류로 찾기" style="margin-bottom:8px">
    <div class="card"><h2>작업 ${list.length}</h2><div id="rc_list"></div></div>`;
  $('#rc_q').oninput = (ev) => { q = ev.target.value; draw(); };
  draw();
}

/* 현장노트에 없는 손님: 바로 영수증 쓰기 → 고객·작업(완료)·입금이 같이 만들어진다 */
async function viewRcptNew() {
  setTitle('바로 영수증 쓰기', true);
  const L = await lists();
  const lines = [{ name: '', qty: 1, price: '' }];
  view().innerHTML = `<div class="card">
      <div class="grid2"><div><label for="rn_name">고객 이름</label><input id="rn_name" placeholder="예: 홍길동"></div><div><label for="rn_phone">전화</label><input id="rn_phone" type="tel" inputmode="tel" placeholder="010-0000-0000"></div></div>
      <label for="rn_email">이메일 (선택)</label><input id="rn_email" type="email" inputmode="email" placeholder="영수증을 메일로 보낼 때">
      <div class="grid2"><div><label for="rn_type">작업 종류</label><select id="rn_type">${opts(L.jobTypes, L.jobTypes[0])}</select></div><div><label for="rn_date">작업 날짜</label><input id="rn_date" type="date" value="${todayStr()}"></div></div>
      <label for="rn_area">지역·주소 (선택)</label><input id="rn_area" placeholder="예: OO동 OO아파트"></div>
    <div class="card"><h2>품목</h2><div id="rn_lines"></div><button class="btn small" id="rn_add" type="button">+ 품목</button>
      <div class="row spread" style="margin-top:10px"><b>합계</b><b id="rn_total" style="font-size:20px">0원</b></div></div>
    <div class="card"><h2>받은 금액</h2><div class="grid2"><div><input id="rn_paid" type="number" inputmode="numeric" placeholder="합계와 같으면 비워 두기"></div><div><select id="rn_method">${opts(METHODS, '계좌이체')}</select></div></div>
      <label class="row" style="margin-top:8px;color:var(--ink);font-size:15px"><input type="checkbox" id="rn_unpaid" style="width:22px;min-height:22px;flex:none"> 아직 안 받음(미수금으로 기록)</label></div>
    <button class="btn primary block" id="rn_save" type="button">🧾 저장하고 영수증 만들기</button>`;
  const readLines = () => view().querySelectorAll('[data-rl]').forEach((el) => { const l = lines[+el.dataset.i]; l[el.dataset.rl] = el.dataset.rl === 'name' ? el.value : (el.value === '' ? '' : +el.value); });
  const total = () => lines.reduce((a, l) => a + (+l.qty || 0) * (+l.price || 0), 0);
  const drawLines = () => {
    $('#rn_lines').innerHTML = lines.map((l, i) => `<div class="row" style="margin:6px 0"><input data-rl="name" data-i="${i}" value="${esc(l.name)}" placeholder="품목" style="flex:2"><input data-rl="qty" data-i="${i}" type="number" inputmode="decimal" step="any" value="${esc(l.qty)}" style="width:56px"><input data-rl="price" data-i="${i}" type="number" inputmode="numeric" step="100" value="${esc(l.price)}" placeholder="단가" style="flex:1">${lines.length > 1 ? `<button class="btn small danger" data-rx="${i}" type="button">✕</button>` : ''}</div>`).join('');
    $('#rn_total').textContent = won(total());
    view().querySelectorAll('[data-rl]').forEach((el) => { el.oninput = () => { readLines(); $('#rn_total').textContent = won(total()); }; });
    view().querySelectorAll('[data-rx]').forEach((b) => { b.onclick = () => { readLines(); lines.splice(+b.dataset.rx, 1); drawLines(); }; });
  };
  $('#rn_add').onclick = () => { readLines(); lines.push({ name: '', qty: 1, price: '' }); drawLines(); };
  drawLines();
  $('#rn_save').onclick = async () => {
    readLines();
    const ls = lines.filter((l) => l.name && (+l.qty || 0) * (+l.price || 0) > 0).map((l) => ({ name: l.name.trim(), qty: +l.qty, unit: '', price: +l.price, src: 'manual' }));
    if (!ls.length) { toast('품목 이름과 단가를 넣어 주세요'); return; }
    const name = $('#rn_name').value.trim(), phone = $('#rn_phone').value.trim(), email = $('#rn_email').value.trim();
    const now = nowISO(), date = $('#rn_date').value || todayStr();
    const custs = await DB.all('customers');
    let c = phone && custs.find((x) => digits(x.phone) && digits(x.phone) === digits(phone));
    if (c) c = { ...c, name: c.name || name, email: email || c.email || '' };
    else c = { id: uid(), createdAt: now, name, phone, area: $('#rn_area').value.trim(), source: '간이영수증', email };
    await DB.put('customers', c);
    const est = { lines: ls, trip: '', discount: '', vat: false, note: '' };
    const T = estTotal(est);
    const j = { id: uid(), createdAt: now, updatedAt: now, customerId: c.id, type: $('#rn_type').value, area: $('#rn_area').value.trim(), status: '완료', scheduledAt: `${date}T${now.slice(11, 16)}`, doneAt: now, quote: T.total, est, memo: '간이영수증으로 작성' };
    await DB.put('jobs', j);
    if (!$('#rn_unpaid').checked) {
      const amt = $('#rn_paid').value === '' ? T.total : +$('#rn_paid').value;
      if (amt > 0) await DB.put('payments', { id: uid(), jobId: j.id, amount: amt, date, method: $('#rn_method').value, createdAt: now });
    }
    toast('저장했습니다 · 장부에 반영됨');
    location.replace(`#/rcpt/${j.id}`);
  };
}

/* 영수증 한 장: 내용 확인 → 입금 기록(장부) → 보내기 */
async function viewRcpt(id) {
  const j = await DB.get('jobs', id);
  setTitle('간이영수증', true);
  if (!j) { view().innerHTML = '<div class="empty">작업을 찾을 수 없습니다.</div>'; return; }
  const [c0, biz, pays] = await Promise.all([DB.get('customers', j.customerId), bizInfoSafe(), DB.by('payments', 'jobId', id)]);
  const c = c0 || {};
  const e = await rcptDoc(j);
  const T = estTotal(e);
  const paid = pays.reduce((a, p) => a + (+p.amount || 0), 0), left = T.total - paid;
  if (!T.total) {
    view().innerHTML = `<div class="card warnbox">이 작업에는 아직 금액이 없습니다.<br>견적서에서 품목과 금액을 넣으면 영수증이 만들어집니다.</div><a class="btn primary block" href="#/est/${id}">🧾 견적서 열기</a>`;
    return;
  }
  const rows = e.lines.filter((l) => l.name && (+l.qty || 0) * (+l.price || 0) > 0);
  view().innerHTML = `
    <div class="card"><div class="row spread"><span class="t" style="font-weight:800">${tIcon(j.type)} ${esc(nameOf(c))}</span><a class="btn small" href="#/job/${id}">작업 보기</a></div>
      <div class="muted">${esc([j.type, j.area].filter(Boolean).join(' · '))}</div>
      <table style="margin-top:8px"><tbody>${rows.map((l) => `<tr><td>${esc(l.name)} <span class="muted">${esc(l.qty)}${esc(l.unit || '')}</span></td><td class="r">${won((+l.qty || 0) * (+l.price || 0))}</td></tr>`).join('')}
        ${T.trip ? `<tr><td>출장비</td><td class="r">${won(T.trip)}</td></tr>` : ''}${T.disc ? `<tr><td>할인</td><td class="r">-${won(T.disc)}</td></tr>` : ''}${e.vat ? `<tr><td>부가세</td><td class="r">${won(T.vat)}</td></tr>` : ''}
        <tr><td><b>합계</b></td><td class="r"><b style="font-size:20px;color:var(--ink)">${won(T.total)}</b></td></tr>
        <tr><td>받은 금액</td><td class="r">${won(paid)}</td></tr>
        <tr><td>${left > 0 ? '남은 금액' : '상태'}</td><td class="r"><b style="color:${left > 0 ? 'var(--red)' : 'var(--green, #1F9D63)'}">${left > 0 ? won(left) : '완납'}</b></td></tr></tbody></table>
      <a class="btn small" href="#/est/${id}" style="margin-top:8px">✏️ 품목·금액 고치기(견적서)</a></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">🧾 간이영수증</h2><a class="btn small" href="#/rcptset">⚙️ 영수증 설정</a></div>
      ${!(biz.bizNo && biz.owner) ? '<div class="muted" style="color:var(--red);font-size:13px;margin-top:6px">사업자등록번호·대표자 같은 공급자 정보가 비어 있습니다. ‘영수증 설정’에서 넣으면 영수증 칸에 들어갑니다.</div>' : ''}
      <img id="rp_prev" alt="간이영수증 미리보기" style="width:100%;margin-top:8px;border-radius:8px;border:1px solid var(--line);background:#fff;min-height:120px"></div>
    ${left > 0 ? `<div class="card"><h2>💰 입금 기록 <span class="muted">→ 장부에 바로 반영</span></h2>
      <div class="grid2"><div><input id="rp_amt" type="number" inputmode="numeric" placeholder="${left}"></div><div><select id="rp_method">${opts(METHODS, '계좌이체')}</select></div></div>
      <button class="btn primary block" id="rp_add" type="button" style="margin-top:8px">입금 기록</button></div>` : ''}
    <div class="card"><h2>📤 보내기</h2>
      <label for="rp_phone">받는 사람 전화</label><input id="rp_phone" type="tel" inputmode="tel" value="${esc(c.phone || '')}" placeholder="010-0000-0000">
      <label for="rp_email">받는 사람 이메일</label><input id="rp_email" type="email" inputmode="email" value="${esc(c.email || '')}" placeholder="name@example.com">
      <div class="muted" style="font-size:12px;margin-top:4px">고객 말고 다른 사람(가족·관리실·회사 경리 등)에게 보낼 때는 위 칸만 바꾸세요. 고객 정보는 바뀌지 않습니다.</div>
      <div class="grid2" style="margin-top:10px"><button class="btn primary" id="rp_img" type="button">🖼 이미지로 보내기</button><button class="btn" id="rp_sms" type="button">💬 문자(글)</button>
        <button class="btn" id="rp_mail" type="button">✉️ 이메일(글)</button><button class="btn" id="rp_copy" type="button">📋 글 복사</button></div>
      <div class="muted" style="font-size:12px;margin-top:6px">이미지로 보내기 → 문자·카톡·Gmail 중 고르면 영수증 그림이 첨부됩니다. 문자(글)·이메일(글)은 받는 사람이 미리 채워진 채로 폰 앱이 열립니다.</div>
      <div id="rp_box" style="margin-top:10px"></div></div>
    ${(j.rcptLog || []).length ? `<div class="card"><h2>보낸 기록</h2>${j.rcptLog.slice(-5).reverse().map((x) => `<div class="muted">${esc(new Date(x.at).toLocaleString('ko-KR'))} · ${esc(x.via)}${x.to ? ' · ' + esc(x.to) : ''}</div>`).join('')}</div>` : ''}`;

  const text = rcptText(e, T, j, c, biz, paid);
  const log = async (via, to) => { const jj = await DB.get('jobs', id); await DB.put('jobs', { ...jj, rcptLog: [...(jj.rcptLog || []), { at: nowISO(), via, to: to || '' }].slice(-20) }); };
  // 고객 본인 이메일이 비어 있었으면 처음 넣은 주소를 고객 정보에 저장(다음부터 자동)
  const keepEmail = async (em) => { if (em && !c.email && c.id && em !== c.email) { const cc = await DB.get('customers', c.id); if (cc && !cc.email) await DB.put('customers', { ...cc, email: em }); } };

  if ($('#rp_add')) $('#rp_add').onclick = async () => {
    const amt = Number($('#rp_amt').value || left);
    if (!amt) { toast('금액을 넣어 주세요'); return; }
    await DB.put('payments', { id: uid(), jobId: id, amount: amt, date: todayStr(), method: $('#rp_method').value, createdAt: nowISO() });
    const jj = await DB.get('jobs', id);
    const patch = { quote: T.total, updatedAt: nowISO() };
    if (paid + amt >= T.total && jj.status !== '완료') { patch.status = '완료'; patch.doneAt = jj.doneAt || nowISO(); }
    await DB.put('jobs', { ...jj, ...patch });
    toast(`입금 ${won(amt)} 기록 · 장부에 반영됨`); render();
  };
  // 실제 간이영수증 양식 이미지(미리보기와 보내기에 같은 그림)
  const lastMethod = [...pays].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]?.method || '';
  const blobP = renderFormReceipt(e, T, j, c, biz, paid, lastMethod);
  const prevUrl = URL.createObjectURL(await blobP);
  if ($('#rp_prev')) $('#rp_prev').src = prevUrl;
  $('#rp_img').onclick = async () => {
    const blob = await blobP;
    const file = new File([blob], `영수증-${nameOf(c)}-${todayStr()}.png`, { type: 'image/png' });
    const u = prevUrl;
    $('#rp_box').innerHTML = `<a class="btn block" href="${u}" download="${esc(file.name)}">⬇ 영수증 이미지 저장</a>`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '영수증', text: `영수증 - ${biz.name || ''}`.trim() }); await log('이미지 공유'); } catch { /* 취소 */ }
    } else toast('이 기기는 바로 공유가 안 됩니다. 이미지를 저장한 뒤 보내 주세요');
  };
  $('#rp_sms').onclick = async () => {
    const ph = digits($('#rp_phone').value);
    if (!ph) { toast('받는 사람 전화번호를 넣어 주세요'); return; }
    await log('문자', ph);
    location.href = `sms:${ph}?body=${encodeURIComponent(text)}`;
  };
  $('#rp_mail').onclick = async () => {
    const em = $('#rp_email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { toast('받는 사람 이메일을 바르게 넣어 주세요'); return; }
    await keepEmail(em); await log('이메일', em);
    location.href = `mailto:${encodeURIComponent(em)}?subject=${encodeURIComponent(`[영수증] ${biz.name || ''} ${fmtDate(todayStr())}`.trim())}&body=${encodeURIComponent(text)}`;
  };
  $('#rp_copy').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('영수증 글을 복사했습니다'); } catch { prompt('복사해서 쓰세요', text); } };
}
