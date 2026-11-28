/* 📇 연락처·단체 문자 (ONE LIFE)
 * - 명단: 앱 고객 명단(customers 저장소)에 업체명·주소·업종·묶음을 더해 같이 관리한다.
 * - 가져오기: 엑셀(xlsx·csv)·사진(폰 안 무료 글자 인식)·붙여넣기 → 확인표에서 고친 뒤 저장(전화번호로 중복 합침) → 구글 시트 '연락처' 탭에도 기록.
 * - 업체 찾기: 업체명·지역으로 카카오·네이버 지역 검색(키는 구글 스크립트에 있음) → 업체명·전화·주소 저장.
 * - 단체 문자: 웹앱은 혼자 문자를 못 보내므로, 받는 사람·글이 채워진 문자 앱을 한 명씩(또는 묶어서) 연다. 전송은 직접 누른다.
 * 광고 문자는 법에 따라 맨 앞 '(광고)'와 무료수신거부 안내가 필요하다(옵션).
 */
const CT_GROUPS_DEF = ['고객', '거래처', '관리사무소', '지인', '기타'];
const CT_TABS = [['list', '📋 명단'], ['import', '➕ 가져오기'], ['find', '🔎 업체 찾기'], ['sms', '💬 단체 문자']];
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
// 전화번호 모양. 쓸 때마다 새 정규식을 만든다(전역 플래그 상태 때문에 같은 줄을 끝없이 다시 읽던 문제 방지)
const PHONE_RX = () => /(0\d{1,2})[-.\s)]*(\d{3,4})[-.\s]*(\d{4})/g;
const hasPhone = (s) => PHONE_RX().test(s);

function ctLoadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('도구를 불러오지 못했습니다(인터넷 확인)')); document.head.appendChild(s);
  });
}
const ctPhone = (s) => { const d = digits(s); return /^0\d{8,10}$/.test(d) ? d : ''; };
const ctIsMobile = (p) => /^01[016789]\d{7,8}$/.test(p);
async function ctCfg() { return { groups: CT_GROUPS_DEF, optout: '', ...(await getSetting('contactsCfg', {})) }; }

/* ── 글 → 연락처 줄 (붙여넣기·글자 인식·Claude 결과 공통) ── */
function ctParseText(text) {
  const out = [], lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  // CSV(쉼표·탭) 모양이면 칸으로 읽는다: 이름,업체명,전화,주소,업종
  const csvLike = lines.filter((l) => /[,\t]/.test(l) && hasPhone(l)).length >= Math.max(1, lines.length / 2);
  if (csvLike) {
    const rows = lines.map((l) => l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/^"|"$/g, '').trim()));
    return ctFromRows(rows);
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    for (const m of l.matchAll(PHONE_RX())) {
      const phone = ctPhone(m[0]); if (!phone) continue;
      let rest = l.replace(PHONE_RX(), ' ').replace(/(tel|phone|mobile|hp|전화|휴대폰|핸드폰|연락처|대표|팩스|fax)[:.]?/gi, ' ').replace(/[|·•:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!rest && i > 0 && !hasPhone(lines[i - 1])) rest = lines[i - 1];
      const looksCompany = /(주식회사|\(주\)|㈜|상사|건설|인테리어|설비|시공|공사|상회|센터|마트|병원|의원|약국|학원|카페|식당|부동산|관리사무소|사무소|산업|기업|컴퍼니|스튜디오|샵|숍|점$)/.test(rest);
      out.push({ name: looksCompany ? '' : rest.slice(0, 30), company: looksCompany ? rest.slice(0, 40) : '', phone, address: '', category: '' });
    }
  }
  return out;
}
// 표(엑셀·CSV) → 연락처: 첫 줄이 제목이면 이름표로 칸을 찾고, 아니면 전화 칸만 찾는다
function ctFromRows(rows) {
  rows = rows.filter((r) => r && r.some((x) => String(x ?? '').trim()));
  if (!rows.length) return [];
  const head = rows[0].map((x) => String(x ?? '').replace(/\s/g, ''));
  const find = (re) => head.findIndex((h) => re.test(h));
  let col = { name: find(/^(이름|성명|담당자?|고객명|대표자?)$/), company: find(/(업체|상호|회사|거래처|기관|가게|매장)/), phone: find(/(전화|휴대|연락처|핸드폰|번호|mobile|phone|tel)/i),
    address: find(/(주소|소재지|위치)/), category: find(/(업종|분류|카테고리|종목|업태)/), memo: find(/(메모|비고|참고)/), group: find(/(그룹|묶음|구분)/) };
  let body = rows.slice(1);
  if (col.phone < 0) { // 제목 줄이 없으면 전화번호가 가장 많은 칸
    body = rows; const n = rows[0].length; let best = -1, bc = 0;
    for (let c = 0; c < n; c++) { const k = rows.filter((r) => ctPhone(r[c])).length; if (k > bc) { bc = k; best = c; } }
    col = { phone: best, name: best === 0 ? 1 : 0, company: -1, address: -1, category: -1, memo: -1, group: -1 };
  }
  const g = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  return body.map((r) => ({ name: g(r, col.name), company: g(r, col.company), phone: ctPhone(g(r, col.phone)), address: g(r, col.address), category: g(r, col.category), memo: g(r, col.memo), group: g(r, col.group) }))
    .filter((x) => x.phone || x.name || x.company);
}

