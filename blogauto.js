/* ✍️ 블로그 자동 작성 (ONE LIFE)
 * 사진(+짧은 메모)만 넣으면 → 어떤 업종에도 맞는 '사람이 쓴 것 같은' 글 요청문을 만들어 내 Claude(claude.ai)로 넘긴다.
 * Claude 답(네이버·티스토리·구글 블로그 3개)을 붙여넣으면 채널별 제목·본문·태그로 나눠 복사·글쓰기 화면 열기,
 * 구글 블로그(Blogger)는 구글 스크립트로 '임시저장' 글까지 바로 올린다(공개는 직접).
 * 티스토리·네이버는 글쓰기 API가 종료돼 앱이 직접 올릴 수 없다(복사·붙여넣기).
 * 사진은 이 폰(photos 저장소, jobId = 'blog-…')에만 저장된다. 고객 이름·전화·동호수는 글에 넣지 않는다.
 */
const BA_CH = [['naver', '🟢 네이버 블로그'], ['tistory', '🟠 티스토리'], ['blogger', '🔵 구글 블로그']];

async function baCfg() {
  const c = await getSetting('blogAuto', {});
  return { biz: '', type: '', region: '', cat: '', goal: '홈판·검색·AI브리핑 노출 → 문의 전화', tone: '친근', contact: '', avoid: '', bloggerId: '', chans: ['naver', 'tistory', 'blogger'], ...c };
}

