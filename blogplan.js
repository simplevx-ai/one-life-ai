/* 📅 오늘 발행 (ONE LIFE 블로그) — 편수·방식(예약·자동·반자동·직접)을 그날그날 골라 시트 '발행대기'에 넣는다.
 * 예약: 네이버·티스토리 편집기의 '예약 발행'으로 사장님이 시각을 건다 / 자동: 구글 블로그는 시각이 되면 구글 스크립트가 공개 발행
 * 반자동: Claude가 PC 크롬(사장님 로그인 상태)에서 글을 채우고 발행은 사장님 / 직접: 지금 바로 올림
 * 오류·미처리는 매일 저녁 점검 작업이 디스코드로 알린다. */
const BA_MODES = { naver: ['예약', '반자동', '직접', '안 함'], tistory: ['예약', '반자동', '직접', '안 함'], blogger: ['자동', '예약', '반자동', '직접', '안 함'] };
const BA_CHN = { naver: '🟢 네이버', tistory: '🟠 티스토리', blogger: '🔵 구글' };
const baPad = (n) => String(n).padStart(2, '0');
function baSlot(start, hhmm, k, perDay, gapH) { // k번째 글의 발행 시각
  const d = new Date(start + 'T' + hhmm); d.setDate(d.getDate() + Math.floor(k / perDay)); d.setHours(d.getHours() + (k % perDay) * gapH);
  return `${d.getFullYear()}-${baPad(d.getMonth() + 1)}-${baPad(d.getDate())} ${baPad(d.getHours())}:${baPad(d.getMinutes())}`;
}
async function baPlanUI(box, cfg) {
  const plan = { perDay: 1, gapH: 3, time: '09:00', ...(await getSetting('blogPlan', {})) };
  const drafts = (await getSetting('blogDrafts', [])).filter((d) => d.answer && Object.values(baParse(d.answer)).some((x) => x.body));
  const start = plan.start && plan.start >= todayStr() ? plan.start : todayStr();
  const modes = plan.modes || {};
  box.innerHTML = `<div class="muted" style="font-size:13px">Claude 답까지 붙여넣은 글(${drafts.length}편)에서 고릅니다. 방식은 채널마다 그날그날 고르세요.<br>
      <b>예약</b>: 네이버·티스토리 편집기 '예약 발행'으로 시각 걸기 · <b>자동</b>: 구글 블로그는 시각이 되면 자동 공개 · <b>반자동</b>: Claude가 PC 크롬에서 글을 채우고 발행은 직접 · <b>직접</b>: 지금 바로 직접 올림</div>
    <label>하루에 몇 편</label><div class="chips" id="plPer">${[1, 2, 3, 5].map((n) => `<button class="chip${plan.perDay === n ? ' on' : ''}" data-n="${n}">${n}편</button>`).join('')}</div>
    <div class="grid2"><div><label for="plStart">시작 날짜</label><input id="plStart" type="date" value="${start}"></div><div><label for="plTime">첫 발행 시각</label><input id="plTime" type="time" value="${plan.time}"></div></div>
    <div class="muted" style="font-size:12px">하루 2편 이상이면 ${plan.gapH}시간 간격, 넘치는 글은 다음 날로 넘어갑니다. 네이버는 짧은 시간에 몰아서 발행하지 않는 게 좋습니다.</div>
    <div id="plList" style="margin-top:8px"></div>
    <button class="btn primary block" id="plGo" type="button" style="margin-top:8px">📅 고른 대로 진행</button>
    <div id="plOut"></div>
    <div class="row spread" style="margin-top:10px"><b>📋 발행 현황 (시트 '발행대기')</b><button class="btn small" id="plRef" type="button">새로고침</button></div><div id="plStat" class="muted" style="font-size:13px">새로고침을 누르면 불러옵니다.</div>`;
  const sel = new Set(drafts.slice(0, plan.perDay).map((d) => d.id));
  const keep = () => setSetting('blogPlan', { ...plan, modes });
  const draw = () => {
    box.querySelector('#plList').innerHTML = drafts.length ? drafts.slice(0, 20).map((d) => {
      const p = baParse(d.answer), chs = Object.keys(p).filter((k) => p[k].body);
      return `<div class="card" style="margin:6px 0;padding:10px"><label class="row" style="gap:8px"><input type="checkbox" data-pick="${d.id}" ${sel.has(d.id) ? 'checked' : ''} style="width:auto"><b style="flex:1">${esc((p.naver || p.tistory || p.blogger || {}).title || d.kw || '(제목 없음)')}</b></label>
        ${chs.map((k) => `<div class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap"><span style="width:76px">${BA_CHN[k]}</span>${BA_MODES[k].map((m) => `<button class="chip${(modes[k] || BA_MODES[k][0]) === m ? ' on' : ''}" data-mode="${k}" data-m="${m}" style="padding:4px 9px;font-size:13px">${m}</button>`).join('')}</div>`).join('')}</div>`;
    }).join('') : '<div class="muted">아직 준비된 글이 없습니다. 아래 ①~③으로 글을 만든 뒤 오세요.</div>';
  };
  draw();
  box.querySelector('#plPer').onclick = async (e) => { const b = e.target.closest('[data-n]'); if (!b) return; plan.perDay = +b.dataset.n; box.querySelectorAll('#plPer .chip').forEach((x) => x.classList.toggle('on', x === b)); sel.clear(); drafts.slice(0, plan.perDay).forEach((d) => sel.add(d.id)); draw(); await keep(); };
  box.querySelector('#plList').onclick = async (e) => { const m = e.target.closest('[data-mode]'); if (!m) return; modes[m.dataset.mode] = m.dataset.m; draw(); await keep(); };
  box.querySelector('#plList').onchange = (e) => { const id = e.target.dataset.pick; if (!id) return; if (e.target.checked) sel.add(id); else sel.delete(id); };
  box.querySelector('#plGo').onclick = async () => {
    const picked = drafts.filter((d) => sel.has(d.id)); if (!picked.length) { toast('발행할 글을 고르세요'); return; }
    plan.start = box.querySelector('#plStart').value || todayStr(); plan.time = box.querySelector('#plTime').value || '09:00';
    await keep();
    const items = [], todo = [];
    picked.forEach((d, k) => {
      const p = baParse(d.answer), when = baSlot(plan.start, plan.time, k, plan.perDay, plan.gapH);
      Object.keys(p).filter((c) => p[c].body).forEach((c) => {
        const mode = modes[c] || BA_MODES[c][0]; if (mode === '안 함') return;
        const it = { appId: d.id, channel: c, mode, when, title: p[c].title, labels: p[c].tags.split(/[,#]/).map((x) => x.trim()).filter(Boolean).slice(0, 10) };
        if (c === 'blogger' && mode === '자동') { if (!cfg.bloggerId) { todo.push({ err: '구글 블로그 ID가 없어 자동 발행을 건너뜀(⚙️ 기본 정보에 넣기)' }); return; } it.html = baRich(p.blogger.body, 'blogger'); it.blogId = cfg.bloggerId; }
        items.push(it); todo.push({ ...it, body: p[c].body, tags: p[c].tags });
      });
    });
    const out = box.querySelector('#plOut'); out.innerHTML = '<div class="muted">시트 발행 대기열에 넣는 중…</div>';
    let sheetMsg = '';
    try { const r = await callSheet('blogQueue', { items }); sheetMsg = `시트 대기열: 새로 ${r.added}·갱신 ${r.updated}`; }
    catch (err) { sheetMsg = '시트 대기열 실패: ' + err.message + (/unknown action/.test(err.message) ? ' (스크립트 v7 배포 필요)' : ''); }
    out.innerHTML = `<div class="okbox" style="font-weight:400;margin-top:8px">${esc(sheetMsg)}</div>` + todo.map((t, i) => t.err ? `<div class="warnlist">${esc(t.err)}</div>` : `<div class="card" style="margin:6px 0;padding:10px"><b>${BA_CHN[t.channel]} · ${esc(t.mode)} · ${esc(t.when)}</b><div class="muted" style="font-size:13px">${esc(t.title)}</div>
      ${t.mode === '자동' ? '<div class="muted" style="font-size:12px">시각이 되면 구글 스크립트가 공개 발행합니다(1시간마다 확인). 결과는 발행 현황과 디스코드로 알려 드립니다.</div>'
      : t.mode === '예약' ? `<div class="muted" style="font-size:12px">① 서식 복사 → 글쓰기에 붙여넣기 → 사진 넣기 → ② 발행 버튼 옆 <b>예약</b>에서 <b>${esc(t.when)}</b> → ③ '예약 걸었음'</div><div class="grid2" style="margin-top:4px"><button class="btn small" data-pc="${i}" data-w="title" type="button">제목 복사</button><button class="btn small" data-pc="${i}" data-w="rich" type="button">🎨 서식 복사</button><button class="btn small" data-po="${i}" type="button">✏️ 글쓰기 열기</button><button class="btn small primary" data-mk="${i}" data-s="예약됨" type="button">✅ 예약 걸었음</button></div>`
      : t.mode === '반자동' ? `<div class="muted" style="font-size:12px">PC 크롬에서 블로그에 로그인해 두고, 요청문을 Claude(디스코드 비서·Claude 앱)에 보내면 Claude가 글쓰기 칸을 채웁니다. 사진 넣기와 발행은 직접 누르세요.</div><div class="grid2" style="margin-top:4px"><button class="btn small" data-semi="${i}" type="button">🤖 Claude 요청문 복사</button><button class="btn small primary" data-mk="${i}" data-s="발행됨" type="button">✅ 발행했음</button></div>`
      : `<div class="grid2" style="margin-top:4px"><button class="btn small" data-pc="${i}" data-w="rich" type="button">🎨 서식 복사</button><button class="btn small" data-po="${i}" type="button">✏️ 글쓰기 열기</button></div><input data-url="${i}" placeholder="올린 글 주소" style="margin-top:4px"><button class="btn small primary block" data-mk="${i}" data-s="발행됨" type="button" style="margin-top:4px">✅ 발행했음</button>`}</div>`).join('');
    const mc = await mktCfg();
    out.onclick = async (e) => {
      const t = e.target, idx = t.dataset.pc ?? t.dataset.po ?? t.dataset.mk ?? t.dataset.semi, it = idx !== undefined ? todo[+idx] : null;
      if (!it) return;
      if (t.dataset.pc !== undefined) {
        if (t.dataset.w === 'rich') { const ok = await baCopyRich(it.body, it.channel); toast(ok ? '서식째 복사했습니다' : '글만 복사했습니다'); }
        else { try { await navigator.clipboard.writeText(it.title); toast('제목을 복사했습니다'); } catch { /* 무시 */ } }
      }
      if (t.dataset.po !== undefined) {
        const url = { naver: 'https://blog.naver.com/GoBlogWrite.naver', tistory: mc.tistory ? `https://${mc.tistory.replace(/^https?:\/\//, '').replace(/\.tistory\.com.*$/, '')}.tistory.com/manage/newpost` : 'https://www.tistory.com/', blogger: cfg.bloggerId ? `https://www.blogger.com/blog/post/edit/${cfg.bloggerId}` : 'https://www.blogger.com/' }[it.channel];
        window.open(url, '_blank', 'noopener');
      }
      if (t.dataset.semi !== undefined) {
        const req = `블로그 반자동 발행 도와줘.\n- 채널: ${BA_CHN[it.channel].replace(/^\S+\s/, '')}\n- 크롬에서 내가 로그인해 둔 글쓰기 화면을 열고 제목·본문·태그만 채워 줘. 사진 넣기와 발행 버튼은 내가 누른다. 비밀번호는 다루지 마.\n- 예약 시각: ${it.when} (예약 발행 칸에 맞춰 줘)\n\n제목: ${it.title}\n태그: ${it.tags}\n\n본문:\n${it.body}`;
        try { await navigator.clipboard.writeText(req); toast('요청문을 복사했습니다. 디스코드 비서나 Claude에 붙여넣으세요'); } catch { prompt('복사해서 쓰세요', req); }
      }
      if (t.dataset.mk !== undefined) {
        const u = out.querySelector(`[data-url="${t.dataset.mk}"]`);
        try { await callSheet('blogQueueMark', { appId: it.appId, channel: it.channel, status: t.dataset.s, result: u ? u.value.trim() : undefined }); t.textContent = '✅ ' + t.dataset.s + ' 기록함'; t.disabled = true; } catch (err) { alert(err.message); }
      }
    };
  };
  box.querySelector('#plRef').onclick = async () => {
    const st = box.querySelector('#plStat'); st.textContent = '불러오는 중…';
    try {
      const { rows } = await callSheet('blogQueueList');
      const color = { 발행됨: 'var(--green,#1F9D63)', 오류: 'var(--red)', '예약 설정 필요': '#E8590C', 대기: 'var(--blue)', 예약됨: 'var(--blue)' };
      st.innerHTML = rows.length ? rows.slice().reverse().slice(0, 30).map((r) => `<div style="border-bottom:1px solid var(--line);padding:4px 0"><b style="color:${color[r.status] || 'inherit'}">${esc(r.status)}</b> · ${esc(r.when)} · ${BA_CHN[r.channel] || esc(r.channel)} ${esc(r.mode)}<div>${esc(r.title)}</div>${r.result ? `<div style="font-size:12px">${/^https?:/.test(r.result) ? `<a href="${esc(r.result)}" target="_blank" rel="noopener">${esc(r.result)}</a>` : esc(r.result)}</div>` : ''}</div>`).join('') : '아직 대기열이 비어 있습니다.';
    } catch (err) { st.textContent = '불러오지 못했습니다: ' + err.message; }
  };
}
