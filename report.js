/* ONE LIFE AI — 사진 기반 현장 보고서
 * 작업 전·후 사진을 찍으면 작업 내용(업체용 기록)과 고객용 보고서(이미지·글)를 자동으로 만든다.
 * 문장은 작업 종류별 틀 + 작업 기록(제품·문제·해결)으로 채운다(외부 AI 없음). 다듬기는 Claude로 넘길 수 있다.
 */
'use strict';

/* 작업 종류별 문장 틀. {product}{area}{problem} 자리에 작업 기록이 들어간다 */
const REPORT_TPL = {
  '방충망 교체': {
    before: '기존 방충망이 오래되어 망이 늘어지거나 찢어진 부분이 있었습니다.',
    work: '기존 방충망을 철거하고 새 방충망({product})으로 교체했습니다. 창틀과의 틈이 생기지 않도록 모헤어(틈막이 털)와 레일 상태를 함께 점검했습니다.',
    care: '먼지는 물에 적신 부드러운 솔로 가볍게 닦아 주세요. 방충망을 손으로 세게 밀면 망이 늘어날 수 있습니다.',
  },
  '방충망 수리': {
    before: '방충망 일부가 손상되어 틈으로 벌레가 들어올 수 있는 상태였습니다.',
    work: '손상된 부분을 수리하고({product}), 틀과 레일이 부드럽게 움직이도록 조정했습니다.',
    care: '창을 여닫을 때 방충망을 함께 세게 밀지 않도록 해 주세요.',
  },
  '안전방충망': {
    before: '기존 방충망이 오래되어 교체가 필요한 상태였습니다.',
    work: '기존 방충망을 안전방충망({product})으로 교체하고 고정 상태를 점검했습니다.',
    care: '망에 기대거나 강한 힘을 주지 않도록 해 주세요. 고정 부위가 흔들리면 연락 주세요.',
  },
  'TV 설치': {
    before: '설치할 벽면의 구조와 위치를 확인했습니다.',
    work: '벽면 구조를 확인한 뒤 브라켓을 단단히 고정하고 TV({product})를 수평에 맞춰 설치했습니다. 전선은 보기 좋게 정리했습니다.',
    care: 'TV를 잡아당기거나 기대지 마시고, 흔들림이 느껴지면 사용을 멈추고 연락 주세요.',
  },
  '타일': {
    before: '타일이 들뜨거나 깨진 부분이 있었습니다.',
    work: '손상된 타일을 걷어내고 새 타일({product})로 시공한 뒤 줄눈까지 마감했습니다.',
    care: '시공 직후에는 줄눈이 굳을 때까지 하루 정도 물 사용과 강한 충격을 피해 주세요.',
  },
  '기타': {
    before: '현장 상태를 확인했습니다.',
    work: '요청하신 작업({product})을 진행했습니다.',
    care: '사용 중 불편한 점이 있으면 언제든 연락 주세요.',
  },
};
// 제품이 없으면 괄호째 뺀다
const fill = (s, j) => s.replace(/\(\{product\}\)/g, j.product ? `(${j.product})` : '').replace(/\{area\}/g, j.area || '');

async function bizInfo() {
  const b = await getSetting('biz', {});
  return { name: b.name || '', phone: b.phone || '', blog: b.blog || '', as: b.as || '시공 후 1년 안에 같은 부위에 문제가 생기면 무상으로 점검해 드립니다.' };
}

/* 자동 작성 */
function autoReport(j, c, photos, biz) {
  const tpl = REPORT_TPL[j.type] || REPORT_TPL['기타'];
  const date = (j.scheduledAt || j.doneAt || j.updatedAt || nowISO()).slice(0, 10);
  const nb = photos.filter((p) => p.kind === '시공 전').length, na = photos.filter((p) => p.kind === '시공 후').length;
  return {
    title: `${j.type || '시공'} 완료 보고서`,
    greet: `${c.name ? c.name + ' 고객님, ' : '고객님, '}${biz.name ? biz.name + '입니다. ' : ''}요청하신 작업을 아래와 같이 마쳤습니다.`,
    overview: [`작업일: ${date}`, j.area ? `장소: ${j.area}` : '', `작업: ${j.type || ''}`, j.product ? `제품·규격: ${j.product}` : '', j.duration ? `소요 시간: ${j.duration}` : ''].filter(Boolean).join('\n'),
    before: j.problem ? `${j.problem}` : tpl.before,
    work: j.solution ? `${j.solution}` : fill(tpl.work, j),
    care: tpl.care,
    as: biz.as,
    // 업체 내부용 작업 기록
    log: [`[작업 기록] ${date} ${j.area || ''} ${j.type || ''}`.trim(), j.product ? `- 제품·규격: ${j.product}` : '', `- 작업 전: ${j.problem || tpl.before}`, `- 작업 내용: ${j.solution || fill(tpl.work, j)}`, j.duration ? `- 소요 시간: ${j.duration}` : '', `- 사진: 시공 전 ${nb}장, 시공 후 ${na}장`, j.quote ? `- 금액: ${won(j.quote)}` : ''].filter(Boolean).join('\n'),
  };
}

