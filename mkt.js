/* ONE LIFE AI — 마케팅(기본틀)
 * 내가 한 일(완료 작업·기록)과 할 일(예정 작업·체크리스트)을 소재로, 채널별 초안을 만들고 반자동으로 올린다.
 * 채널: 네이버 블로그, 티스토리, 구글 블로그, 인스타그램, 유튜브 쇼츠.
 * 발행은 사장님이 직접 한다(자동 발행·매크로는 네이버 등에서 제재 대상). 앱은 초안·복사·사진 공유·글쓰기 화면 열기·발행 기록을 맡는다.
 * 네이버 초안은 '블로그_작성규칙.md' A형(시공후기) 구성을 따른다. 고객 이름·전화·동호수는 넣지 않는다.
 */
'use strict';

const CHANNELS = [
  { id: 'naver', name: '네이버 블로그', icon: '🟢' },
  { id: 'tistory', name: '티스토리', icon: '🟠' },
  { id: 'blogger', name: '구글 블로그', icon: '🔵' },
  { id: 'insta', name: '인스타그램', icon: '🟣' },
  { id: 'shorts', name: '유튜브 쇼츠', icon: '🔴' },
];
const CH_STATUS = ['준비', '올림', '건너뜀'];

async function mktCfg() {
  const c = await getSetting('mkt', {});
  return {
    phone: c.phone || '', region: c.region || '대구', naverId: c.naverId || '', tistory: c.tistory || '', blogger: c.blogger || '', insta: c.insta || '', youtube: c.youtube || '',
    naverTypes: c.naverTypes || '방충망', // 네이버 블로그 1개 = 주제 1개(작성규칙). 이 단어가 들어간 작업 종류만 네이버에 권장
  };
}

/* ───────── 소재 → 채널별 초안(틀) ───────── */
function hashtags(base, extra = []) {
  return [...new Set([...base, ...extra].map((t) => String(t || '').replace(/\s+/g, '')).filter((t) => t.length > 1))];
}
function areaParts(area) {
  const p = String(area || '').split(/\s+/).filter(Boolean);
  // '경산·구미'처럼 '시'를 빼고 쓴 도시 이름
  const city = p.find((x) => /^(대구|경산|구미|칠곡|영천|청도|성주|고령|김천|포항|경주|안동|대구시|경산시|구미시)$/.test(x)) || '';
  const gu = p.find((x) => x !== city && /[구군시]$/.test(x)) || '', dong = p.find((x) => /[동읍면]$/.test(x)) || '';
  // 단지명: 도시·구·동을 뺀 나머지(동·호수 숫자는 제외)
  const rest = p.filter((x) => x !== city && x !== gu && x !== dong && !/^\d+(동|호)?$/.test(x));
  return { city: city.replace(/시$/, ''), gu, dong, apt: rest.join(' ') };
}

