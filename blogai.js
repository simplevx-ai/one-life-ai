/* 🎨 AI 그림 (ONE LIFE 블로그) — 클라우드플레어 Workers AI(FLUX.1 schnell)를 내 구글 스크립트가 대신 불러 그림을 받는다(키는 스크립트 속성에만).
 * 실제 현장 사진처럼 보이게 쓰지 않도록 기본으로 그림 구석에 'AI 생성 이미지' 표시를 넣고, 글 요청문에도 참고 그림이라고 알린다. */
async function baAiImage(prompt, label = true) {
  const d = await callSheet('aiImage', { prompt, steps: 6 });
  const bin = Uint8Array.from(atob(d.image), (c) => c.charCodeAt(0));
  let blob = new Blob([bin], { type: d.mime || 'image/jpeg' });
  if (!label) return blob;
  const img = await createImageBitmap(blob), cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const fs = Math.max(14, Math.round(img.width / 40)), txt = 'AI 생성 이미지';
  g.font = `bold ${fs}px sans-serif`; const w = g.measureText(txt).width + fs;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(img.width - w - fs / 2, img.height - fs * 2, w, fs * 1.6);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(txt, img.width - w, img.height - fs * 1.2);
  return new Promise((res) => cv.toBlob((b) => res(b || blob), 'image/jpeg', 0.9));
}
// 업종으로 만드는 영문 예시(FLUX는 영어 문장을 더 잘 알아듣는다)
function baAiExample(cfg) {
  const t = (cfg.type || '').replace(/\s+/g, ' ');
  return `A clean, bright photo-style illustration about "${t || 'home repair service'}" in a modern Korean apartment, natural daylight, realistic materials and tools, tidy composition, no people's faces, no text, no logos`;
}
function baAiUI(box, cfg, onSaved) {
  box.innerHTML = `<div class="muted" style="font-size:13px">정보형 글(고르는 법·주의할 점)의 대표 그림이나 설명 그림용입니다. <b>시공 후기에는 실제 사진</b>을 쓰세요. 그림 구석에 'AI 생성 이미지' 표시가 들어가고, 글 요청문에도 참고 그림이라고 알립니다. 영어로 쓰면 더 잘 그립니다.</div>
    <textarea id="aiP" rows="3" placeholder="예: A close-up of a new fine-mesh insect screen on an apartment window, bright daylight, no text"></textarea>
    <div class="grid2" style="margin-top:6px"><button class="btn small" id="aiEx" type="button">예시 넣기</button><label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="aiLb" checked style="width:auto"> 'AI 생성 이미지' 표시</label></div>
    <button class="btn primary block" id="aiGo" type="button" style="margin-top:6px">🎨 그림 만들기 (10~30초)</button><div id="aiOut"></div>`;
  box.querySelector('#aiEx').onclick = () => { box.querySelector('#aiP').value = baAiExample(cfg); };
  box.querySelector('#aiGo').onclick = async () => {
    const p = box.querySelector('#aiP').value.trim(), out = box.querySelector('#aiOut'), btn = box.querySelector('#aiGo');
    if (!p) { toast('그릴 내용을 넣으세요'); return; }
    btn.disabled = true; out.innerHTML = '<div class="muted" style="margin-top:6px">그리는 중…</div>';
    try {
      const blob = await baAiImage(p, box.querySelector('#aiLb').checked), url = URL.createObjectURL(blob);
      out.innerHTML = `<img src="${url}" alt="AI 그림" style="width:100%;border-radius:8px;margin-top:8px"><div class="grid2" style="margin-top:6px"><button class="btn primary" id="aiAdd" type="button">➕ 이 글 사진에 넣기</button><button class="btn" id="aiRe" type="button">다시 그리기</button></div>`;
      out.querySelector('#aiAdd').onclick = async () => { await onSaved(blob, p); };
      out.querySelector('#aiRe').onclick = () => box.querySelector('#aiGo').click();
    } catch (e) {
      out.innerHTML = `<div class="errbox" style="margin-top:6px">${esc(e.message)}${/CF_ACCOUNT_ID|unknown action/.test(e.message) ? '<br>구글 스크립트 속성에 CF_ACCOUNT_ID·CF_API_TOKEN을 넣고, 스크립트가 v8 이상인지 확인하세요.' : ''}</div>`;
    } finally { btn.disabled = false; }
  };
}