/* ───────── 보고서 목록 ───────── */
async function viewReports() {
  setTitle('현장 보고서', true);
  const [jobs, custs, photos] = await Promise.all([DB.all('jobs'), DB.all('customers'), DB.all('photos')]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const cnt = (id, k) => photos.filter((p) => p.jobId === id && p.kind === k).length;
  const list = jobs.filter((j) => j.status !== '취소').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  view().innerHTML = `
    <a class="btn primary block" href="#/report/new" style="min-height:56px;font-size:17px">📸 새 현장 (사진부터 찍기)</a>
    <div class="muted" style="margin:8px 0 12px">시공 전·후 사진을 찍고 작업 종류만 고르면 고객용 보고서가 자동으로 만들어집니다.</div>
    ${list.map((j) => { const c = cmap[j.customerId] || {}; const b = cnt(j.id, '시공 전'), a = cnt(j.id, '시공 후'); return `
      <a class="item" href="#/report/${j.id}"><div class="row spread"><span class="t">${esc(nameOf(c))} · ${esc(j.type || '작업')}</span>${j.reportAt ? '<span class="badge s-완료">보고서 보냄</span>' : `<span class="badge s-${j.status}">${j.status}</span>`}</div>
      <div class="muted">${esc(j.area || '')} · 📷 전 ${b} / 후 ${a}${!b || !a ? ' — 사진 필요' : ''}</div></a>`; }).join('') || '<div class="empty">작업이 없습니다.</div>'}`;
}

/* ───────── 새 현장(빠르게) ───────── */
async function viewReportNew() {
  setTitle('새 현장', true);
  const L = await lists();
  view().innerHTML = `
    <form class="card" id="rn" autocomplete="off">
      <label for="rn_type">작업 종류</label><select id="rn_type">${opts(L.jobTypes)}</select>
      <label for="rn_area">장소(아파트·동)</label><input id="rn_area" placeholder="예: 수성구 범어동 OO아파트">
      <label for="rn_product">제품·규격·수량</label><input id="rn_product" placeholder="예: 미세방충망 3개">
      <div class="grid2">
        <div><label for="rn_name">고객 이름(선택)</label><input id="rn_name"></div>
        <div><label for="rn_phone">연락처(선택)</label><input id="rn_phone" type="tel" inputmode="tel"></div>
      </div>
      <div class="muted" style="margin-top:6px">이미 저장된 작업이면 작업 화면에서 '📄 현장 보고서'를 누르세요.</div>
      <button class="btn primary block" type="submit" style="margin-top:12px">다음: 사진 찍기</button>
    </form>`;
  $('#rn').onsubmit = async (e) => {
    e.preventDefault();
    const now = nowISO();
    const ph = digits($('#rn_phone').value);
    let c = ph ? (await DB.all('customers')).find((x) => digits(x.phone) === ph) : null;
    c = { ...(c || { id: uid(), createdAt: now }), name: $('#rn_name').value.trim() || (c && c.name) || '', phone: ph || (c && c.phone) || '', area: $('#rn_area').value.trim(), updatedAt: now };
    await DB.put('customers', c);
    const j = { id: uid(), customerId: c.id, status: '완료', type: $('#rn_type').value, area: $('#rn_area').value.trim(), product: $('#rn_product').value.trim(), source: '기타', scheduledAt: now.slice(0, 16), doneAt: now, createdAt: now, updatedAt: now };
    await DB.put('jobs', j);
    location.replace(`#/report/${j.id}`);
  };
}

/* ───────── 보고서 만들기 ───────── */
async function viewReport(id) {
  const j = await DB.get('jobs', id);
  if (!j) { setTitle('현장 보고서', true); view().innerHTML = '<div class="empty">작업을 찾을 수 없습니다.</div>'; return; }
  const c = (await DB.get('customers', j.customerId)) || {};
  const biz = await bizInfo();
  setTitle('현장 보고서', true);
  let photos = (await DB.by('photos', 'jobId', id)).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  let sel = new Set(j.reportPhotos || []);
  const r0 = j.report || autoReport(j, c, photos, biz);
  const SEC = [['greet', '인사'], ['overview', '작업 개요'], ['before', '작업 전 상태'], ['work', '작업 내용'], ['care', '관리 안내'], ['as', 'A/S 안내']];

  view().innerHTML = `
    <div class="card"><div class="t" style="font-weight:800">${esc(nameOf(c))} · ${esc(j.type || '작업')}</div><div class="muted">${esc(j.area || '')}</div>
      <a class="btn small" href="#/job/${j.id}" style="margin-top:6px">작업 화면</a></div>
    ${['시공 전', '시공 후'].map((k) => `
    <div class="card"><div class="row spread"><h2 style="margin:0">📷 ${k}</h2>
      <div class="row"><label class="btn small" style="margin:0;color:var(--ink)">촬영<input data-k="${k}" class="rp_in" type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn small" style="margin:0;color:var(--ink)">앨범<input data-k="${k}" class="rp_in" type="file" accept="image/*" multiple hidden></label></div></div>
      <div class="photos" id="ph_${k === '시공 전' ? 'b' : 'a'}" style="margin-top:8px"></div></div>`).join('')}
    <div class="muted" style="margin:-4px 0 12px">사진을 누르면 보고서에 넣기/빼기. 표시가 없으면 앞의 사진 2장씩 자동으로 들어갑니다.</div>
    <div class="card"><div class="row spread"><h2 style="margin:0">✍️ 고객용 보고서 글</h2><button class="btn small" id="reAuto" type="button">다시 자동 작성</button></div>
      <label for="r_title">제목</label><input id="r_title" value="${esc(r0.title)}">
      ${SEC.map(([k, t]) => `<label for="r_${k}">${t}</label><textarea id="r_${k}" rows="${k === 'overview' ? 4 : 3}">${esc(r0[k])}</textarea>`).join('')}
    </div>
    <div class="card"><h2>업체 정보 <span class="muted">(보고서 아래에 들어감)</span></h2>
      <div class="grid2"><div><label for="b_name">업체명</label><input id="b_name" value="${esc(biz.name)}"></div><div><label for="b_phone">연락처</label><input id="b_phone" type="tel" value="${esc(biz.phone)}"></div></div>
      <label for="b_blog">블로그·홈페이지(선택)</label><input id="b_blog" value="${esc(biz.blog)}"></div>
    <button class="btn primary block" id="mkImg" type="button" style="min-height:52px">🖼 보고서 이미지 만들기</button>
    <div id="imgBox" style="margin-top:12px"></div>
    <div class="row" style="margin-top:8px"><button class="btn block" id="cpTxt" type="button">📋 보고서 글 복사</button><button class="btn block" id="cpLog" type="button">🗂 작업 기록 복사</button></div>
    <button class="btn block" id="toClaude" type="button" style="margin-top:8px">✨ Claude로 문장 다듬기</button>`;

  // 사진
  const urls = [];
  const auto = (k) => photos.filter((p) => p.kind === k).slice(0, 2).map((p) => p.id);
  const chosen = () => (sel.size ? photos.filter((p) => sel.has(p.id)) : photos.filter((p) => auto('시공 전').includes(p.id) || auto('시공 후').includes(p.id)));
  function drawPhotos() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const ch = new Set(chosen().map((p) => p.id));
    for (const [k, box] of [['시공 전', '#ph_b'], ['시공 후', '#ph_a']]) {
      const ps = photos.filter((p) => p.kind === k);
      $(box).innerHTML = ps.length ? '' : '<div class="muted" style="grid-column:1/-1">아직 사진이 없습니다.</div>';
      ps.forEach((p) => {
        const u = URL.createObjectURL(p.blob); urls.push(u);
        const d = document.createElement('div'); d.className = 'photo';
        d.style.outline = ch.has(p.id) ? '3px solid var(--gold)' : 'none';
        d.innerHTML = `<img src="${u}" alt="${k} 사진">${ch.has(p.id) ? '<span>보고서</span>' : ''}`;
        d.onclick = () => { if (!sel.size) chosen().forEach((x) => sel.add(x.id)); sel.has(p.id) ? sel.delete(p.id) : sel.add(p.id); if (!sel.size) sel = new Set(['__none__']); drawPhotos(); };
        $(box).appendChild(d);
      });
    }
  }
  view().querySelectorAll('.rp_in').forEach((inp) => {
    inp.onchange = async (e) => {
      const files = [...e.target.files]; const k = e.target.dataset.k; e.target.value = '';
      toast('사진 저장 중…');
      for (const f of files) { try { await DB.put('photos', { id: uid(), jobId: id, kind: k, blob: await shrink(f, 1600, 0.82), createdAt: nowISO() }); } catch (err) { toast(err.message); } }
      photos = (await DB.by('photos', 'jobId', id)).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      drawPhotos();
    };
  });
  drawPhotos();

  const readR = () => ({ title: $('#r_title').value.trim(), ...Object.fromEntries(SEC.map(([k]) => [k, $(`#r_${k}`).value.trim()])), log: (j.report && j.report.log) || autoReport(j, c, photos, biz).log });
  const readBiz = () => ({ name: $('#b_name').value.trim(), phone: $('#b_phone').value.trim(), blog: $('#b_blog').value.trim(), as: biz.as });
  const saveAll = async () => {
    const report = readR();
    const b = readBiz();
    await setSetting('biz', b);
    const jj = await DB.get('jobs', id);
    await DB.put('jobs', { ...jj, report, reportPhotos: [...sel].filter((x) => x !== '__none__'), updatedAt: nowISO() });
    return { report, b };
  };
  $('#reAuto').onclick = () => {
    if (!confirm('지금 글을 지우고 다시 자동으로 쓸까요?')) return;
    const r = autoReport(j, c, photos, readBiz());
    $('#r_title').value = r.title; SEC.forEach(([k]) => { $(`#r_${k}`).value = r[k]; });
  };
  const fullText = (r, b) => [`[${r.title}]`, '', r.greet, '', '■ 작업 개요', r.overview, '', '■ 작업 전 상태', r.before, '', '■ 작업 내용', r.work, '', '■ 관리 안내', r.care, '', '■ A/S 안내', r.as, '', [b.name, b.phone, b.blog].filter(Boolean).join(' · ')].join('\n');
  $('#cpTxt').onclick = async () => { const { report, b } = await saveAll(); copyText(fullText(report, b)); };
  $('#cpLog').onclick = async () => { await saveAll(); copyText(autoReport({ ...j, ...(await DB.get('jobs', id)) }, c, photos, readBiz()).log); };
  $('#toClaude').onclick = async () => {
    const { report, b } = await saveAll();
    const p = `아래 시공 완료 보고서를 고객에게 보낼 문장으로 다듬어 주세요. 사실(제품·날짜·장소·작업)은 바꾸지 말고, 정중하고 짧게, 과장 없이 써 주세요. 각 항목 제목은 그대로 두세요.${chosen().length ? '\n(시공 전·후 사진을 첨부하면 사진에 보이는 내용도 반영해 주세요.)' : ''}\n\n${fullText(report, b)}`;
    try { await navigator.clipboard.writeText(p); } catch { /* 무시 */ }
    toast('요청문을 복사했습니다. 다듬은 글을 받으면 위 칸에 붙여넣으세요');
    window.open('https://claude.ai/new?q=' + encodeURIComponent(p), '_blank', 'noopener');
  };

  $('#mkImg').onclick = async () => {
    const { report, b } = await saveAll();
    $('#imgBox').innerHTML = '<div class="muted">만드는 중…</div>';
    try {
      const blob = await renderReportImage(report, b, chosen());
      const u = URL.createObjectURL(blob);
      const file = new File([blob], `시공보고서-${todayStr()}.png`, { type: 'image/png' });
      $('#imgBox').innerHTML = `<img src="${u}" alt="보고서 미리보기" style="width:100%;border-radius:12px;border:1px solid var(--line)">
        <div class="row" style="margin-top:8px"><button class="btn primary block" id="shareImg" type="button">📤 고객에게 보내기</button><a class="btn block" href="${u}" download="${file.name}">⬇ 저장</a></div>
        <div class="muted" style="margin-top:6px">보내기를 누르고 카카오톡·문자를 고르세요.</div>`;
      $('#shareImg').onclick = async () => {
        const txt = `${report.title}\n${report.greet}`;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], text: txt });
            const jj = await DB.get('jobs', id); await DB.put('jobs', { ...jj, reportAt: nowISO() });
            toast('보냈습니다');
          } catch (e) { if (e.name !== 'AbortError') toast('공유 실패: ' + e.message); }
        } else toast('이 기기는 바로 보내기를 지원하지 않습니다. 저장한 뒤 보내 주세요');
      };
    } catch (e) { console.error(e); $('#imgBox').innerHTML = `<div class="card warnbox">이미지 만들기 실패: ${esc(e.message)}</div>`; }
  };
}