async function ctReadFile(file, onMsg) {
  if (/\.(xlsx|xls|csv)$/i.test(file.name) || /sheet|excel|csv/.test(file.type)) {
    onMsg('엑셀 읽는 중…');
    if (/\.csv$/i.test(file.name)) return ctParseText(await file.text());
    await ctLoadScript(XLSX_URL);
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    let all = [];
    wb.SheetNames.forEach((n) => { all = all.concat(ctFromRows(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false }))); });
    return all;
  }
  if (/^image\//.test(file.type)) {
    onMsg('사진 글자 읽는 중… (처음엔 한글 글꼴 자료를 받느라 30초~1분 걸릴 수 있음)');
    await ctLoadScript(TESS_URL);
    const w = await Tesseract.createWorker('kor+eng');
    try { const { data } = await w.recognize(file); return ctParseText(data.text).map((x) => ({ ...x, _ocr: true })); }
    finally { await w.terminate(); }
  }
  throw new Error('엑셀(xlsx·xls·csv)이나 사진만 넣을 수 있습니다');
}

/* ── 저장: 전화번호가 같으면 빈칸만 채워 합친다 ── */
async function ctSave(list, group, source) {
  const all = await DB.all('customers'), byPhone = Object.fromEntries(all.filter((c) => c.phone).map((c) => [digits(c.phone), c]));
  const now = nowISO(); let added = 0, merged = 0; const saved = [];
  for (const x of list) {
    const ph = ctPhone(x.phone); if (!ph && !x.name && !x.company) continue;
    const old = ph && byPhone[ph];
    if (old) {
      const c = { ...old, name: old.name || x.name, company: old.company || x.company, address: old.address || x.address, category: old.category || x.category,
        memo: [old.memo, x.memo].filter(Boolean).join(' / ').slice(0, 300), group: old.group || x.group || group, updatedAt: now };
      await DB.put('customers', c); saved.push(c); merged++;
    } else {
      const c = { id: uid(), name: x.name || '', company: x.company || '', phone: ph, address: x.address || '', area: (x.address || '').split(' ').slice(0, 3).join(' '),
        category: x.category || '', memo: x.memo || '', group: x.group || group, source, createdAt: now, updatedAt: now };
      await DB.put('customers', c); saved.push(c); if (ph) byPhone[ph] = c; added++;
    }
  }
  // 구글 시트 '연락처' 탭에도 기록(설정돼 있을 때만, 실패해도 앱 저장은 그대로)
  let sheet = '';
  const sc = await getSetting('sheet', {});
  if (sc.url && sc.key && saved.length) {
    try {
      const d = await callSheet('contacts', { rows: saved.map((c) => ({ name: c.name, company: c.company, phone: prettyPhone(c.phone), address: c.address, category: c.category, group: c.group, memo: c.memo, source: c.source || source })) });
      sheet = ` · 시트 새로 ${d.added || 0}·갱신 ${d.updated || 0}`;
    } catch (e) { sheet = ` · 시트 기록 실패(${e.message})`; }
  }
  return `새로 ${added}명 · 합침 ${merged}명${sheet}`;
}

