/* ✍️ 블로그 자동 작성 — 도구 모음 (ONE LIFE)
 * - 정책 규칙(blog_rules.json, 매주 검토 작업이 고침)을 요청문에 넣기
 * - 서식 복사: 소제목 크게·색, 핵심 문장 굵게·색, 팁 상자, 문단 줄바꿈 → 네이버·티스토리 편집기에 붙여넣으면 서식 유지
 * - 움짤(GIF): 올린 사진으로 부드럽게 넘어가는 GIF 만들기(폰 안에서, gifenc)
 * - 블로그 소개글 만들기, 🔐 계정 메모(PIN으로 암호화, 이 폰에만·백업 제외), 발행 기록·조회수 기록
 */
const GIFENC_URL = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js';
const BA_STYLE = { navy: '#1F3864', accent: '#E8590C', tipBg: '#FFF4E6', tipLine: '#FFA94D', gray: '#868E96' };

/* ── 정책 규칙 ── */
async function baRules() {
  try { const r = await fetch('blog_rules.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) { const j = await r.json(); await setSetting('blogRulesCache', j); return j; } } catch { /* 오프라인 */ }
  return getSetting('blogRulesCache', null);
}
function baRuleText(rules, chans) {
  if (!rules) return '';
  const pick = (o) => (o ? [...(o.do || []).map((x) => '할 것: ' + x), ...(o.dont || []).map((x) => '하지 말 것: ' + x)] : []);
  const map = { naver: '네이버', tistory: '티스토리', blogger: '구글' };
  const lines = [...pick(rules.common), ...chans.flatMap((k) => pick(rules[k === 'blogger' ? 'google' : k]).map((x) => `[${map[k]}] ${x}`))];
  const top = (rules.top && rules.top.notes || []).slice(0, 6).map((x) => '상위 글 참고: ' + x);
  return `\n[검색 정책·상위 글 분석 반영 (${rules.updated || '날짜 없음'} 기준) — 하지 말 것은 절대 하지 않고, 할 것은 꼭 반영]\n${[...lines, ...top].map((x, i) => `${i + 1}. ${x}`).join('\n')}\n`;
}

/* ── 서식 복사(글꼴·색·줄바꿈) ── */
function baRich(body, ch) {
  const S = BA_STYLE;
  const inl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, `<b><span style="color:${S.accent}">$1</span></b>`);
  const lines = String(body || '').split('\n'); let h = '', tbl = [];
  const flushTbl = () => {
    if (!tbl.length) return;
    h += `<table style="border-collapse:collapse;width:100%;margin:8px 0">${tbl.map((r, i) => `<tr>${r.map((c) => `<${i ? 'td' : 'th'} style="border:1px solid #CED4DA;padding:6px 8px;${i ? '' : `background:${S.navy};color:#fff;`}">${inl(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`;
    tbl = [];
  };
  let first = 0;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^\|/.test(l)) { if (!/^\|\s*:?-/.test(l)) tbl.push(l.split('|').slice(1, -1).map((x) => x.trim())); continue; }
    flushTbl();
    if (!l) { h += '<p><br></p>'; continue; }
    if (/^#{2,3}\s+/.test(l)) { h += `<p style="margin-top:18px"><span style="font-size:20px;font-weight:bold;color:${S.navy}">${inl(l.replace(/^#{2,3}\s+/, ''))}</span></p><p style="margin:2px 0 8px"><span style="color:${S.accent}">━━━━</span></p>`; continue; }
    if (/^\[사진\s*\d+\]/.test(l)) { h += `<p style="text-align:center"><span style="color:${S.gray};font-size:13px">${esc(l)}${ch === 'blogger' ? ' (Blogger 편집 화면에서 사진 넣기)' : ' ← 같은 번호 사진 넣기'}</span></p>`; continue; }
    if (/^\[관련 글/.test(l)) { h += `<p><span style="color:${S.navy};font-size:14px">🔗 ${esc(l.replace(/^\[|\]$/g, ''))}</span></p>`; continue; }
    if (/^(💡|✔|✅|⚠️|📌)/.test(l)) { h += `<p style="background:${S.tipBg};border-left:4px solid ${S.tipLine};padding:8px 10px;margin:6px 0"><span style="font-size:16px">${inl(l)}</span></p>`; continue; }
    if (/^[-*•]\s+/.test(l)) { h += `<p style="margin:2px 0 2px 8px"><span style="font-size:16px">• ${inl(l.replace(/^[-*•]\s+/, ''))}</span></p>`; continue; }
    // 첫 2줄(검색 미리보기)은 조금 크게
    h += first < 2 ? `<p><span style="font-size:17px;color:#212529">${inl(l)}</span></p>` : `<p><span style="font-size:16px;color:#343A40;line-height:1.8">${inl(l)}</span></p>`;
    first++;
  }
  flushTbl();
  return h;
}
async function baCopyRich(body, ch) {
  const html = baRich(body, ch), plain = String(body || '').replace(/\*\*/g, '');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
    return true;
  } catch { try { await navigator.clipboard.writeText(plain); } catch { /* 무시 */ } return false; }
}

/* ── 움짤(GIF) ── */
async function baMakeGif(blobs, opt = {}) {
  const { GIFEncoder, quantize, applyPalette } = await import(GIFENC_URL);
  const W = opt.w || 600, H = opt.h || Math.round(W * 0.75), hold = opt.hold || 900, fades = opt.fade === false ? 0 : 3;
  const imgs = [];
  for (const b of blobs) imgs.push(await createImageBitmap(b));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
  const draw = (img, alpha = 1) => { // 가운데 맞춰 꽉 채우기
    const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s;
    g.globalAlpha = alpha; g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); g.globalAlpha = 1;
  };
  const gif = GIFEncoder();
  const frame = (delay) => { const d = g.getImageData(0, 0, W, H).data; const pal = quantize(d, 256); gif.writeFrame(applyPalette(d, pal), W, H, { palette: pal, delay }); };
  for (let i = 0; i < imgs.length; i++) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); draw(imgs[i]);
    if (opt.label) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, H - 34, W, 34); g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.fillText(opt.label(i), W / 2, H - 11); }
    frame(hold);
    const next = imgs[(i + 1) % imgs.length];
    if (fades && imgs.length > 1) for (let k = 1; k <= fades; k++) { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); draw(imgs[i]); draw(next, k / (fades + 1)); frame(80); }
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/* ── 블로그 소개글 ── */
function baIntro(cfg) {
  const t = cfg.type || '[업종]', r = cfg.region || '[지역]', b = cfg.biz || '[업체명]';
  return {
    names: [`${r} ${t} 현장일지`, `${b}의 ${t} 이야기`, `${t} 잘하는 집 · ${b}`],
    nick: `${b} 사장`,
    short: `${r}에서 ${t} 일을 하는 ${b}입니다. 직접 다녀온 현장 사진과 과정, 고르는 법·주의할 점을 솔직하게 기록합니다.${cfg.contact ? ' ' + cfg.contact : ''}`.slice(0, 200),
    prologue: `📍 ${r} · ${t}\n\n안녕하세요, ${b}입니다.\n이 블로그에는 제가 직접 다녀온 ${t} 현장만 올립니다.\n\n✔ 시공 전·후 사진 그대로\n✔ 왜 이렇게 했는지, 과정과 이유\n✔ 비슷한 고민 있는 분께 도움 될 팁\n\n${cfg.contact ? '📞 ' + cfg.contact : '📞 문의: 프로필의 연락처로 문자 주세요'}`,
  };
}