/* ───────── 보고서 이미지(1080px 폭 PNG) ───────── */
function loadImg(blob) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(blob); const im = new Image(); im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(u), 1000); }; im.onerror = () => rej(new Error('사진을 열 수 없습니다')); im.src = u; });
}
function wrapLines(g, text, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const ch of para) {
      if (g.measureText(line + ch).width > maxW && line) { out.push(line); line = ch === ' ' ? '' : ch; }
      else line += ch;
    }
    out.push(line);
  }
  return out;
}
async function renderReportImage(r, b, photos) {
  const W = 1080, P = 56, IW = W - P * 2;
  const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  const before = photos.filter((p) => p.kind === '시공 전'), after = photos.filter((p) => p.kind === '시공 후');
  const pairs = Math.max(before.length, after.length);
  const imgs = await Promise.all(photos.map((p) => loadImg(p.blob)));
  const imOf = (p) => imgs[photos.indexOf(p)];
  // 높이 계산용 임시 캔버스
  const tmp = document.createElement('canvas').getContext('2d');
  const secs = [['작업 개요', r.overview], ['작업 전 상태', r.before], ['작업 내용', r.work], ['관리 안내', r.care], ['A/S 안내', r.as]].filter((x) => x[1]);
  tmp.font = `30px ${FONT}`;
  const greetL = wrapLines(tmp, r.greet, IW);
  const secL = secs.map(([, t]) => wrapLines(tmp, t, IW - 24));
  const PH = 380, headH = 210;
  let H = headH + 40 + greetL.length * 46 + 30 + (pairs ? 60 + pairs * (PH + 24) : 0) + secs.reduce((a, s, i) => a + 70 + secL[i].length * 44 + 20, 0) + 150;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#F3F5F9'; g.fillRect(0, 0, W, H);
  // 머리
  const grd = g.createLinearGradient(0, 0, W, headH); grd.addColorStop(0, '#0B1F4B'); grd.addColorStop(1, '#1C60D6');
  g.fillStyle = grd; g.fillRect(0, 0, W, headH);
  g.fillStyle = '#F5C442'; g.font = `bold 30px ${FONT}`; g.fillText(b.name || '시공 보고서', P, 78);
  g.fillStyle = '#FFFFFF'; g.font = `bold 52px ${FONT}`; g.fillText(r.title, P, 150);
  let y = headH + 56;
  g.fillStyle = '#15203A'; g.font = `30px ${FONT}`;
  greetL.forEach((l) => { g.fillText(l, P, y); y += 46; });
  y += 20;
  // 사진(전·후 나란히)
  if (pairs) {
    const cw = (IW - 24) / 2;
    g.font = `bold 30px ${FONT}`; g.fillStyle = '#66708A';
    g.fillText('시공 전', P, y + 30); g.fillText('시공 후', P + cw + 24, y + 30); y += 52;
    for (let i = 0; i < pairs; i++) {
      [[before[i], P], [after[i], P + cw + 24]].forEach(([p, x]) => {
        g.save(); roundRect(g, x, y, cw, PH, 18); g.clip();
        if (p) { const im = imOf(p); const s = Math.max(cw / im.width, PH / im.height); g.drawImage(im, x + (cw - im.width * s) / 2, y + (PH - im.height * s) / 2, im.width * s, im.height * s); }
        else { g.fillStyle = '#E2E6EF'; g.fillRect(x, y, cw, PH); }
        g.restore();
      });
      y += PH + 24;
    }
    y += 8;
  }
  // 항목
  secs.forEach(([t], i) => {
    const h = 56 + secL[i].length * 44;
    g.fillStyle = '#FFFFFF'; roundRect(g, P - 8, y, IW + 16, h, 18); g.fill();
    g.fillStyle = '#1C60D6'; g.font = `bold 30px ${FONT}`; g.fillText(t, P + 12, y + 44);
    g.fillStyle = '#15203A'; g.font = `30px ${FONT}`;
    secL[i].forEach((l, k) => g.fillText(l, P + 12, y + 92 + k * 44));
    y += h + 34; // 위 높이 계산(70 + 줄×44 + 20)과 맞춤
  });
  // 꼬리
  g.fillStyle = '#0B1F4B'; g.fillRect(0, H - 110, W, 110);
  g.fillStyle = '#FFFFFF'; g.font = `bold 32px ${FONT}`; g.fillText([b.name, b.phone].filter(Boolean).join('  ·  ') || '감사합니다', P, H - 62);
  if (b.blog) { g.fillStyle = '#C9D6F5'; g.font = `24px ${FONT}`; g.fillText(b.blog, P, H - 26); }
  return new Promise((res, rej) => cv.toBlob((x) => (x ? res(x) : rej(new Error('이미지 변환 실패'))), 'image/png'));
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