/* 사람이 쓴 것 같은 글 요청문 — 업종이 무엇이든 [업종]·[지역]만 바뀐다 */
function baPrompt(cfg, d, rules) {
  if (d.kind === 'info') return baPromptInfo(cfg, d, rules); // 정보·조회수형(애드센스·애드포스트)
  const chans = BA_CH.filter(([k]) => d.chans.includes(k));
  const one = (k) => ({
    naver: `===네이버===
- 1,500~2,500자. 소제목 3~5개(짧은 문장형). 사진 자리 [사진1]~[사진${d.n}]을 모두 쓰고, 사진마다 바로 아래 1~2문장으로 사진에 실제로 보이는 것만 설명.
- 제목: 맨 앞에 대표 키워드 → 지역 → 구체 상황(무엇을·왜). 25~35자. 과장(최고·완벽·무조건) 금지.
- 첫 2~3줄은 검색 결과 미리보기에 보일 수 있으니, 무엇을 어떻게 해결했는지 한눈에 알 수 있게 쓰고 그 안에 대표 키워드를 한 번. 본문 전체에는 2~5번만(억지로 반복하지 않기).
- 흐름: 이런 문제로 연락받음 → 현장에서 본 것 → 이렇게 해결함(순서대로, 왜 그렇게 했는지) → 끝난 모습 → 비슷한 상황인 분께 한마디 → [관련 글] 자리 → 문의 안내 1번.
- 줄바꿈(모바일 가독성): 한 줄에 한 문장, 2~3문장마다 빈 줄 하나. 소제목은 '## '로 시작.
- 강조: 소제목 하나에 핵심 문장 1개만 **굵게**. 꼭 알아둘 팁·주의 한두 곳은 줄 맨 앞에 '💡 ' 또는 '⚠️ '를 붙인 한 줄로(앱이 색 상자로 바꿈).
- 마지막 줄에 '태그:' 뒤에 # 태그 8~12개(대표 키워드 1개 + 세부·지역·질문형 키워드).`,
    tistory: `===티스토리===
- 구글 검색용 정보형 글. 2,000~3,000자. 첫 문단 2~3줄에 결론(무엇이 문제였고 어떻게 해결했는지).
- 소제목은 '## '로 4~6개. 비교나 정리가 필요한 곳에 표 1개(마크다운 표). 끝에 자주 묻는 질문 3개(Q/A).
- 사진 자리 [사진n]은 필요한 곳에만 4~8개.
- 제목 바로 다음 줄에 '검색 설명: …'(대표 키워드가 들어간 120자 이내, 무엇을 알 수 있는지), 그다음 줄에 '주소: …'(영문 소문자·숫자·하이픈 3~6단어, 예: window-screen-replacement-suseong).
- 마지막 줄 '태그:' 뒤에 쉼표로 5~8개.`,
    blogger: `===구글===
- 티스토리와 같은 정보형이지만 1,500~2,500자로 짧게, 내용은 겹치지 않게 다른 각도(예: 고르는 법·주의할 점 중심)로.
- 소제목은 '## '로 3~5개. 사진 자리 [사진n] 3~6개.
- 제목 바로 다음 줄에 '검색 설명: …'(120자 이내), 그다음 줄에 '주소: …'(영문 슬러그).
- 마지막 줄 '태그:' 뒤에 쉼표로 5개 안팎.`,
  }[k]);
  return `당신은 [${cfg.type || '업종'}] 일을 직접 하는 사장님의 블로그 글을 대신 써 주는 사람입니다. 네이버 블로그 상위노출 구조를 알지만, 글은 광고 문구가 아니라 현장에서 일한 사람이 쓴 일지처럼 써야 합니다.

[기본 정보]
- 업종: ${cfg.type || '(확인 필요)'} (블로그 1개 = 이 주제 1개)
- 업체명: ${cfg.biz || '(넣지 않음)'} / 지역: ${d.region || cfg.region || '(확인 필요)'}
- 네이버 카테고리: ${cfg.cat || '(확인 필요)'} / 목표: ${cfg.goal}
- 대표 키워드: ${d.kw || '(사진과 메모를 보고 [지역]+[작업] 모양으로 하나 정해 첫 줄에 알려 주세요)'}
- 오늘 작업 메모: ${d.memo || '(없음 — 사진만 보고 쓰기)'}
- 첨부한 사진: ${d.n}장 (찍은 순서 = [사진1]~[사진${d.n}])${d.ai && d.ai.length ? `\n- [사진${d.ai.join('], [사진')}]은 AI로 만든 참고 그림입니다. 현장 사진처럼 쓰지 말고 설명 끝에 '(AI 생성 이미지)'를 붙입니다.` : ''}
- 말투: ${cfg.tone === '전문' ? '차분하고 믿음 가는 전문가 말투(존댓말)' : '옆집 사장님처럼 편안한 존댓말, 가끔 짧은 혼잣말'}
${cfg.contact ? `- 문의 안내 문구: ${cfg.contact}\n` : ''}${cfg.avoid ? `- 쓰지 말 것: ${cfg.avoid}\n` : ''}
[사람이 쓴 글처럼 — 꼭 지킬 것]
1. 사진을 먼저 하나씩 자세히 보고, 사진에 보이는 것(자재·상태·전후 차이·현장 모습)만 사실로 씁니다. 보이지 않는 치수·가격·시간·고객 반응은 지어내지 말고 꼭 필요하면 '(확인 필요)'로 둡니다.
2. 1인칭 사장님 시점. "제가 가서 보니", "솔직히 이 부분은" 처럼 실제로 일한 사람의 판단과 이유를 넣습니다.
3. 문장 길이를 섞습니다(짧은 문장·긴 문장). 같은 말로 시작하는 문장을 연달아 쓰지 않습니다.
4. 쓰지 않을 표현: "~에 대해 알아보겠습니다", "결론적으로", "다양한", "효과적인", "완벽한", "최고의", "~하는 것이 중요합니다", 느낌표 남발, 이모지 2개 넘게, 모든 문단 끝 요약.
5. 목록·번호는 꼭 필요한 곳(순서·체크리스트)에만. 대부분은 말하듯 이어지는 문단으로.
6. 고객 이름·전화·동·호수·차량 번호 등 개인정보는 쓰지 않습니다(사진에 보여도).
7. 업종이 달라도 같은 원칙: 문제 → 원인 → 해결 과정 → 결과 → 비슷한 분께 조언.

[검색에 유리하게 — 내용이 먼저, 형식은 그다음]
8. 독자의 고민을 해결하는 글: 이 글을 읽은 사람이 '그래서 나는 뭘 하면 되는지'를 알 수 있게 씁니다(점검 순서·고르는 기준·주의할 점 중 하나 이상).
9. 비슷한 글보다 한 가지는 더 구체적으로: 현장에서 일한 사람만 아는 디테일(왜 이 자재·방법을 골랐는지, 하기 전에 확인할 것, 흔한 실수)을 1개 이상 넣습니다. 단, 사진·메모에 근거가 없는 수치는 쓰지 않습니다.
10. 시각 자료: 비교·순서·체크가 있는 곳에 표나 체크리스트 1개, 전후 비교는 [사진n] 두 장을 나란히 이어서.
11. 모바일에서 읽기 쉽게: 한 문단 2~4줄, 소제목 사이 문단 2~3개.
12. 키워드는 넓은 말 대신 구체적인 말로: '방충망'보다 '[지역] [작업] [상황]'처럼 고객이 실제로 검색할 문장에 가깝게.
13. 관련 글 연결: 문의 안내 바로 앞에 '[관련 글: 주제]'를 1~2개 넣습니다(사장님이 내 블로그 이전 글 링크로 바꿈). 없는 글 주소를 지어내지 않습니다.

${baRuleText(rules, d.chans)}
[채널별 형식 — 아래 구분선 그대로, 이 순서로만 답하세요]
${chans.map(([k]) => one(k)).join('\n\n')}

각 구분선 다음 줄은 '제목: …'으로 시작하고, 그다음 줄부터 본문입니다. 설명이나 인사말은 쓰지 마세요.`;
}