function naverTitle(cfg, a, type, prod) {
  const kind = (String(prod).match(/[가-힣]*방충망/) || [])[0] || type.replace(/\s*(교체|수리|설치|시공)$/, '');
  const act = (type.match(/교체|수리|설치|시공/) || ['시공'])[0];
  return [a.city || cfg.region, a.gu, a.dong, kind, a.apt, act, '후기'].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function buildDrafts(src, cfg) {
  const j = src.job || {};
  const a = areaParts(j.area);
  const kw = src.keyword || [a.city || cfg.region, a.gu, a.dong, (j.type || '').replace(/교체|수리/, '').trim() || j.type].filter(Boolean).join(' ').trim();
  const type = j.type || src.topic || '작업';
  const prod = j.product || '';
  const problem = j.problem || '';
  const solution = j.solution || '';
  const date = (j.scheduledAt || j.doneAt || nowISO()).slice(0, 10);
  const cta = cfg.phone ? `📞 견적 문의 ${cfg.phone} (문자·카톡 가능)\n\n문자나 카톡으로 아래 5가지를 먼저 보내주시면\n현장 방문 전에 대략적인 견적을 바로 알려드립니다.\n\n1. 지역 (예: 경산 중산동 ○○아파트)\n2. 작업 종류 (예: 방충망 교체 / 수리)\n3. 창 크기 또는 개수 (모르시면 "거실 큰 창 2개"처럼만)\n4. 희망 날짜\n5. 현장 사진 1~3장 (창 전체가 보이게)` : '(설정에서 전화번호를 넣으면 문의 안내가 들어갑니다)';
  const tagsBase = hashtags([`${a.gu}${type.replace(/\s/g, '')}`, `${a.dong}${type.replace(/\s/g, '')}`, `${cfg.region}${type.replace(/\s/g, '')}`, type, a.gu, a.dong, a.apt]);
  const nb = src.counts || { before: 0, work: 0, after: 0 };

  if (src.kind === 'plan') {
    // 할 일(예정) 소재 → 짧은 알림형 콘텐츠
    const t = src.topic;
    return {
      keyword: kw,
      naver: { title: `${kw} 일정 안내`, body: `${t}\n\n(예정 일정 소개 글은 시공 후기 글로 바꿔 쓰는 것을 권장합니다)`, tags: tagsBase.slice(0, 10) },
      tistory: { title: t, body: t, tags: tagsBase.slice(0, 10) },
      blogger: { title: t, body: t, tags: tagsBase.slice(0, 10) },
      insta: { title: '', body: `이번 주 일정 📅\n${t}\n\n문의는 프로필 링크로 남겨 주세요.`, tags: tagsBase.slice(0, 15) },
      shorts: { title: `${t.slice(0, 30)} #shorts`, body: `장면 1 (2초) 자막: "${t.slice(0, 20)}"\n장면 2 (3초) 현장 사진\n장면 3 (2초) 자막: "문의는 프로필 링크"`, tags: ['shorts', ...tagsBase.slice(0, 5)] },
    };
  }

  // 한 일(완료 작업) → 시공후기
  const naverBody = [
    `안녕하세요. ${cfg.region} ${a.gu} ${type} 현장 후기입니다.`,
    `오늘은 ${[a.gu, a.dong, a.apt].filter(Boolean).join(' ')}에서 진행한 ${kw} 작업을 정리했습니다.`,
    '',
    `▶ 현장 소개`,
    `${[a.gu, a.dong, a.apt].filter(Boolean).join(' ') || '현장'}, ${date.slice(5).replace('-', '월 ')}일 작업입니다.`,
    '[사진 1]',
    '',
    `▶ 기존 문제`,
    problem || '(고객님이 불편하셨던 점, 현장에서 본 상태를 적어 주세요)',
    ...Array.from({ length: Math.max(1, nb.before) }, (_, i) => `[사진 ${2 + i}]`),
    '',
    `▶ 시공 과정`,
    solution || '(작업 순서와 신경 쓴 부분을 적어 주세요)',
    ...Array.from({ length: Math.max(1, nb.work) }, (_, i) => `[사진 ${2 + Math.max(1, nb.before) + i}]`),
    '',
    `▶ 사용한 제품과 이유`,
    prod ? `사용 제품: ${prod}\n(이 제품을 고른 이유를 한 줄 적어 주세요)` : '(사용한 제품·망 종류와 고른 이유)',
    '',
    `▶ 완료`,
    `작업 후 모습입니다.${j.duration ? ` 작업 시간은 ${j.duration} 걸렸습니다.` : ''}`,
    ...Array.from({ length: Math.max(1, nb.after) }, (_, i) => `[사진 ${2 + Math.max(1, nb.before) + Math.max(1, nb.work) + i}]`),
    '',
    `${kw} 고민 중이시면 현장 상태부터 편하게 물어보세요.`,
    '',
    cta,
  ].join('\n');

  const infoBody = [
    `${kw} 작업 사례를 정리했습니다.`,
    '',
    '## 현장 상황', problem || '(현장 상태)', '',
    '## 작업 내용', solution || '(작업 내용)', '',
    prod ? `## 사용한 제품\n${prod}\n` : '',
    '## 작업 정보', `- 지역: ${[a.gu, a.dong].filter(Boolean).join(' ')}`, `- 작업: ${type}`, j.duration ? `- 소요 시간: ${j.duration}` : '', '',
    '## 정리', `${type} 작업은 현장 상태를 먼저 확인하는 것이 중요합니다.`,
  ].filter((x) => x !== '').join('\n');

  return {
    keyword: kw,
    // 작성규칙 A형 제목: 대구 + 구 + 동 + 방충망 종류 + 단지명 + 작업 + 후기
    naver: { title: naverTitle(cfg, a, type, prod), body: naverBody, tags: tagsBase.slice(0, 10) },
    tistory: { title: `${kw} 작업 사례 | ${type} 과정과 사용 제품`, body: infoBody, tags: tagsBase.slice(0, 10), meta: `${kw} 실제 작업 사례. 현장 상태, 작업 과정, 사용 제품을 정리했습니다.` },
    blogger: { title: `${kw} — ${type} 작업 기록`, body: infoBody, tags: tagsBase.slice(0, 10), meta: `${kw} 작업 기록` },
    insta: {
      title: '',
      body: [`${[a.gu, a.dong].filter(Boolean).join(' ')} ${type} 완료 ✨`, problem ? `기존: ${problem.slice(0, 40)}` : '', solution ? `작업: ${solution.slice(0, 40)}` : '', '', '👉 넘겨서 전·후를 확인해 보세요', '문의는 프로필 링크 또는 DM'].filter((x) => x !== null).join('\n'),
      tags: hashtags(tagsBase, [`${cfg.region}인테리어`, '집수리', '홈케어', `${type}후기`]).slice(0, 20),
    },
    shorts: {
      title: `${[a.gu, a.dong].filter(Boolean).join(' ')} ${type} 전후 #shorts`.trim(),
      body: [
        `장면 1 (0~2초) 시공 전 사진 · 자막: "${problem ? problem.slice(0, 18) : '이 상태였는데요'}"`,
        '장면 2 (2~6초) 작업 과정 사진 2~3장 · 자막: "' + (solution ? solution.slice(0, 18) : '이렇게 작업했습니다') + '"',
        '장면 3 (6~10초) 시공 후 사진 · 자막: "완료!"',
        `장면 4 (10~12초) 자막: "${[a.gu, type].filter(Boolean).join(' ')} 문의는 설명란"`,
        '',
        `설명란: ${kw} 실제 작업 영상입니다.${cfg.phone ? ` 문의 ${cfg.phone}` : ''}`,
      ].join('\n'),
      tags: ['shorts', ...tagsBase.slice(0, 6)],
    },
  };
}

/* ───────── 마케팅 홈 ───────── */
async function viewMkt() {
  setTitle('마케팅', true);
  const [items, jobs, custs, photos, tasks, notes] = await Promise.all([DB.all('mkt'), DB.all('jobs'), DB.all('customers'), DB.all('photos'), DB.all('tasks'), DB.all('notes')]);
  const used = new Set(items.map((x) => x.srcKey));
  const pc = (id) => photos.filter((p) => p.jobId === id).length;
  const done = jobs.filter((j) => j.status === '완료' && !used.has('job:' + j.id)).sort((a, b) => (b.doneAt || b.updatedAt || '').localeCompare(a.doneAt || a.updatedAt || '')).slice(0, 10);
  const plan = [...jobs.filter((j) => j.status === '예약' && (j.scheduledAt || '') >= todayStr()).map((j) => ({ key: 'plan:job:' + j.id, text: `${fmtDate(j.scheduledAt)} ${j.area || ''} ${j.type || ''} 예정` })),
    ...tasks.filter((t) => !t.done && t.area === '사업' && t.date >= todayStr()).map((t) => ({ key: 'plan:task:' + t.id, text: `${fmtDate(t.date)} ${t.text}` }))].filter((x) => !used.has(x.key)).slice(0, 8);
  const idea = notes.filter((n) => (n.tag === '사업' || n.tag === '아이디어') && n.text && !used.has('note:' + n.id)).slice(0, 6);
  const sorted = items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const posted = (it) => CHANNELS.filter((c) => (it.ch[c.id] || {}).status === '올림').length;
  const weekAgo = nowISO(new Date(Date.now() - 7 * 864e5)).slice(0, 10);
  const weekPosts = items.reduce((a, it) => a + CHANNELS.filter((c) => ((it.ch[c.id] || {}).postedAt || '') >= weekAgo).length, 0);

  view().innerHTML = `
    <div class="card hero"><div class="row spread"><b>📣 이번 주 올린 글</b><a class="btn small" href="#/mktset" style="background:transparent;color:#fff;border-color:#fff8">채널 설정</a></div>
      <b style="font-size:26px">${weekPosts}건</b><div class="muted">콘텐츠 ${items.length}개 · 채널 5개(네이버·티스토리·구글 블로그·인스타·쇼츠)</div></div>
    <div class="card"><h2>🛠 내가 한 일 (완료 작업 → 시공 후기)</h2>
      ${done.map((j) => `<div class="item row spread"><div><div class="t">${esc(j.area || '지역 미입력')} · ${esc(j.type || '')}</div><div class="muted">📷 ${pc(j.id)}장${j.problem || j.solution ? ' · 블로그 자료 있음' : ' · 블로그 자료 없음'}</div></div><a class="btn small primary" href="#/mktnew?src=job:${j.id}">글 만들기</a></div>`).join('') || '<div class="muted">새로 쓸 완료 작업이 없습니다.</div>'}</div>
    <div class="card"><h2>📅 할 일 (예정 → 일정 소식)</h2>
      ${plan.map((p) => `<div class="item row spread"><span>${esc(p.text)}</span><a class="btn small" href="#/mktnew?src=${encodeURIComponent(p.key)}">만들기</a></div>`).join('') || '<div class="muted">예정 작업이나 사업 할 일이 없습니다.</div>'}</div>
    ${idea.length ? `<div class="card"><h2>💡 기록·아이디어</h2>${idea.map((n) => `<div class="item row spread"><span style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex:1">${esc(n.text)}</span><a class="btn small" href="#/mktnew?src=note:${n.id}">만들기</a></div>`).join('')}</div>` : ''}
    <div class="row spread"><h2 style="font-size:16px;margin:4px 0">📝 콘텐츠</h2><a class="btn small" href="#/mktnew?src=free">+ 직접 주제</a></div>
    ${sorted.map((it) => `<a class="item" href="#/mkt/${it.id}"><div class="row spread"><span class="t">${esc(it.title || it.keyword)}</span><span class="muted">${posted(it)}/5 올림</span></div>
      <div class="row wrap" style="gap:4px;margin-top:4px">${CHANNELS.map((c) => { const s = (it.ch[c.id] || {}).status || '준비'; return `<span class="badge" style="${s === '올림' ? 'color:var(--green)' : s === '건너뜀' ? 'color:var(--muted);text-decoration:line-through' : ''}">${c.icon} ${c.name.replace(' 블로그', '')}</span>`; }).join('')}</div></a>`).join('') || '<div class="empty">아직 콘텐츠가 없습니다. 위에서 소재를 골라 만드세요.</div>'}`;
}

/* ───────── 새 콘텐츠 ───────── */
async function viewMktNew() {
  const src = new URLSearchParams(location.hash.split('?')[1] || '').get('src') || 'free';
  const cfg = await mktCfg();
  const now = nowISO();
  let s = { kind: 'done', topic: '', keyword: '' }, photoIds = [], srcKey = src;
  if (src.startsWith('job:')) {
    const j = await DB.get('jobs', src.slice(4));
    const ps = (await DB.by('photos', 'jobId', j.id)).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const ord = (k) => ps.filter((p) => p.kind === k);
    const sorted = [...ord('시공 전'), ...ord('기타'), ...ps.filter((p) => !['시공 전', '시공 후', '기타'].includes(p.kind)), ...ord('시공 후')];
    photoIds = sorted.map((p) => p.id);
    s = { kind: 'done', job: j, topic: `${j.area || ''} ${j.type || ''}`.trim(), counts: { before: ord('시공 전').length, work: ord('기타').length, after: ord('시공 후').length } };
  } else if (src.startsWith('plan:')) {
    const [, t, id] = src.split(':');
    let text = '';
    if (t === 'job') { const j = await DB.get('jobs', id); text = `${fmtDate(j.scheduledAt)} ${j.area || ''} ${j.type || ''} 작업 예정`; s.job = j; }
    else { const tk = await DB.get('tasks', id); text = tk ? tk.text : ''; }
    s = { ...s, kind: 'plan', topic: text };
  } else if (src.startsWith('note:')) {
    const n = await DB.get('notes', src.slice(5));
    s = { kind: 'done', topic: (n.text || '').split('\n')[0].slice(0, 40), job: { problem: '', solution: n.text, type: '' } };
    if (n.photo) { const pid = uid(); await DB.put('photos', { id: pid, jobId: 'mkt:' + pid, kind: '기타', blob: n.photo, createdAt: now }); photoIds = [pid]; }
  } else {
    const t = prompt('어떤 주제로 쓸까요? (예: 겨울철 방충망 떼야 하나요)');
    if (!t) { location.replace('#/mkt'); return; }
    s = { kind: 'done', topic: t, keyword: t, job: { type: '', problem: '', solution: '' } };
    srcKey = 'free:' + uid();
  }
  const d = buildDrafts(s, cfg);
  const item = { id: uid(), createdAt: now, updatedAt: now, srcKey, kind: s.kind, title: s.topic || d.keyword, keyword: d.keyword, jobType: (s.job && s.job.type) || '', photoIds, ch: {} };
  CHANNELS.forEach((c) => { item.ch[c.id] = { ...d[c.id], status: '준비', url: '', postedAt: '' }; });
  // 네이버는 블로그 주제와 다른 업종이면 기본 '건너뜀'
  if (item.jobType && !cfg.naverTypes.split(',').some((w) => item.jobType.includes(w.trim()))) item.ch.naver.status = '건너뜀';
  await DB.put('mkt', item);
  location.replace(`#/mkt/${item.id}`);
}

/* ───────── 콘텐츠 편집·올리기 ───────── */
async function viewMktItem(id) {
  const it = await DB.get('mkt', id);
  if (!it) { setTitle('콘텐츠', true); view().innerHTML = '<div class="empty">콘텐츠를 찾을 수 없습니다.</div>'; return; }
  const cfg = await mktCfg();
  setTitle('콘텐츠', true);
  let cur = sessionStorage.getItem('mktCh') || 'naver';
  const photos = (await Promise.all((it.photoIds || []).map((pid) => DB.get('photos', pid)))).filter(Boolean);
  const urls = photos.map((p) => URL.createObjectURL(p.blob));

  const writeUrl = (c) => ({
    naver: 'https://blog.naver.com/GoBlogWrite.naver',
    tistory: cfg.tistory ? `https://${cfg.tistory.replace(/^https?:\/\//, '').replace(/\.tistory\.com.*$/, '')}.tistory.com/manage/newpost` : 'https://www.tistory.com/',
    blogger: 'https://www.blogger.com/',
    insta: 'https://www.instagram.com/',
    shorts: 'https://www.youtube.com/upload',
  }[c]);
  const RULES = {
    naver: '네이버 블로그 A형(시공후기) 규칙: 제목 맨 앞에 메인 키워드(지역+동+종류+단지명+작업+후기), 첫 3줄 안에 키워드 원문 1번, 본문 키워드 원문 2~5회(도배 금지), 구성 순서 현장 소개→기존 문제→시공 과정→사용 제품과 이유→완료→문의 안내, 소제목 4~7개, 공백 제외 1,000~1,700자, 실제 경험 문장 2개 이상, 모르는 숫자(가격·수명) 지어내기 금지, AI 냄새 나는 문어체 금지, 이모지는 소제목 앞 하나 정도.',
    tistory: '티스토리(구글 검색용): 제목에 키워드, 첫 문단에 결론, 소제목(H2) 4~6개, 정보형 문체, 표 1개 이상, 과장·지어낸 숫자 금지.',
    blogger: '구글 블로그(Blogger): 티스토리와 같은 정보형. 영문 검색어 1~2개를 자연스럽게 섞어도 됨. 과장 금지.',
    insta: '인스타그램 캡션: 첫 줄에 눈길 끄는 한 문장, 3~6줄, 줄바꿈 많이, 해시태그 15~20개(지역·작업·동네), 과장 금지.',
    shorts: '유튜브 쇼츠 15초 이내 대본: 장면별 시간·사진·자막(자막은 12자 이내), 첫 2초에 결과를 보여주는 훅, 제목 40자 이내 #shorts.',
  };

  function draw() {
    const c = CHANNELS.find((x) => x.id === cur), d = it.ch[cur] || {};
    const offTopic = cur === 'naver' && it.jobType && !cfg.naverTypes.split(',').some((w) => it.jobType.includes(w.trim()));
    view().innerHTML = `
      <div class="card"><label for="m_title">콘텐츠 이름</label><input id="m_title" value="${esc(it.title)}">
        <label for="m_kw">메인 키워드</label><input id="m_kw" value="${esc(it.keyword)}"></div>
      <div class="chips" id="chTabs">${CHANNELS.map((x) => `<button class="chip${x.id === cur ? ' on' : ''}" data-c="${x.id}" type="button">${x.icon} ${x.name}${(it.ch[x.id] || {}).status === '올림' ? ' ✅' : ''}</button>`).join('')}</div>
      ${offTopic ? `<div class="card warnbox"><div class="muted">네이버 블로그는 '${esc(cfg.naverTypes)}' 주제만 올리는 규칙입니다(블로그 1개 = 주제 1개). 이 작업(${esc(it.jobType)})은 다른 채널을 쓰세요.</div></div>` : ''}
      <div class="card">
        <div class="row spread"><h2 style="margin:0">${c.icon} ${c.name}</h2><select id="m_status" style="width:auto">${opts(CH_STATUS, d.status || '준비')}</select></div>
        ${cur !== 'insta' ? `<label for="m_t">제목</label><input id="m_t" value="${esc(d.title)}">` : ''}
        <label for="m_b">${cur === 'shorts' ? '대본·설명' : cur === 'insta' ? '캡션' : '본문'} <span class="muted" id="m_len"></span></label>
        <textarea id="m_b" rows="14" style="font-size:14px">${esc(d.body)}</textarea>
        ${d.meta !== undefined ? `<label for="m_meta">검색 설명(메타)</label><input id="m_meta" value="${esc(d.meta)}">` : ''}
        <label for="m_tags">태그·해시태그 (쉼표로 구분)</label><input id="m_tags" value="${esc((d.tags || []).join(', '))}">
        <div class="row wrap" style="margin-top:10px">
          ${cur !== 'insta' ? '<button class="btn small" data-cp="title" type="button">📋 제목</button>' : ''}
          <button class="btn small" data-cp="body" type="button">📋 ${cur === 'insta' ? '캡션+태그' : '본문'}</button>
          ${cur !== 'insta' ? '<button class="btn small" data-cp="tags" type="button">📋 태그</button>' : ''}
          <button class="btn small primary" id="m_open" type="button">↗ ${cur === 'insta' || cur === 'shorts' ? '앱 열기' : '글쓰기 열기'}</button>
          <button class="btn small" id="m_ai" type="button">✨ Claude로 다듬기</button>
        </div>
        <label for="m_url">올린 주소</label><input id="m_url" type="url" value="${esc(d.url)}" placeholder="발행 후 글 주소를 붙여넣으면 '올림'으로 바뀝니다">
      </div>
      <div class="card"><div class="row spread"><h2 style="margin:0">📷 사진 ${photos.length}장</h2>${photos.length ? '<button class="btn small primary" id="m_share" type="button">사진 보내기·저장</button>' : ''}</div>
        <div class="muted" style="margin:4px 0 8px">${cur === 'naver' ? '본문의 [사진 n] 자리에 이 순서대로 넣으세요.' : cur === 'insta' ? '공유에서 인스타그램을 고르면 여러 장을 한 번에 올릴 수 있습니다.' : cur === 'shorts' ? '유튜브 앱 Shorts 만들기에서 이 사진들로 영상을 만드세요.' : '본문에 순서대로 넣으세요.'}</div>
        <div class="photos">${photos.map((p, i) => `<div class="photo"><img src="${urls[i]}" alt="사진 ${i + 1}"><span>${i + 1} ${esc(p.kind || '')}</span></div>`).join('') || '<div class="muted" style="grid-column:1/-1">사진이 없습니다.</div>'}</div></div>
      <div class="row"><button class="btn primary block" id="m_save" type="button">💾 저장</button><button class="btn block" id="m_redo" type="button">↺ 이 채널 다시 만들기</button></div>
      <button class="btn danger block" id="m_del" type="button" style="margin-top:8px">콘텐츠 삭제</button>`;
    const len = () => { const t = $('#m_b').value.replace(/\s/g, ''); $('#m_len').textContent = `(공백 제외 ${t.length}자)`; };
    $('#m_b').oninput = len; len();
    $('#chTabs').onclick = async (e) => { const b = e.target.closest('[data-c]'); if (!b) return; await keep(); cur = b.dataset.c; sessionStorage.setItem('mktCh', cur); draw(); };
    $('#m_url').oninput = (e) => { if (e.target.value.trim()) $('#m_status').value = '올림'; };
    view().querySelectorAll('[data-cp]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.cp;
        const tags = $('#m_tags').value.split(',').map((x) => x.trim()).filter(Boolean);
        if (k === 'title') copyText($('#m_t').value);
        else if (k === 'tags') copyText(cur === 'naver' || cur === 'tistory' ? tags.join(',') : tags.map((x) => '#' + x.replace(/^#/, '')).join(' '));
        else copyText(cur === 'insta' ? `${$('#m_b').value}\n\n${tags.map((x) => '#' + x.replace(/^#/, '')).join(' ')}` : $('#m_b').value);
      };
    });
    $('#m_open').onclick = async () => {
      await keep();
      if (cur === 'insta') { const tags = $('#m_tags').value.split(',').map((x) => '#' + x.trim().replace(/^#/, '')).filter((x) => x.length > 1); try { await navigator.clipboard.writeText(`${$('#m_b').value}\n\n${tags.join(' ')}`); toast('캡션을 복사했습니다. 사진 보내기로 인스타를 고르세요'); } catch { /* 무시 */ } }
      else if (cur !== 'shorts') { try { await navigator.clipboard.writeText($('#m_t').value); toast('제목을 복사했습니다. 붙여넣은 뒤 본문 복사로 돌아오세요'); } catch { /* 무시 */ } }
      window.open(writeUrl(cur), '_blank', 'noopener');
    };
    $('#m_ai').onclick = async () => {
      await keep();
      const p = `아래 ${c.name} 초안을 규칙에 맞게 다듬어 주세요. 사실(지역·제품·작업 내용)은 바꾸지 말고, 모르는 숫자는 지어내지 말고, [사진 n] 표시는 그대로 두세요. 고객 이름·전화번호·동호수는 넣지 마세요.\n\n규칙: ${RULES[cur]}\n메인 키워드: ${$('#m_kw').value}\n\n제목: ${$('#m_t') ? $('#m_t').value : ''}\n\n${$('#m_b').value}\n\n태그: ${$('#m_tags').value}`;
      try { await navigator.clipboard.writeText(p); } catch { /* 무시 */ }
      toast('요청문을 복사했습니다. 다듬은 글을 받으면 본문 칸에 붙여넣으세요');
      window.open('https://claude.ai/new?q=' + encodeURIComponent(p.slice(0, 6000)), '_blank', 'noopener');
    };
    if ($('#m_share')) $('#m_share').onclick = async () => {
      const files = photos.map((p, i) => new File([p.blob], `${String(i + 1).padStart(2, '0')}-${it.keyword.replace(/\s/g, '')}.jpg`, { type: 'image/jpeg' }));
      if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files }); } catch { /* 취소 */ } }
      else files.forEach((f) => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); });
    };
    $('#m_save').onclick = async () => { await keep(); toast('저장했습니다'); };
    $('#m_redo').onclick = async () => {
      if (!confirm(`${c.name} 초안을 지금 내용 대신 다시 만들까요?`)) return;
      const src = { kind: it.kind, topic: it.title, keyword: $('#m_kw').value, job: it.srcKey.startsWith('job:') ? await DB.get('jobs', it.srcKey.slice(4)) : { type: it.jobType } };
      if (src.job && it.srcKey.startsWith('job:')) { const ps = photos; src.counts = { before: ps.filter((p) => p.kind === '시공 전').length, work: ps.filter((p) => p.kind === '기타').length, after: ps.filter((p) => p.kind === '시공 후').length }; }
      const d2 = buildDrafts(src, cfg);
      it.ch[cur] = { ...it.ch[cur], ...d2[cur] };
      await DB.put('mkt', it); draw();
    };
    $('#m_del').onclick = async () => { if (confirm('이 콘텐츠를 지울까요? (사진은 작업에 남습니다)')) { await DB.del('mkt', it.id); location.replace('#/mkt'); } };
  }
  async function keep() {
    const d = it.ch[cur] || {};
    const url = $('#m_url').value.trim();
    const st = $('#m_status').value;
    it.ch[cur] = { ...d, title: $('#m_t') ? $('#m_t').value : d.title, body: $('#m_b').value, meta: $('#m_meta') ? $('#m_meta').value : d.meta, tags: $('#m_tags').value.split(',').map((x) => x.trim()).filter(Boolean), url, status: st, postedAt: st === '올림' ? (d.postedAt || nowISO()) : '' };
    it.title = $('#m_title').value.trim(); it.keyword = $('#m_kw').value.trim(); it.updatedAt = nowISO();
    await DB.put('mkt', it);
    // 네이버에 올린 시공후기는 작업의 블로그 주소에도 기록(작업사례 시트로 이어짐)
    if (cur === 'naver' && url && it.srcKey.startsWith('job:')) { const j = await DB.get('jobs', it.srcKey.slice(4)); if (j && j.blogUrl !== url) await DB.put('jobs', { ...j, blogUrl: url, updatedAt: nowISO() }); }
  }
  draw();
}