/* 📈 정보·조회수형 글(애드센스·애드포스트 수익용) 요청문 — 시공 후기와 달리 경험을 지어내지 않고, 검색 의도·정확한 정보·광고 정책을 지킨다 */
function baPromptInfo(cfg, d, rules) {
  const chans = BA_CH.filter(([k]) => d.chans.includes(k));
  const aiNote = d.ai && d.ai.length ? `\n- [사진${d.ai.join('], [사진')}]은 AI로 만든 참고 그림입니다. 실제 사진처럼 쓰지 말고 설명 끝에 '(AI 생성 이미지)'를 붙입니다.` : '';
  const one = (k) => ({
    naver: `===네이버===
- 1,800~2,800자. 소제목 4~6개('## '). 첫 2~3줄에 검색한 사람이 궁금한 답을 바로 씁니다(결론 먼저).
- 제목: 대표 키워드를 앞쪽에, 내용과 정확히 맞게 25~35자. 낚시·과장 제목 금지.
- 줄바꿈: 한 줄에 한 문장, 2~3문장마다 빈 줄. 핵심 문장은 소제목마다 1개만 **굵게**, 꼭 알아둘 것은 '💡 '나 '⚠️ '로 시작하는 한 줄.
- 표 1개(비교·정리), 체크리스트 1개, 끝에 자주 묻는 질문 3개.${d.n ? ` 사진 자리 [사진1]~[사진${d.n}]을 알맞은 곳에.` : ' 사진이 없으면 [사진: 넣으면 좋은 사진 설명] 자리를 2~3개 제안.'}
- 마지막 줄 '태그:' 뒤에 # 태그 8~12개.`,
    tistory: `===티스토리===
- 구글 검색용 2,500~3,500자. 첫 문단 2~3줄에 답(결론). 소제목 '## ' 5~7개, 표 1개, 자주 묻는 질문 4~5개.
- 제목 바로 다음 줄에 '검색 설명: …'(120자 이내), '주소: …'(영문 슬러그), '대표 그림(영문): …'(사람 얼굴·글자 없는 그림 한 문장).
- 마지막 줄 '태그:' 뒤에 쉼표로 5~8개.`,
    blogger: `===구글===
- 2,000~3,000자, 티스토리와 겹치지 않는 각도(예: 체크리스트·비교 중심). 소제목 '## ' 4~6개.
- 제목 다음 줄에 '검색 설명: …', '주소: …', '대표 그림(영문): …'.
- 마지막 줄 '태그:' 뒤에 쉼표로 5개 안팎.`,
  }[k]);
  return `당신은 검색으로 들어온 사람에게 진짜 도움이 되는 정보 글을 쓰는 블로그 에디터입니다. 목표는 조회수와 광고 수익(구글 애드센스·네이버 애드포스트)이지만, 광고 정책을 지키면서 '읽을 가치가 있는 글'로 조회수를 얻습니다.

[기본 정보]
- 블로그 주제: ${cfg.infoTopic || '(확인 필요)'} (한 블로그·카테고리는 한 주제로 꾸준히)
- 이번 글 주제·대표 키워드: ${d.kw || '(메모를 보고 검색량이 있을 만한 구체적인 키워드 하나를 정해 첫 줄에 알려 주세요)'}
- 참고할 사실·메모: ${d.memo || '(없음)'}
- 첨부 그림·사진: ${d.n}장${aiNote}
- 말투: 친절하고 정확한 존댓말, 과장 없이

[정보 글 — 꼭 지킬 것]
1. 검색 의도(방법·비교·뜻·가격·신청 등)를 먼저 정하고, 첫 2~3줄에 그 답을 씁니다.
2. 사실만 씁니다. 날짜·금액·제도·수치는 확실한 것만, 공식 기관명을 함께 적고 '(YYYY년 MM월 기준)'을 붙입니다. 확실하지 않으면 '(확인 필요)'로 둡니다. 직접 해 보지 않은 경험을 지어내지 않습니다.
3. 단순 요약이 아니라 더 쓸모 있게: 비교표·체크리스트·단계별 방법·흔한 실수 중 2가지 이상.
4. 의학·법률·투자·세금은 일반 정보로만 쓰고 단정하지 않으며 전문가 확인을 권합니다.
5. 다른 글·뉴스를 베끼거나 문장만 바꿔 쓰지 않습니다. 글자 수만 늘리는 반복 문장을 쓰지 않습니다.
6. 쓰지 않을 표현: "~에 대해 알아보겠습니다", "결론적으로", "다양한", "효과적인", "완벽 정리", 느낌표 남발.

[광고 수익 정책 — 반드시 지킬 것]
7. 광고 클릭을 부탁하거나 유도하는 말("광고 눌러 주세요", "아래를 클릭" 등)을 쓰지 않습니다. 광고처럼 보이는 버튼·링크 문구도 쓰지 않습니다.
8. 제목과 본문이 다른 낚시성 글, 자극적·선정적·불법·도박·성인 내용, 저작권 있는 글·사진 무단 사용을 하지 않습니다.
9. 광고 자리가 자연스럽게 들어가도록 소제목 단위로 내용을 나누되, 광고 위치를 글에 적지 않습니다.
${baRuleText(rules, d.chans)}${rules && rules.monetize ? `\n[광고 수익 정책 검토 반영 (${rules.monetize.updated || rules.updated || ''})]\n${[...(rules.monetize.do || []).map((x) => '할 것: ' + x), ...(rules.monetize.dont || []).map((x) => '하지 말 것: ' + x)].map((x, i) => `${i + 1}. ${x}`).join('\n')}\n` : ''}
[채널별 형식 — 아래 구분선 그대로, 이 순서로만 답하세요]
${chans.map(([k]) => one(k)).join('\n\n')}

각 구분선 다음 줄은 '제목: …'으로 시작하고, 그다음 줄부터 본문입니다. 설명이나 인사말은 쓰지 마세요.`;
}