/* ── 화면 ── */
async function viewContacts() {
  setTitle('연락처·단체 문자', '#/');
  const tab = sessionStorage.getItem('ctTab') || 'list';
  const cfg = await ctCfg();
  view().innerHTML = `<div class="chips" id="ctTabs">${CT_TABS.map(([k, n]) => `<button class="chip${k === tab ? ' on' : ''}" data-k="${k}">${n}</button>`).join('')}</div><div id="ctBody"></div>`;
  $('#ctTabs').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; sessionStorage.setItem('ctTab', b.dataset.k); viewContacts(); };
  const body = $('#ctBody');
  if (tab === 'list') return ctList(body, cfg);
  if (tab === 'import') return ctImport(body, cfg);
  if (tab === 'find') return ctFind(body, cfg);
  return ctSms(body, cfg);
}

async function ctList(body, cfg) {
  const all = (await DB.all('customers')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  let q = '', g = '';
  body.innerHTML = `<input id="ctQ" type="search" placeholder="이름·업체명·전화·주소 검색" style="margin:8px 0">
    <div class="chips" id="ctG"><button class="chip on" data-g="">전체 ${all.length}</button>${cfg.groups.map((x) => `<button class="chip" data-g="${esc(x)}">${esc(x)} ${all.filter((c) => c.group === x).length}</button>`).join('')}</div>
    <div id="ctL"></div>
    <div class="card"><h2>묶음 이름</h2><div class="muted" style="font-size:13px">쉼표로 구분 (예: 고객, 거래처, 관리사무소)</div><input id="ctGroups" value="${esc(cfg.groups.join(', '))}"><button class="btn small" id="ctGSave" type="button" style="margin-top:6px">저장</button></div>`;
  const draw = () => {
    const list = all.filter((c) => (!g || c.group === g) && (!q || [c.name, c.company, c.phone, c.address, c.category].join(' ').toLowerCase().includes(q)));
    $('#ctL').innerHTML = list.length ? list.slice(0, 300).map((c) => `<a class="item" href="#/customer/${c.id}"><div class="row spread"><span class="t">${esc(c.company || '')}${c.company && c.name ? ' · ' : ''}${esc(c.name || (c.company ? '' : '(이름 없음)'))}</span><span class="muted">${esc(c.group || '')}</span></div>
      <div class="muted">${esc([prettyPhone(c.phone), c.address || c.area, c.category].filter(Boolean).join(' · '))}</div></a>`).join('') + (list.length > 300 ? `<div class="muted">… ${list.length - 300}명 더 (검색으로 좁혀 보세요)</div>` : '')
      : '<div class="empty">명단이 없습니다. ➕ 가져오기나 🔎 업체 찾기로 넣으세요.</div>';
  };
  $('#ctQ').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  $('#ctG').onclick = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; g = b.dataset.g; $('#ctG').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  $('#ctGSave').onclick = async () => { const groups = [...new Set($('#ctGroups').value.split(',').map((x) => x.trim()).filter(Boolean))]; await setSetting('contactsCfg', { ...cfg, groups }); toast('묶음을 저장했습니다'); viewContacts(); };
  draw();
}

function ctReviewTable(rows, cfg, onSave) {
  const box = document.createElement('div'); box.className = 'card';
  const all = DB.all('customers');
  box.innerHTML = `<h2>확인하고 저장 (${rows.length}명)</h2><div class="muted" style="font-size:13px">틀린 칸은 바로 고치세요. 빈 줄이나 필요 없는 줄은 체크를 빼면 저장하지 않습니다.${rows.some((r) => r._ocr) ? ' <b>사진 글자 인식은 틀릴 수 있으니 번호를 꼭 확인하세요.</b>' : ''}</div>
    <label style="margin-top:6px">묶음</label><select id="ctRvG">${cfg.groups.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
    <div class="tblwrap" style="overflow-x:auto;margin-top:8px"><table class="md" style="min-width:640px"><thead><tr><th>✔</th><th>이름</th><th>업체명</th><th>전화</th><th>주소</th><th>업종</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr data-i="${i}"><td><input type="checkbox" class="rvOk" ${r.phone || r.name || r.company ? 'checked' : ''}></td>${['name', 'company', 'phone', 'address', 'category'].map((k) => `<td><input class="rv" data-k="${k}" value="${esc(k === 'phone' ? prettyPhone(r[k]) : r[k] || '')}" style="min-width:${k === 'address' ? 160 : 90}px"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div><div id="ctDup" class="muted" style="font-size:12px;margin-top:4px"></div>
    <button class="btn primary block" id="ctRvSave" type="button" style="margin-top:8px">💾 앱 명단${''}·구글 시트에 저장</button>`;
  all.then((cs) => { const have = new Set(cs.map((c) => digits(c.phone)).filter(Boolean)); const n = rows.filter((r) => r.phone && have.has(r.phone)).length; if (n) box.querySelector('#ctDup').textContent = `이미 명단에 있는 번호 ${n}개는 빈칸만 채워 합칩니다.`; });
  box.querySelector('#ctRvSave').onclick = async () => {
    const pick = [...box.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('.rvOk').checked).map((tr) => {
      const o = {}; tr.querySelectorAll('.rv').forEach((el) => { o[el.dataset.k] = el.value.trim(); }); return o;
    });
    const bad = pick.filter((x) => x.phone && !ctPhone(x.phone));
    if (bad.length && !confirm(`전화번호 모양이 이상한 줄이 ${bad.length}개 있습니다(번호 없이 저장됨). 그래도 저장할까요?`)) return;
    if (!pick.length) { toast('저장할 줄을 체크하세요'); return; }
    const btn = box.querySelector('#ctRvSave'); btn.disabled = true; btn.textContent = '저장 중…';
    try { const msg = await onSave(pick, box.querySelector('#ctRvG').value); toast(msg); box.innerHTML = `<div class="okbox">✅ ${esc(msg)}</div>`; }
    catch (e) { btn.disabled = false; btn.textContent = '💾 다시 저장'; alert(e.message); }
  };
  return box;
}

async function ctImport(body, cfg) {
  body.innerHTML = `<div class="card"><h2>➕ 연락처 가져오기</h2>
      <div class="muted" style="font-size:13px">엑셀(xlsx·xls·csv)이나 명함·명단 사진을 넣으면 이름·업체명·전화·주소를 찾아 확인표로 보여 줍니다. 저장하면 앱 고객 명단과 구글 시트 '연락처' 탭에 같이 들어갑니다.</div>
      <input id="ctFile" type="file" accept=".xlsx,.xls,.csv,image/*" multiple style="margin-top:8px">
      <div id="ctMsg" class="muted" style="margin-top:6px"></div></div>
    <div class="card"><h2>📋 글로 붙여넣기</h2><div class="muted" style="font-size:13px">문자·카톡·엑셀에서 복사한 명단을 붙여넣으세요(한 줄에 한 명, 전화번호가 있는 줄을 읽음).</div>
      <textarea id="ctPaste" rows="5" placeholder="홍길동 010-1234-5678&#10;OO인테리어 053-123-4567 대구 수성구 …"></textarea><button class="btn block" id="ctPasteGo" type="button" style="margin-top:6px">읽기</button></div>
    <div class="card"><h2>🟠 사진을 내 Claude로 정확하게 읽기</h2><div class="muted" style="font-size:13px">글자 인식이 많이 틀리면: 요청문을 복사해 claude.ai를 열고 사진을 첨부해 보내세요. 받은 결과(쉼표로 구분된 줄)를 위 '글로 붙여넣기' 칸에 붙여넣고 읽기를 누르면 됩니다.</div>
      <button class="btn block" id="ctClaude" type="button" style="margin-top:6px">요청문 복사하고 claude.ai 열기</button></div>
    <div id="ctReview"></div>`;
  const show = (rows, src) => {
    const box = $('#ctReview'); box.innerHTML = '';
    if (!rows.length) { box.innerHTML = '<div class="errbox">전화번호가 있는 줄을 찾지 못했습니다. 사진이 흐리면 내 Claude로 읽기를 써 보세요.</div>'; return; }
    box.appendChild(ctReviewTable(rows, cfg, (pick, group) => ctSave(pick, group, src)));
    box.scrollIntoView({ behavior: 'smooth' });
  };
  $('#ctFile').onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    let rows = [], src = '엑셀';
    try {
      for (const f of files) { if (/^image\//.test(f.type)) src = '사진'; rows = rows.concat(await ctReadFile(f, (m) => { $('#ctMsg').textContent = `${f.name}: ${m}`; })); }
      $('#ctMsg').textContent = `${rows.length}명 찾음`; show(rows, src);
    } catch (err) { $('#ctMsg').innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`; }
  };
  $('#ctPasteGo').onclick = () => show(ctParseText($('#ctPaste').value), '붙여넣기');
  $('#ctClaude').onclick = async () => {
    const p = '첨부한 사진(명함·명단·간판 등)에서 연락처를 모두 찾아 아래 형식으로만 답해 주세요. 설명 없이 한 줄에 한 명, 쉼표로 구분합니다.\n이름,업체명,전화,주소,업종\n- 모르는 칸은 비워 두고 지어내지 마세요.\n- 전화번호는 010-0000-0000 모양으로.\n- 같은 사람이 두 번 나오면 한 줄로.';
    try { await navigator.clipboard.writeText(p); } catch { /* 무시 */ }
    toast('요청문을 복사했습니다. claude.ai에서 사진을 첨부해 보내세요');
    window.open('https://claude.ai/new?q=' + encodeURIComponent(p), '_blank', 'noopener');
  };
}