/* Claude 답 → 채널별 {title, body, tags} */
function baParse(text) {
  const out = {}, t = String(text || '').replace(/\r/g, '');
  const re = /===\s*(네이버|티스토리|구글)\s*===/g; const marks = []; let m;
  while ((m = re.exec(t))) marks.push({ k: { 네이버: 'naver', 티스토리: 'tistory', 구글: 'blogger' }[m[1]], at: m.index, end: re.lastIndex });
  if (!marks.length) marks.push({ k: 'naver', at: 0, end: 0 });
  marks.forEach((mk, i) => {
    let s = t.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : t.length).trim();
    let title = ''; const tm = s.match(/^\s*(?:\*\*)?제목\s*[:：]\s*(.+)$/m);
    if (tm) { title = tm[1].replace(/\*\*/g, '').trim(); s = s.replace(tm[0], '').trim(); }
    let tags = ''; const gm = s.match(/^\s*(?:\*\*)?태그\s*[:：]\s*(.+)$/m);
    if (gm) { tags = gm[1].replace(/\*\*/g, '').trim(); s = s.replace(gm[0], '').trim(); }
    let desc = ''; const dm = s.match(/^\s*(?:\*\*)?검색\s*설명\s*[:：]\s*(.+)$/m);
    if (dm) { desc = dm[1].replace(/\*\*/g, '').trim(); s = s.replace(dm[0], '').trim(); }
    let slug = ''; const um = s.match(/^\s*(?:\*\*)?주소\s*[:：]\s*(.+)$/m);
    if (um) { slug = um[1].replace(/\*\*|`/g, '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''); s = s.replace(um[0], '').trim(); }
    let img = ''; const im = s.match(/^\s*(?:\*\*)?대표\s*그림(?:\s*\(영문\))?\s*[:：]\s*(.+)$/m);
    if (im) { img = im[1].replace(/\*\*/g, '').trim(); s = s.replace(im[0], '').trim(); }
    out[mk.k] = { title, body: s.replace(/^본문\s*[:：]\s*/m, ''), tags, desc, slug, img };
  });
  return out;
}
// 마크다운 본문 → 간단한 HTML(구글 블로그용). 사진 자리는 눈에 띄게 남긴다
function baHtml(body) {
  const e = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const lines = body.split('\n'); let h = '', inTbl = false;
  for (const l of lines) {
    if (/^\|/.test(l)) { if (/^\|\s*-/.test(l)) continue; const cells = l.split('|').slice(1, -1).map((x) => `<td>${e(x.trim())}</td>`).join(''); if (!inTbl) { h += '<table border="1" style="border-collapse:collapse">'; inTbl = true; } h += `<tr>${cells}</tr>`; continue; }
    if (inTbl) { h += '</table>'; inTbl = false; }
    if (/^##\s+/.test(l)) h += `<h2>${e(l.replace(/^##\s+/, ''))}</h2>`;
    else if (/^\[사진\s*\d+\]/.test(l.trim())) h += `<p style="color:#888">${e(l.trim())} (사진은 구글 블로그 편집 화면에서 넣어 주세요)</p>`;
    else if (l.trim()) h += `<p>${e(l)}</p>`;
  }
  if (inTbl) h += '</table>';
  return h;
}

async function viewBlogAuto() {
  setTitle('블로그 자동 작성', '#/');
  const cfg = await baCfg(), mc = await mktCfg(), rules = await baRules();
  const drafts = await getSetting('blogDrafts', []);
  const cur = drafts.find((x) => x.id === sessionStorage.getItem('baCur')) || null;
  const photos = cur ? (await DB.by('photos', 'jobId', cur.id)).sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
  const urls = photos.map((p) => URL.createObjectURL(p.blob));
  const needSet = !cfg.type;
  view().innerHTML = `
    <details class="card" id="baPlanCard"${sessionStorage.getItem('baPlanOpen') ? ' open' : ''}><summary><b>📅 오늘 발행 (편수·방식 고르기)</b></summary><div id="baPlan" style="margin-top:6px"></div></details>
    ${needSet ? '<div class="card warnbox">먼저 아래 ⚙️ 기본 정보(업종·지역)를 넣고 저장하세요. 어떤 업종이든 이 칸만 바꾸면 됩니다.</div>' : ''}
    <div class="card"><label style="margin-top:0">글 종류</label><div class="chips" id="baKind">${[['case', '🛠 시공 후기(실제 사진)'], ['info', '📈 정보·조회수형(애드센스·애드포스트)']].map(([k, n]) => `<button class="chip${(cur?.kind || cfg.kind || 'case') === k ? ' on' : ''}" data-k="${k}">${n}</button>`).join('')}</div>
      <div class="muted" style="font-size:12px">정보·조회수형은 경험을 지어내지 않는 정보 글 규칙과 광고 정책(클릭 유도 금지 등)이 요청문에 들어갑니다. 시공 블로그와 다른 주제면 블로그(또는 카테고리)를 따로 쓰는 게 좋습니다.</div></div>
    <div class="card"><h2>① 사진 넣기</h2>
      <div class="muted" style="font-size:13px">찍은 순서대로 넣으세요(=[사진1], [사진2] …). 사진만 넣어도 됩니다.</div>
      <input id="baFiles" type="file" accept="image/*" multiple style="margin-top:6px">
      ${photos.length ? `<div class="photos" style="margin-top:8px">${photos.map((p, i) => `<div class="photo"><img src="${urls[i]}" alt=""><span>사진${i + 1}${p.kind === 'AI 생성' ? ' · AI' : ''}</span></div>`).join('')}</div>` : ''}
      <details style="margin-top:8px"><summary><b>🎨 AI 그림 만들기 (클라우드플레어)</b></summary><div id="baAi"></div></details>
      <label for="baMemo">짧은 메모 (선택)</label><textarea id="baMemo" rows="3" placeholder="예: 20년 된 아파트, 방충망 삭아서 교체, 미세방충망으로">${esc(cur?.memo || '')}</textarea>
      <div class="grid2"><div><label for="baKw">대표 키워드 (선택)</label><input id="baKw" value="${esc(cur?.kw || '')}" placeholder="예: 수성구 방충망 교체"></div><div><label for="baReg">지역 (이번 글)</label><input id="baReg" value="${esc(cur?.region || cfg.region)}"></div></div>
      <label>올릴 곳</label><div class="chips" id="baCh">${BA_CH.map(([k, n]) => `<button class="chip${(cur?.chans || cfg.chans).includes(k) ? ' on' : ''}" data-k="${k}">${n}</button>`).join('')}</div>
      <div class="grid2" style="margin-top:8px"><button class="btn" id="baNew" type="button">🆕 새 글</button><button class="btn" id="baShare" type="button" ${photos.length ? '' : 'disabled'}>📤 사진 보내기</button></div>
      ${photos.length ? `<button class="btn block" id="baGif" type="button" style="margin-top:6px">🎞 움짤(GIF) 만들기 (사진 ${photos.length}장)</button><div id="baGifOut"></div>` : ''}</div>
    <div class="card"><h2>② 내 Claude로 글 쓰기</h2>
      <div class="muted" style="font-size:13px">요청문을 복사하고 claude.ai를 엽니다. Claude 대화창에 <b>같은 사진을 순서대로 첨부</b>해서 보내세요(📤 사진 보내기로 Claude 앱에 바로 공유 가능). 받은 답 전체를 ③에 붙여넣으면 됩니다.</div>
      <button class="btn primary block" id="baGo" type="button" style="margin-top:8px">🟠 요청문 복사하고 claude.ai 열기</button>
      <details style="margin-top:6px"><summary class="muted">요청문 보기</summary><pre id="baPv" style="white-space:pre-wrap;font-size:12px;max-height:240px;overflow:auto"></pre></details></div>
    <div class="card"><h2>③ Claude 답 붙여넣기</h2>
      <textarea id="baAns" rows="6" placeholder="===네이버=== 로 시작하는 답 전체">${esc(cur?.answer || '')}</textarea>
      <button class="btn block" id="baParse" type="button" style="margin-top:6px">채널별로 나누기</button></div>
    <div id="baOut"></div>
    ${cur ? '<div class="card"><h2>📈 발행 기록·조회수</h2><div id="baPub"></div></div>' : ''}
    <div class="muted" style="font-size:12px;margin:4px 2px">📋 검색 정책 규칙: ${esc(rules ? rules.updated : '불러오지 못함')} 기준${rules && rules.status ? ' · ' + esc(rules.status.slice(0, 40)) : ''} (매주 월요일 검토 후 자동 반영)</div>
    <details class="card"${needSet ? ' open' : ''}><summary><b>⚙️ 기본 정보 (모든 글에 공통)</b></summary>
      <div class="grid2" style="margin-top:6px"><div><label for="bcType">업종 (블로그 주제 1개)</label><input id="bcType" value="${esc(cfg.type)}" placeholder="예: 방충망 시공"></div><div><label for="bcRegion">기본 지역</label><input id="bcRegion" value="${esc(cfg.region)}" placeholder="예: 대구 수성구"></div>
        <div><label for="bcBiz">업체명</label><input id="bcBiz" value="${esc(cfg.biz)}"></div><div><label for="bcCat">네이버 카테고리</label><input id="bcCat" value="${esc(cfg.cat)}" placeholder="예: 홈케어(생활·인테리어)"></div></div>
      <label for="bcInfo">정보·조회수형 블로그 주제 (선택)</label><input id="bcInfo" value="${esc(cfg.infoTopic || '')}" placeholder="예: 생활 꿀팁·집 관리, 정부 지원금">
      <label for="bcGoal">목표</label><input id="bcGoal" value="${esc(cfg.goal)}">
      <label for="bcContact">문의 안내 문구</label><input id="bcContact" value="${esc(cfg.contact)}" placeholder="예: 견적 문의는 010-0000-0000 문자로 사진과 지역을 보내 주세요">
      <label for="bcAvoid">쓰지 말 것 (선택)</label><input id="bcAvoid" value="${esc(cfg.avoid)}" placeholder="예: 경쟁 업체 이름, 할인 약속">
      <label>말투</label><div class="chips" id="bcTone">${['친근', '전문'].map((t) => `<button class="chip${cfg.tone === t ? ' on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
      <label for="bcBid">구글 블로그 ID (바로 올리기용, 선택)</label><input id="bcBid" value="${esc(cfg.bloggerId)}" placeholder="Blogger 대시보드 주소의 blogID= 뒤 숫자">
      <div class="muted" style="font-size:12px">네이버 아이디·티스토리 주소는 📣 마케팅 설정 값을 같이 씁니다${mc.naverId || mc.tistory ? '' : '(아직 비어 있음)'}.</div>
      <button class="btn block" id="bcSave" type="button" style="margin-top:8px">💾 기본 정보 저장</button></details>
    <details class="card"><summary><b>🪪 블로그 소개글 만들기</b></summary><div id="baIntro"></div></details>
    <details class="card"><summary><b>🔐 블로그 계정 메모</b></summary><div id="baVault"></div></details>
    ${drafts.length ? `<div class="card"><h2>지난 글</h2>${drafts.slice(0, 15).map((x) => `<a class="item" href="#" data-open="${x.id}"><div class="t">${esc(x.title || x.kw || '(제목 없음)')}</div><div class="muted">${esc(x.at.slice(0, 10))} · 사진 ${x.n || 0}장</div></a>`).join('')}</div>` : ''}`;

  const chans = () => [...$('#baCh').querySelectorAll('.chip.on')].map((b) => b.dataset.k);
  const kind = () => ($('#baKind .chip.on') || {}).dataset?.k || 'case';
  const data = () => ({ memo: $('#baMemo').value.trim(), kw: $('#baKw').value.trim(), region: $('#baReg').value.trim(), chans: chans(), n: photos.length, kind: kind(), ai: photos.map((p, i) => (p.kind === 'AI 생성' ? i + 1 : 0)).filter(Boolean) });
  const pv = () => { $('#baPv').textContent = baPrompt(cfg, data(), rules); };
  const saveDraft = async (extra = {}) => {
    const list = await getSetting('blogDrafts', []);
    const id = (cur && cur.id) || sessionStorage.getItem('baCur') || 'blog-' + uid();
    const old = list.find((x) => x.id === id) || { id, at: nowISO() };
    const d = { ...old, ...data(), answer: $('#baAns').value, ...extra };
    await setSetting('blogDrafts', [d, ...list.filter((x) => x.id !== id)].slice(0, 30));
    sessionStorage.setItem('baCur', id); return d;
  };
  $('#baKind').onclick = async (e) => { const b = e.target.closest('[data-k]'); if (!b) return; $('#baKind').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); pv(); if (cur) await saveDraft(); };
  $('#baCh').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; b.classList.toggle('on'); pv(); };
  ['baMemo', 'baKw', 'baReg'].forEach((id) => $('#' + id).addEventListener('input', pv));
  $('#bcTone').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; $('#bcTone').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); };
  $('#bcSave').onclick = async () => {
    await setSetting('blogAuto', { ...cfg, type: $('#bcType').value.trim(), region: $('#bcRegion').value.trim(), biz: $('#bcBiz').value.trim(), cat: $('#bcCat').value.trim(), goal: $('#bcGoal').value.trim() || cfg.goal,
      contact: $('#bcContact').value.trim(), infoTopic: $('#bcInfo').value.trim(), avoid: $('#bcAvoid').value.trim(), tone: ($('#bcTone .chip.on') || {}).dataset?.t || '친근', bloggerId: digits($('#bcBid').value) });
    toast('기본 정보를 저장했습니다'); viewBlogAuto();
  };
  $('#baNew').onclick = () => { sessionStorage.removeItem('baCur'); viewBlogAuto(); };
  $('#baFiles').onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    const d = await saveDraft(); const start = photos.length;
    for (let i = 0; i < files.length; i++) {
      let blob; try { blob = await shrink(files[i], 2000, 0.86); } catch { blob = files[i]; } // 블로그용은 조금 크게(긴 변 2000px)
      await DB.put('photos', { id: uid(), jobId: d.id, kind: '블로그', order: start + i, blob, createdAt: nowISO() });
    }
    await saveDraft({ n: start + files.length });
    toast(`사진 ${files.length}장을 넣었습니다`); viewBlogAuto();
  };
  $('#baShare').onclick = async () => {
    const files = photos.map((p, i) => new File([p.blob], `사진${String(i + 1).padStart(2, '0')}.jpg`, { type: p.blob.type || 'image/jpeg' }));
    if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files }); } catch { /* 취소 */ } }
    else files.forEach((f) => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); });
  };
  // 🎞 움짤(GIF)
  if ($('#baGif')) $('#baGif').onclick = async () => {
    const out = $('#baGifOut'), btn = $('#baGif'); btn.disabled = true; out.innerHTML = '<div class="muted" style="margin-top:6px">만드는 중… (사진 수에 따라 10~30초)</div>';
    try {
      const blob = await baMakeGif(photos.map((p) => p.blob), { w: 600, hold: 900 });
      const url = URL.createObjectURL(blob), mb = (blob.size / 1048576).toFixed(1);
      out.innerHTML = `<img src="${url}" alt="움짤 미리보기" style="width:100%;border-radius:8px;margin-top:8px"><div class="muted" style="font-size:12px">${mb}MB · 600px · 사진 ${photos.length}장${blob.size > 10 * 1048576 ? ' — 10MB가 넘어 올리기 어려울 수 있습니다(사진 수를 줄여 보세요)' : ''}</div>
        <div class="grid2" style="margin-top:6px"><button class="btn primary" id="gifSave" type="button">⬇ 저장·공유</button><button class="btn" id="gifRe" type="button">다시 만들기</button></div>
        <div class="muted" style="font-size:12px;margin-top:4px">블로그 글쓰기에서 사진 넣기로 이 GIF 파일을 고르면 움직이는 사진으로 올라갑니다. 보통 글 맨 위나 '끝난 모습' 자리에 넣습니다.</div>`;
      const file = new File([blob], `움짤-${(data().kw || cfg.type || 'blog').replace(/\s+/g, '')}.gif`, { type: 'image/gif' });
      $('#gifSave').onclick = async () => {
        if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch { /* 취소 */ } }
        const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      };
      $('#gifRe').onclick = () => $('#baGif').click();
    } catch (err) { out.innerHTML = `<div class="errbox" style="margin-top:6px">움짤을 만들지 못했습니다: ${esc(err.message)}</div>`; }
    finally { btn.disabled = false; }
  };
  // 📈 발행 기록·조회수
  if (cur && $('#baPub')) baPubUI($('#baPub'), cur, saveDraft);
  // 🪪 블로그 소개글
  { const it = baIntro(cfg), box = $('#baIntro');
    box.innerHTML = `<div class="muted" style="font-size:13px;margin-top:6px">⚙️ 기본 정보(업종·지역·업체명·문의 문구)로 만듭니다. 고쳐서 쓰세요.</div>
      <label>블로그 이름 후보</label>${it.names.map((n) => `<div class="row spread" style="margin:4px 0"><span>${esc(n)}</span><button class="btn small" data-ic="${esc(n)}" type="button">복사</button></div>`).join('')}
      <label>별명</label><div class="row spread"><span>${esc(it.nick)}</span><button class="btn small" data-ic="${esc(it.nick)}" type="button">복사</button></div>
      <label>소개글 (200자 이내, 네이버 블로그 정보 → 소개글)</label><textarea id="ibShort" rows="3">${esc(it.short)}</textarea><button class="btn small" data-icf="ibShort" type="button">복사</button>
      <label>프롤로그·고정 글 첫 화면</label><textarea id="ibPro" rows="9">${esc(it.prologue)}</textarea><button class="btn small" data-icf="ibPro" type="button">복사</button>
      <div class="muted" style="font-size:12px;margin-top:6px">함께 하면 좋은 것: 카테고리를 업종 하나로 정리(예: 시공 후기 / 고르는 법 / 자주 묻는 질문), 프로필 사진은 작업복 차림이나 로고, 대표 이미지는 시공 후 사진.</div>`;
    box.onclick = async (e) => { const t = e.target; const v = t.dataset.ic || (t.dataset.icf && $('#' + t.dataset.icf).value); if (!v) return; try { await navigator.clipboard.writeText(v); toast('복사했습니다'); } catch { prompt('복사해서 쓰세요', v); } };
  }
  // 🎨 AI 그림 → 이 글 사진에 넣기
  const addAiPhoto = async (blob) => { const d = await saveDraft(); await DB.put('photos', { id: uid(), jobId: d.id, kind: 'AI 생성', order: photos.length, blob, createdAt: nowISO() }); await saveDraft({ n: photos.length + 1 }); toast('AI 그림을 이 글 사진에 넣었습니다'); viewBlogAuto(); };
  baAiUI($('#baAi'), cfg, addAiPhoto);
  // 🔐 계정 메모
  baVaultUI($('#baVault'));
  // 📅 오늘 발행
  $('#baPlanCard').addEventListener('toggle', (e) => { if (e.target.open) { sessionStorage.setItem('baPlanOpen', '1'); baPlanUI($('#baPlan'), cfg); } else sessionStorage.removeItem('baPlanOpen'); });
  if ($('#baPlanCard').open) baPlanUI($('#baPlan'), cfg);
  $('#baGo').onclick = async () => {
    if (!cfg.type) { toast('⚙️ 기본 정보에 업종을 먼저 넣으세요'); return; }
    if (!chans().length) { toast('올릴 곳을 하나 이상 고르세요'); return; }
    if (!photos.length && !data().memo) { toast('사진이나 메모를 넣으세요'); return; }
    await saveDraft();
    const p = baPrompt(cfg, data(), rules);
    try { await navigator.clipboard.writeText(p); } catch { /* 무시 */ }
    toast('요청문을 복사했습니다. claude.ai에서 사진을 첨부하고 붙여넣어 보내세요');
    window.open('https://claude.ai/new?q=' + encodeURIComponent(p.slice(0, 6000)), '_blank', 'noopener');
  };
  const drawOut = (parsed) => {
    const keys = Object.keys(parsed);
    $('#baOut').innerHTML = keys.map((k) => { const x = parsed[k], n = (BA_CH.find((c) => c[0] === k) || [k, k])[1];
      return `<div class="card"><h2>${n}</h2><label>제목</label><input data-f="title" data-k="${k}" value="${esc(x.title)}">
        <label>본문 <span class="muted">(${x.body.length.toLocaleString()}자 · 사진 자리 ${(x.body.match(/\[사진\s*\d+\]/g) || []).length}개)</span></label><textarea data-f="body" data-k="${k}" rows="8">${esc(x.body)}</textarea>
        <label>태그</label><input data-f="tags" data-k="${k}" value="${esc(x.tags)}">
        ${k !== 'naver' ? `<label>검색 설명 <span class="muted">(${(x.desc || '').length}/120자 · 티스토리 '글 설명'·Blogger '검색 설명' 칸)</span></label><input data-f="desc" data-k="${k}" value="${esc(x.desc || '')}">
        <label>주소(영문) <span class="muted">(티스토리 'URL 설정'·Blogger '맞춤 링크' 칸)</span></label><input data-f="slug" data-k="${k}" value="${esc(x.slug || '')}">
        <div class="grid2" style="margin-top:6px"><button class="btn small" data-copy="desc" data-k="${k}" type="button">검색 설명 복사</button><button class="btn small" data-copy="slug" data-k="${k}" type="button">주소 복사</button></div>` : ''}
        <div class="grid2" style="margin-top:8px"><button class="btn" data-copy="title" data-k="${k}" type="button">제목 복사</button><button class="btn" data-copy="body" data-k="${k}" type="button">본문 복사</button>
          <button class="btn" data-copy="tags" data-k="${k}" type="button">태그 복사</button><button class="btn primary" data-write="${k}" type="button">✏️ 글쓰기 화면 열기</button></div>
        ${x.img ? `<div class="muted" style="font-size:12px;margin-top:6px">대표 그림 제안: ${esc(x.img)}</div><button class="btn block" data-aiimg="${k}" type="button" style="margin-top:4px">🎨 이 대표 그림 만들어 사진에 넣기</button>` : ''}
        ${k !== 'blogger' ? `<button class="btn primary block" data-rich="${k}" type="button" style="margin-top:6px">🎨 본문 서식 복사 (글꼴·색·줄바꿈 그대로)</button>` : ''}
        ${k === 'blogger' ? `<button class="btn primary block" data-post="${k}" type="button" style="margin-top:6px">🔵 구글 블로그에 임시저장으로 올리기</button><div class="muted" style="font-size:12px">사진은 올라가지 않습니다. Blogger 편집 화면에서 [사진n] 자리에 넣고 '게시'를 눌러 공개하세요.</div>` : ''}
        ${k === 'naver' ? '<div class="muted" style="font-size:12px;margin-top:4px">네이버 글쓰기에서 [사진n] 자리마다 같은 번호 사진을 넣으세요. 태그는 본문 아래 태그 칸에.</div>' : ''}</div>`; }).join('');
    const val = (k, f) => $(`#baOut [data-k="${k}"][data-f="${f}"]`).value;
    $('#baOut').onclick = async (e) => {
      const c = e.target.closest('[data-copy]'), w = e.target.closest('[data-write]'), p = e.target.closest('[data-post]'), rc = e.target.closest('[data-rich]');
      const ai = e.target.closest('[data-aiimg]');
      if (ai) { const pr = (parsed[ai.dataset.k] || {}).img; if (!pr) return; ai.disabled = true; ai.textContent = '그리는 중…'; try { await addAiPhoto(await baAiImage(pr, true)); } catch (err) { ai.disabled = false; ai.textContent = '🎨 다시 시도'; alert(err.message); } }
      if (rc) { const ok = await baCopyRich(val(rc.dataset.k, 'body'), rc.dataset.k); toast(ok ? '서식째 복사했습니다. 글쓰기 본문에 붙여넣으세요' : '이 브라우저는 서식 복사가 안 돼 글만 복사했습니다'); }
      if (c) { try { await navigator.clipboard.writeText(val(c.dataset.k, c.dataset.copy)); toast('복사했습니다'); } catch { prompt('복사해서 쓰세요', val(c.dataset.k, c.dataset.copy)); } }
      if (w) {
        const k = w.dataset.k;
        const url = { naver: 'https://blog.naver.com/GoBlogWrite.naver', tistory: mc.tistory ? `https://${mc.tistory.replace(/^https?:\/\//, '').replace(/\.tistory\.com.*$/, '')}.tistory.com/manage/newpost` : 'https://www.tistory.com/', blogger: cfg.bloggerId ? `https://www.blogger.com/blog/post/edit/${cfg.bloggerId}` : 'https://www.blogger.com/' }[k];
        try { await navigator.clipboard.writeText(val(k, 'title')); toast('제목을 복사했습니다. 붙여넣은 뒤 돌아와 본문 복사를 누르세요'); } catch { /* 무시 */ }
        window.open(url, '_blank', 'noopener');
      }
      if (p) {
        if (!cfg.bloggerId) { alert('⚙️ 기본 정보에 구글 블로그 ID를 넣어 주세요(Blogger 대시보드 주소의 숫자).'); return; }
        p.disabled = true; p.textContent = '올리는 중…';
        try {
          const tags = val('blogger', 'tags').split(/[,#]/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
          const d = await callSheet('blogger', { blogId: cfg.bloggerId, title: val('blogger', 'title'), html: baRich(val('blogger', 'body'), 'blogger'), labels: tags });
          p.textContent = '✅ 임시저장 완료 — Blogger에서 확인'; if (d.url) window.open(d.url, '_blank', 'noopener');
          await saveDraft({ bloggerDraft: d.id || true });
        } catch (err) {
          p.disabled = false; p.textContent = '🔵 다시 시도';
          alert(/unknown action/.test(err.message) ? '구글 스크립트를 새 버전(v6)으로 배포해야 합니다.' : /권한|auth|permission|403/i.test(err.message) ? '구글 블로그 권한이 없습니다. 구글 스크립트 편집기에서 authBlogger를 한 번 실행해 허용해 주세요.\n\n' + err.message : err.message);
        }
      }
    };
  };
  $('#baParse').onclick = async () => {
    const parsed = baParse($('#baAns').value);
    if (!Object.values(parsed).some((x) => x.body)) { toast('붙여넣은 답이 비어 있습니다'); return; }
    await saveDraft({ title: (parsed.naver || parsed.tistory || parsed.blogger || {}).title || '' });
    drawOut(parsed);
  };
  view().querySelectorAll('[data-open]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); sessionStorage.setItem('baCur', a.dataset.open); viewBlogAuto(); }; });
  pv();
  if (cur && cur.answer) drawOut(baParse(cur.answer));
}