/* ⚡ 정보형 완전 자동: 주제만 넣으면 구글 스크립트가 클라우드플레어 AI로 글(1,500자 이상)·그림(5~10장)을 만들어 구글 블로그에 올린다.
 * 글·그림 만들기에 1~4분 걸려서 시트 연결을 6분까지 기다린다(보통 연결은 40초). */
async function baLongCall(action, extra, ms = 360000) {
  const cfg = await getSetting('sheet', {});
  if (!cfg.url || !cfg.key) throw new Error('설정에서 시트 웹 앱 주소와 비밀 키를 먼저 넣어 주세요');
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ key: cfg.key, kind: '연결 테스트', action, ...extra }), signal: ac.signal });
    const t = await r.text();
    if (!t.trim().startsWith('{')) throw new Error(/Authorization needed/i.test(t) ? '구글 스크립트 권한 허용이 필요합니다(편집기에서 setupBlogAuto 실행 → 허용)' : '시트 응답을 읽지 못했습니다');
    const d = JSON.parse(t); if (!d.ok) throw new Error(d.error || '실패'); return d;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('6분이 지나도 끝나지 않았습니다. 잠시 뒤 발행 현황(시트 발행대기)을 확인하세요 — 서버에서는 계속 만들고 있을 수 있습니다');
    throw e;
  } finally { clearTimeout(timer); }
}
function baAutoUI(box, cfg, getKw) {
  const st = { n: 6, min: 1500, mode: 'draft' };
  box.innerHTML = `<div class="muted" style="font-size:13px">사진 없이 <b>주제(대표 키워드)만</b> 넣으면 클라우드플레어 AI가 글(최소 1,500자)과 그림(5~10장, 'AI 생성 이미지' 표시)을 만들어 <b>구글 블로그</b>에 올립니다. 1~4분 걸립니다. 그림은 구글 드라이브 'ONE LIFE 블로그 그림' 폴더에 저장됩니다.</div>
    <div class="grid2" style="margin-top:6px"><div><label>그림 수</label><select id="auN">${[5, 6, 7, 8, 9, 10].map((n) => `<option${n === 6 ? ' selected' : ''}>${n}</option>`).join('')}</select></div><div><label>최소 글자 수</label><input id="auMin" type="number" inputmode="numeric" value="1500" min="1500" step="100"></div></div>
    <label>올리는 방식</label><div class="chips" id="auMode"><button class="chip on" data-m="draft">📝 임시저장(확인 후 공개)</button><button class="chip" data-m="publish">🚀 바로 공개</button></div>
    <button class="btn primary block" id="auGo" type="button" style="margin-top:8px;font-size:17px;padding:12px">⚡ 자동으로 글·그림 만들고 올리기</button><div id="auOut"></div>`;
  box.querySelector('#auMode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; st.mode = b.dataset.m; box.querySelectorAll('#auMode .chip').forEach((x) => x.classList.toggle('on', x === b)); };
  box.querySelector('#auGo').onclick = async () => {
    const topic = getKw(), out = box.querySelector('#auOut'), btn = box.querySelector('#auGo');
    if (!topic) { toast('① 칸의 대표 키워드에 글 주제를 넣으세요'); return; }
    if (!cfg.bloggerId) { alert('⚙️ 기본 정보에 구글 블로그 ID를 먼저 넣어 주세요.'); return; }
    if (st.mode === 'publish' && !confirm(`"${topic}" 글을 AI로 만들어 구글 블로그에 바로 공개합니다. 진행할까요?`)) return;
    btn.disabled = true; const t0 = Date.now();
    const tick = setInterval(() => { out.innerHTML = `<div class="muted" style="margin-top:6px">⏳ 만드는 중… ${Math.round((Date.now() - t0) / 1000)}초 (글 → 그림 ${box.querySelector('#auN').value}장 → 구글 블로그)</div>`; }, 1000);
    try {
      const d = await baLongCall('autoInfoPost', { topic, blogId: cfg.bloggerId, blogTopic: cfg.infoTopic, contact: cfg.contact, photos: +box.querySelector('#auN').value, min: Math.max(1500, +box.querySelector('#auMin').value || 1500), mode: st.mode });
      clearInterval(tick);
      out.innerHTML = `<div class="okbox" style="font-weight:400;margin-top:8px">✅ ${d.publish ? '공개 발행' : '임시저장'} 완료 (${d.secs}초)<br><b>${esc(d.title)}</b><br>본문 ${d.chars.toLocaleString()}자(공백 빼고) · 그림 ${d.images}/${d.wanted}장${d.images < d.wanted ? ' (일부 그림 실패)' : ''}<br><a href="${esc(d.url)}" target="_blank" rel="noopener">${d.publish ? '글 보기' : 'Blogger에서 확인·공개하기'}</a></div>`;
    } catch (e) { clearInterval(tick); out.innerHTML = `<div class="errbox" style="margin-top:6px">${esc(e.message)}</div>`; }
    finally { btn.disabled = false; }
  };
}