async function ctFind(body, cfg) {
  const last = await getSetting('ctFindLast', { q: '', region: '' });
  body.innerHTML = `<div class="card"><h2>🔎 업체 찾기 (업체명·전화·주소)</h2>
      <div class="muted" style="font-size:13px">카카오 지도 → 네이버 지역 검색 순서로 찾습니다(무료). 네이버 스마트플레이스는 공개 API가 없어 지도 검색 결과로 대신합니다. 키는 구글 스크립트 속성에 넣어야 합니다(아래 안내).</div>
      <div class="grid2" style="margin-top:8px"><div><label for="fQ">업체명·업종</label><input id="fQ" value="${esc(last.q)}" placeholder="예: 방충망, OO인테리어"></div><div><label for="fR">지역</label><input id="fR" value="${esc(last.region)}" placeholder="예: 대구 수성구"></div></div>
      <button class="btn primary block" id="fGo" type="button" style="margin-top:8px">찾기</button><div id="fMsg" class="muted" style="margin-top:6px"></div></div>
    <div id="fRes"></div>
    <details class="card"><summary><b>키 넣는 법 (처음 한 번)</b></summary><ol class="muted" style="font-size:13px">
      <li><b>카카오</b>: developers.kakao.com → 내 애플리케이션 → 앱 만들기 → 앱 키의 <b>REST API 키</b> 복사 → (제품 설정에서 '카카오맵' 사용 켜기)</li>
      <li><b>네이버</b>: developers.naver.com → Application 등록 → 사용 API '검색' → <b>Client ID·Client Secret</b> 복사</li>
      <li>구글 시트 → 확장 프로그램 → Apps Script → ⚙️ 프로젝트 설정 → 스크립트 속성에 <b>KAKAO_REST_KEY</b>, <b>NAVER_CLIENT_ID</b>, <b>NAVER_CLIENT_SECRET</b> 추가(둘 중 하나만 넣어도 됨)</li>
      <li>키는 앱이 아니라 내 구글 스크립트에만 저장됩니다.</li></ol></details>`;
  $('#fGo').onclick = async () => {
    const q = $('#fQ').value.trim(), region = $('#fR').value.trim();
    if (!q) { toast('업체명이나 업종을 넣으세요'); return; }
    await setSetting('ctFindLast', { q, region });
    $('#fMsg').textContent = '찾는 중…'; $('#fRes').innerHTML = '';
    try {
      const d = await callSheet('place', { q, region });
      const items = d.items || [];
      $('#fMsg').innerHTML = `${items.length}곳 찾음${(d.notes || []).length ? ' · ' + esc(d.notes.join(' · ')) : ''}`;
      if (!items.length) return;
      const rows = items.map((x) => ({ name: '', company: x.name, phone: ctPhone(x.phone), address: x.road || x.address, category: x.category, memo: x.url ? '지도: ' + x.url : '', _src: x.src }));
      $('#fRes').appendChild(ctReviewTable(rows, cfg, (pick, group) => ctSave(pick, group, '업체 찾기')));
      const noPhone = rows.filter((r) => !r.phone).length;
      if (noPhone) $('#fMsg').innerHTML += ` · 전화번호 없는 곳 ${noPhone}곳(체크 빼고 저장 권장)`;
    } catch (e) {
      $('#fMsg').innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>${/unknown action/.test(e.message) ? '<br>구글 스크립트를 새 버전(v6)으로 배포해야 합니다.' : ''}`;
    }
  };
}

async function ctSms(body, cfg) {
  const all = (await DB.all('customers')).filter((c) => ctPhone(c.phone));
  const st = { g: '', q: '', mobileOnly: true, ...(await getSetting('ctSmsDraft', {})) };
  body.innerHTML = `<div class="card"><h2>💬 단체 문자</h2>
      <div class="muted" style="font-size:13px">받는 사람을 고르고 글을 쓰면, 이름·글이 채워진 문자 앱을 <b>한 명씩</b> 엽니다. 문자 앱에서 전송을 누르고 돌아와 '다음'을 누르세요. (웹앱은 혼자 문자를 보낼 수 없습니다)</div>
      <label>받는 사람</label><div class="chips" id="sG"><button class="chip${!st.g ? ' on' : ''}" data-g="">전체</button>${cfg.groups.map((x) => `<button class="chip${st.g === x ? ' on' : ''}" data-g="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <input id="sQ" type="search" placeholder="이름·업체명·업종으로 좁히기" value="${esc(st.q)}" style="margin-top:6px">
      <label class="row" style="gap:6px;margin-top:6px"><input type="checkbox" id="sMob" ${st.mobileOnly ? 'checked' : ''} style="width:auto"> 휴대폰 번호(010 등)만</label>
      <div class="row spread" style="margin-top:6px"><span id="sCnt" class="muted"></span><span><button class="btn small" id="sAll" type="button">모두 선택</button> <button class="btn small" id="sNone" type="button">모두 해제</button></span></div>
      <div id="sList" style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:4px 8px;margin-top:6px"></div>
      <label for="sMsg">보낼 글 <span class="muted">({이름}·{업체명}은 받는 사람마다 바뀜)</span></label>
      <textarea id="sMsg" rows="6">${esc(st.msg || '{이름}님 안녕하세요. ')}</textarea>
      <label class="row" style="gap:6px;margin-top:6px"><input type="checkbox" id="sAd" ${st.ad ? 'checked' : ''} style="width:auto"> 광고 문자입니다 (맨 앞 '(광고)'·끝에 수신거부 안내 자동)</label>
      <input id="sOpt" placeholder="무료수신거부 번호(예: 080-000-0000)" value="${esc(cfg.optout || '')}" style="margin-top:4px">
      <div class="muted" style="font-size:12px;margin-top:4px">광고성 문자는 법에 따라 '(광고)'·업체명·수신거부 방법이 들어가야 하고, 밤 9시~아침 8시에는 따로 동의를 받은 사람에게만 보낼 수 있습니다.</div>
      <div id="sPrev" class="okbox" style="font-weight:400;white-space:pre-wrap;margin-top:8px"></div>
      <button class="btn primary block" id="sStart" type="button" style="margin-top:8px">📨 한 명씩 보내기 시작</button>
      <button class="btn block" id="sBatch" type="button" style="margin-top:6px">👥 10명씩 묶어 열기 (안드로이드, 같은 글일 때만)</button></div>
    <div id="sRun"></div>`;
  const sel = new Set(st.sel || []);
  const matches = () => all.filter((c) => (!st.g || c.group === st.g) && (!st.mobileOnly || ctIsMobile(digits(c.phone))) && (!st.q || [c.name, c.company, c.category, c.address].join(' ').toLowerCase().includes(st.q.toLowerCase())));
  const keep = () => setSetting('ctSmsDraft', { g: st.g, q: st.q, mobileOnly: st.mobileOnly, msg: $('#sMsg').value, ad: $('#sAd').checked, sel: [...sel] });
  const fill = (c) => { let t = $('#sMsg').value.replace(/\{이름\}/g, c.name || c.company || '고객').replace(/\{업체명\}/g, c.company || ''); if ($('#sAd').checked) { const opt = $('#sOpt').value.trim(); t = '(광고) ' + t + (opt ? `\n무료수신거부 ${opt}` : '\n수신을 원치 않으시면 답장 주세요'); } return t; };
  const draw = () => {
    const list = matches();
    $('#sList').innerHTML = list.length ? list.map((c) => `<label class="row" style="gap:8px;padding:5px 0;border-bottom:1px solid var(--line)"><input type="checkbox" data-id="${c.id}" ${sel.has(c.id) ? 'checked' : ''} style="width:auto"><span style="flex:1">${esc(c.company || '')}${c.company && c.name ? ' · ' : ''}${esc(c.name || '')}<span class="muted"> ${esc(prettyPhone(c.phone))}</span></span>${(c.smsLog || []).length ? `<span class="muted" style="font-size:11px">보낸 ${c.smsLog.length}</span>` : ''}</label>`).join('') : '<div class="muted" style="padding:8px">조건에 맞는 번호가 없습니다.</div>';
    const n = list.filter((c) => sel.has(c.id)).length;
    $('#sCnt').textContent = `${list.length}명 중 ${n}명 선택`;
    const first = list.find((c) => sel.has(c.id));
    $('#sPrev').textContent = first ? `미리보기 (${first.company || first.name})\n\n${fill(first)}` : '받는 사람을 고르면 미리보기가 나옵니다.';
  };
  $('#sG').onclick = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; st.g = b.dataset.g; $('#sG').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); draw(); keep(); };
  $('#sQ').oninput = (e) => { st.q = e.target.value.trim(); draw(); };
  $('#sMob').onchange = (e) => { st.mobileOnly = e.target.checked; draw(); keep(); };
  $('#sList').onchange = (e) => { const id = e.target.dataset.id; if (!id) return; if (e.target.checked) sel.add(id); else sel.delete(id); draw(); keep(); };
  $('#sAll').onclick = () => { matches().forEach((c) => sel.add(c.id)); draw(); keep(); };
  $('#sNone').onclick = () => { matches().forEach((c) => sel.delete(c.id)); draw(); keep(); };
  ['sMsg', 'sAd', 'sOpt'].forEach((id) => { $('#' + id).addEventListener('input', () => { draw(); keep(); }); $('#' + id).addEventListener('change', () => { draw(); keep(); }); });
  $('#sOpt').addEventListener('change', async () => setSetting('contactsCfg', { ...cfg, optout: $('#sOpt').value.trim() }));
  const targets = () => matches().filter((c) => sel.has(c.id));
  const check = () => {
    const ts = targets(), msg = $('#sMsg').value.trim();
    if (!ts.length) { toast('받는 사람을 고르세요'); return null; }
    if (!msg) { toast('보낼 글을 쓰세요'); return null; }
    const h = new Date().getHours();
    if ($('#sAd').checked && (h >= 21 || h < 8) && !confirm('지금은 밤 9시~아침 8시입니다. 광고 문자는 이 시간에 따로 동의한 사람에게만 보낼 수 있습니다. 그래도 계속할까요?')) return null;
    return ts;
  };
  const logSent = async (c, text) => { const cur = (await DB.get('customers', c.id)) || c; await DB.put('customers', { ...cur, smsLog: [...(cur.smsLog || []), { at: nowISO(), text: text.slice(0, 200) }].slice(-30) }); };
  const open = (href) => { const a = document.createElement('a'); a.href = href; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 800); };
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  $('#sStart').onclick = () => {
    const ts = check(); if (!ts) return;
    let i = 0; const run = $('#sRun');
    const step = () => {
      if (i >= ts.length) { run.innerHTML = `<div class="okbox">✅ ${ts.length}명 모두 열었습니다. 보낸 기록은 각 연락처에 남았습니다.</div>`; return; }
      const c = ts[i];
      run.innerHTML = `<div class="card"><h2>${i + 1} / ${ts.length}</h2><div class="t">${esc(c.company || '')} ${esc(c.name || '')} <span class="muted">${esc(prettyPhone(c.phone))}</span></div>
        <div class="muted" style="white-space:pre-wrap;font-size:13px;margin:6px 0">${esc(fill(c))}</div>
        <button class="btn primary block" id="rOpen" type="button" style="font-size:17px;padding:12px">💬 문자 앱 열기</button>
        <div class="grid2" style="margin-top:6px"><button class="btn" id="rSkip" type="button">건너뛰기</button><button class="btn" id="rStop" type="button">그만</button></div></div>`;
      run.scrollIntoView({ behavior: 'smooth' });
      $('#rOpen').onclick = async () => {
        const t = fill(c); open(`sms:${digits(c.phone)}${isIOS ? '&' : '?'}body=${encodeURIComponent(t)}`);
        await logSent(c, t); i++; setTimeout(step, 600);
      };
      $('#rSkip').onclick = () => { i++; step(); };
      $('#rStop').onclick = () => { run.innerHTML = `<div class="muted">${i}명까지 열고 멈췄습니다.</div>`; };
    };
    step();
  };
  $('#sBatch').onclick = async () => {
    const ts = check(); if (!ts) return;
    if (/\{이름\}|\{업체명\}/.test($('#sMsg').value)) { alert('묶어 보내기는 모두에게 같은 글이 갑니다. {이름}·{업체명}을 빼거나 한 명씩 보내기를 쓰세요.'); return; }
    if (isIOS) { alert('아이폰은 묶어 열기가 안 됩니다. 한 명씩 보내기를 쓰세요.'); return; }
    const chunks = []; for (let k = 0; k < ts.length; k += 10) chunks.push(ts.slice(k, k + 10));
    let i = 0; const run = $('#sRun'); const text = fill(ts[0]);
    const step = () => {
      if (i >= chunks.length) { run.innerHTML = `<div class="okbox">✅ ${chunks.length}묶음(${ts.length}명) 모두 열었습니다.</div>`; return; }
      run.innerHTML = `<div class="card"><h2>묶음 ${i + 1} / ${chunks.length} (${chunks[i].length}명)</h2><div class="muted" style="font-size:13px">${chunks[i].map((c) => esc(c.company || c.name || prettyPhone(c.phone))).join(', ')}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">단체 대화방이 아니라 각자에게 따로 가는지 문자 앱 설정(그룹 메시지 끄기)을 확인하세요.</div>
        <button class="btn primary block" id="rOpen" type="button" style="font-size:17px;padding:12px;margin-top:6px">💬 이 묶음 문자 앱 열기</button></div>`;
      $('#rOpen').onclick = async () => { open(`sms:${chunks[i].map((c) => digits(c.phone)).join(',')}?body=${encodeURIComponent(text)}`); for (const c of chunks[i]) await logSent(c, text); i++; setTimeout(step, 600); };
    };
    step();
  };
  draw();
}