/* ── 🔐 계정 메모(PIN 암호화, 이 폰에만) ── */
async function baKey(pin, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const b64 = (u8) => btoa(String.fromCharCode(...u8)), unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function baVaultSave(pin, list) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await baKey(pin, salt), new TextEncoder().encode(JSON.stringify(list)));
  await setSetting('vault', { salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)), at: nowISO() });
}
async function baVaultOpen(pin) {
  const v = await getSetting('vault', null); if (!v) return [];
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, await baKey(pin, unb64(v.salt)), unb64(v.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function baVaultUI(box) {
  const has = !!(await getSetting('vault', null));
  box.innerHTML = `<div class="muted" style="font-size:13px">블로그 아이디·비밀번호를 <b>이 폰에만</b> 암호화해 저장합니다(PIN 4자리 이상). 백업 파일·구글 시트로는 나가지 않고, Claude가 대신 로그인하지 않습니다. PIN을 잊으면 열 수 없습니다. 폰에 '비밀번호 관리자(구글·삼성 패스)'가 있으면 그쪽이 더 안전합니다.</div>
    <input id="vPin" type="password" inputmode="numeric" placeholder="PIN" style="margin-top:6px"><button class="btn block" id="vOpen" type="button" style="margin-top:6px">${has ? '🔓 열기' : '🔐 새로 만들기'}</button><div id="vBody"></div>`;
  box.querySelector('#vOpen').onclick = async () => {
    const pin = box.querySelector('#vPin').value; if (pin.length < 4) { toast('PIN을 4자리 이상 넣으세요'); return; }
    let list; try { list = await baVaultOpen(pin); } catch { toast('PIN이 맞지 않습니다'); return; }
    if (!list.length) list = [{ site: '네이버 블로그', id: '', pw: '' }, { site: '티스토리', id: '', pw: '' }, { site: '구글(Blogger)', id: '', pw: '' }];
    const vb = box.querySelector('#vBody');
    const draw = () => {
      vb.innerHTML = list.map((x, i) => `<div class="card" style="margin:8px 0;padding:10px"><input data-i="${i}" data-k="site" value="${esc(x.site)}" placeholder="사이트">
        <div class="grid2" style="margin-top:4px"><input data-i="${i}" data-k="id" value="${esc(x.id)}" placeholder="아이디" autocomplete="off"><input data-i="${i}" data-k="pw" type="password" value="${esc(x.pw)}" placeholder="비밀번호" autocomplete="off"></div>
        <div class="row" style="gap:6px;margin-top:4px"><button class="btn small" data-show="${i}" type="button">보기</button><button class="btn small" data-cp="${i}" type="button">비밀번호 복사</button><button class="btn small danger" data-del="${i}" type="button">삭제</button></div></div>`).join('') +
        `<div class="grid2"><button class="btn" id="vAdd" type="button">+ 추가</button><button class="btn primary" id="vSave" type="button">💾 암호화 저장</button></div><button class="btn block" id="vLock" type="button" style="margin-top:6px">🔒 닫기</button>`;
      vb.oninput = (e) => { const el = e.target; if (el.dataset.i) list[+el.dataset.i][el.dataset.k] = el.value; };
      vb.onclick = async (e) => {
        const t = e.target;
        if (t.dataset.show) { const el = vb.querySelector(`[data-i="${t.dataset.show}"][data-k="pw"]`); el.type = el.type === 'password' ? 'text' : 'password'; }
        if (t.dataset.cp) { try { await navigator.clipboard.writeText(list[+t.dataset.cp].pw); toast('복사했습니다(붙여넣은 뒤 다른 것을 복사해 지우세요)'); } catch { /* 무시 */ } }
        if (t.dataset.del && confirm('이 계정을 지울까요?')) { list.splice(+t.dataset.del, 1); draw(); }
        if (t.id === 'vAdd') { list.push({ site: '', id: '', pw: '' }); draw(); }
        if (t.id === 'vSave') { await baVaultSave(pin, list); toast('암호화해 저장했습니다'); }
        if (t.id === 'vLock') { vb.innerHTML = ''; box.querySelector('#vPin').value = ''; }
      };
    };
    draw();
  };
}

/* ── 발행 기록·조회수 ── */
function baPubUI(box, cur, saveDraft) {
  const pub = cur.pub || {};
  const ch = [['naver', '네이버'], ['tistory', '티스토리'], ['blogger', '구글']];
  const last = (k) => { const v = (pub[k] && pub[k].views) || []; return v.length ? v[v.length - 1] : null; };
  box.innerHTML = `<div class="muted" style="font-size:13px">올린 글 주소를 넣고, 블로그 통계에서 본 조회수를 날짜별로 적어 두면 변화를 볼 수 있습니다(네이버·티스토리는 조회수 공개 API가 없어 자동으로 못 가져옵니다).</div>
    ${ch.map(([k, n]) => `<div style="margin-top:8px"><label>${n} 글 주소</label><input data-url="${k}" value="${esc((pub[k] && pub[k].url) || '')}" placeholder="https://">
      <div class="row" style="gap:6px;margin-top:4px"><input data-view="${k}" type="number" inputmode="numeric" placeholder="오늘 조회수" style="flex:1"><button class="btn small" data-addv="${k}" type="button">기록</button>${(pub[k] && pub[k].url) ? `<a class="btn small" href="${esc(pub[k].url)}" target="_blank" rel="noopener">열기</a>` : ''}</div>
      <div class="muted" style="font-size:12px">${((pub[k] && pub[k].views) || []).slice(-7).map((v) => `${v.d.slice(5)} ${v.n.toLocaleString()}`).join(' · ') || '기록 없음'}${last(k) ? ` · 최근 ${last(k).n.toLocaleString()}회` : ''}</div></div>`).join('')}
    <button class="btn block" id="pubSave" type="button" style="margin-top:8px">💾 주소 저장</button>`;
  const read = () => { const p = JSON.parse(JSON.stringify(pub)); ch.forEach(([k]) => { p[k] = p[k] || {}; p[k].url = box.querySelector(`[data-url="${k}"]`).value.trim(); }); return p; };
  box.onclick = async (e) => {
    const t = e.target;
    if (t.id === 'pubSave') { await saveDraft({ pub: read() }); toast('저장했습니다'); }
    if (t.dataset.addv) {
      const k = t.dataset.addv, n = parseInt(box.querySelector(`[data-view="${k}"]`).value, 10);
      if (!(n >= 0)) { toast('조회수 숫자를 넣으세요'); return; }
      const p = read(); p[k].views = [...(p[k].views || []).filter((v) => v.d !== todayStr()), { d: todayStr(), n }];
      Object.assign(pub, p); await saveDraft({ pub: p }); baPubUI(box, { ...cur, pub: p }, saveDraft); toast('조회수를 기록했습니다');
    }
  };
}