/* ───────── 채널 설정 ───────── */
async function viewMktSet() {
  setTitle('채널 설정', true);
  const c = await mktCfg();
  const f = (id, label, v, ph) => `<label for="${id}">${label}</label><input id="${id}" value="${esc(v)}" placeholder="${esc(ph)}">`;
  view().innerHTML = `<form class="card" id="ms" autocomplete="off">
    ${f('c_phone', '문의 전화번호(네이버 글 끝 문의 안내)', c.phone, '010-0000-0000')}
    ${f('c_region', '기본 지역', c.region, '대구')}
    ${f('c_naverTypes', '네이버 블로그에 올릴 작업 종류(쉼표, 포함 단어)', c.naverTypes, '방충망')}
    <div class="muted">블로그 1개 = 주제 1개 규칙. 다른 업종은 네이버 탭에서 '건너뜀'으로 시작합니다.</div>
    ${f('c_naverId', '네이버 블로그 아이디', c.naverId, 'blog.naver.com/아이디')}
    ${f('c_tistory', '티스토리 주소', c.tistory, 'myblog.tistory.com')}
    ${f('c_blogger', '구글 블로그 주소', c.blogger, 'myblog.blogspot.com')}
    ${f('c_insta', '인스타그램 계정', c.insta, '@계정')}
    ${f('c_youtube', '유튜브 채널', c.youtube, '@채널')}
    <button class="btn primary block" type="submit" style="margin-top:12px">💾 저장</button></form>
    <div class="card"><div class="muted">자동 발행은 하지 않습니다. 네이버 등은 프로그램이 대신 글을 올리면 제재할 수 있어서, 앱은 초안·복사·사진 공유·글쓰기 화면 열기까지 하고 발행은 직접 누릅니다.</div></div>`;
  $('#ms').onsubmit = async (e) => {
    e.preventDefault();
    const g = (id) => $(id).value.trim();
    await setSetting('mkt', { phone: g('#c_phone'), region: g('#c_region') || '대구', naverTypes: g('#c_naverTypes') || '방충망', naverId: g('#c_naverId'), tistory: g('#c_tistory'), blogger: g('#c_blogger'), insta: g('#c_insta'), youtube: g('#c_youtube') });
    toast('저장했습니다'); history.back();
  };
}
