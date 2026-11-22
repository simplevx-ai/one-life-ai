/* ONE LIFE AI — AI 비서
 * 말이나 글로 한 명령을 이해해 업무 분야(사업·관리사무소·투자·마라톤·프리다이빙·일정)와 할 일(조회·저장·계획·외부 정보·사진)로 나눈다.
 * 앱 안의 데이터로 되는 일은 바로 처리하고, 새 글을 써야 하는 일(계획·뉴스·사진 판독)은 Claude에게 넘길 요청문을 만든다.
 * 이해는 규칙(단어 사전) 방식이며 외부 AI를 부르지 않는다. 데이터는 폰 밖으로 나가지 않는다.
 */
'use strict';

const AI_AREAS = ['사업', '관리사무소', '투자', '마라톤', '프리다이빙', '일정·할 일', '개인'];
const AREA_WORDS = {
  '사업': ['설치', '시공', '매출', '고객', '견적', '방충망', '작업', '문의', '입금', '미수', '블로그', '현장', '예약'],
  '관리사무소': ['관리사무소', '민원', '점검', '시설', '승강기', '엘리베이터', '소방', '누수', '공지', '인수인계', '일지', '세대', '주차장', '기계실', '전기실', '배수펌프'],
  '투자': ['주식', '코인', '시장', '반도체', '종목', '나스닥', '코스피', '코스닥', '투자', '증시', '환율', '금리', '엔비디아', 'ETF'],
  '마라톤': ['마라톤', '러닝', '달리기', '달렸', '뛰었', '조깅', '훈련', '페이스', '인터벌', 'LSD', '하프', '풀코스', '회복', '킬로', 'km'],
  '프리다이빙': ['다이빙', '프리다이빙', '수심', '숨참기', '스태틱', '다이나믹', '덕다이빙', '이퀄', '핀', '버디'],
  '일정·할 일': ['할 일', '할일', '일정', '스케줄', '체크리스트', '빠진', '놓친', '해야'],
};
const INTENTS = [
  ['photo', /사진|이미지|캡처|이 내용/],
  ['news', /뉴스|소식|동향|시황|시장\s*(상황|정리)/],
  ['plan', /계획|세워|짜\s*줘|짜줘|추천|전략|루틴|프로그램/],
  ['check', /빠진|놓친|누락|확인해|점검해\s*줘|체크해/],
  ['save', /저장|기록해|남겨|적어\s*둬|메모해|등록해/],
  ['summary', /정리|요약|알려|보여|얼마|몇\s*건|현황|브리핑/],
];
const INTENT_LABEL = { summary: '정리·조회', save: '기록 저장', plan: '계획 세우기', news: '외부 정보 정리', photo: '사진 내용 정리', check: '빠진 것 확인', chat: '메모' };

function classifyCommand(text, hasPhoto) {
  const t = String(text || '');
  const scores = {};
  for (const [a, words] of Object.entries(AREA_WORDS)) scores[a] = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  // 매출·설치는 사업 쪽 가중치
  if (/매출|설치/.test(t)) scores['사업'] += 1;
  let area = '개인', best = 0;
  for (const [a, n] of Object.entries(scores)) if (n > best) { best = n; area = a; }
  let intent = 'chat';
  for (const [k, re] of INTENTS) if (re.test(t)) { intent = k; break; }
  if (hasPhoto && (intent === 'chat' || intent === 'summary')) intent = 'photo';
  // 날짜 범위
  let range = 'today';
  if (/다음\s*주/.test(t)) range = 'nextweek';
  else if (/이번\s*주|금주/.test(t)) range = 'thisweek';
  else if (/지난\s*달|저번\s*달/.test(t)) range = 'lastmonth';
  else if (/이번\s*달|이달|월\s*매출/.test(t)) range = 'thismonth';
  else if (/내일/.test(t)) range = 'tomorrow';
  const m = t.match(/(\d{1,2})\s*월/);
  const month = m ? +m[1] : null;
  return { area, intent, range, month, scores };
}

/* ───────── 앱 안에서 처리하는 명령 ───────── */
function weekRange(offsetWeeks) {
  const d = new Date(); const day = (d.getDay() + 6) % 7; // 월요일 시작
  const s = new Date(d); s.setDate(d.getDate() - day + offsetWeeks * 7);
  const e = new Date(s); e.setDate(s.getDate() + 6);
  const f = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return [f(s), f(e)];
}

async function aiTodaySummary() {
  const today = todayStr();
  const [jobs, custs, tasks, recs, scheds] = await Promise.all([DB.all('jobs'), DB.all('customers'), DB.all('tasks'), DB.all('office'), DB.all('schedules')]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const tj = jobs.filter((j) => j.status === '예약' && (j.scheduledAt || '').slice(0, 10) === today).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const late = jobs.filter((j) => j.status === '예약' && j.scheduledAt && j.scheduledAt.slice(0, 10) < today);
  const waiting = jobs.filter((j) => j.status === '접수' || j.status === '견적');
  const tt = tasks.filter((x) => !x.done && x.date <= today);
  const od = recs.filter((r) => !r.done && r.due && r.due <= today);
  const sd = scheds.map((s) => ({ ...s, next: schedNext(s) })).filter((s) => s.next <= today);
  const L = [`[오늘 할 일] ${fmtDate(today)}`];
  L.push('', `■ 사업 방문·작업 ${tj.length}건`, ...tj.map((j) => `- ${j.scheduledAt.slice(11, 16) || '시간 미정'} ${nameOf(cmap[j.customerId])} · ${[j.area, j.type].filter(Boolean).join(' ')}`));
  if (late.length) L.push(`- 완료 처리 안 한 지난 예약 ${late.length}건`);
  if (waiting.length) L.push(`- 답하거나 견적 낼 문의 ${waiting.length}건`);
  L.push('', `■ 체크리스트 ${tt.length}개`, ...tt.map((x) => `- [${x.area}] ${x.text}${x.date < today ? ' (밀림)' : ''}`));
  L.push('', `■ 관리사무소 기한 업무 ${od.length}건`, ...od.map((r) => `- ${r.loc ? r.loc + ' ' : ''}${r.action}${r.due < today ? ' (기한 지남)' : ''}`));
  if (sd.length) L.push('', '■ 정기점검', ...sd.map((s) => `- ${s.name}${s.next < today ? ' (지남)' : ''}`));
  return L.join('\n');
}

async function aiSalesSummary(cls, onlyInstall) {
  const now = new Date();
  let y = now.getFullYear(), mo = now.getMonth() + 1;
  if (cls.range === 'lastmonth') { mo -= 1; if (!mo) { mo = 12; y -= 1; } }
  if (cls.month) { mo = cls.month; if (mo > now.getMonth() + 1) y -= 1; }
  const key = `${y}-${pad(mo)}`;
  const [jobs, pays, custs] = await Promise.all([DB.all('jobs'), DB.all('payments'), DB.all('customers')]);
  const jmap = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const ps = pays.filter((p) => (p.date || '').startsWith(key));
  const total = ps.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const byType = {};
  ps.forEach((p) => { const t = (jmap[p.jobId] || {}).type || '기타'; byType[t] = (byType[t] || 0) + (Number(p.amount) || 0); });
  const doneJobs = jobs.filter((j) => j.status === '완료' && ((j.scheduledAt || j.doneAt || '').slice(0, 7) === key));
  const unpaid = jobs.filter((j) => j.status === '완료').map((j) => ({ j, left: (Number(j.quote) || 0) - paidOf(j.id, pays) })).filter((x) => x.left > 0);
  return [
    `[${y}년 ${mo}월 ${onlyInstall ? '설치 ' : ''}매출 정리] (입금 기준)`,
    `- 입금 합계: ${won(total)} (${ps.length}건)`,
    `- 완료한 작업: ${doneJobs.length}건`,
    '', '■ 작업 종류별', ...(Object.keys(byType).length ? Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, v]) => `- ${t}: ${won(v)}`) : ['- 입금 기록 없음']),
    '', `■ 미수금 ${unpaid.length}건 / ${won(unpaid.reduce((a, x) => a + x.left, 0))}`,
    ...unpaid.slice(0, 10).map(({ j, left }) => `- ${nameOf(cmap[j.customerId])} · ${j.type || ''}: ${won(left)}`),
  ].join('\n');
}

async function aiCheckMissing(cls) {
  const [s, e] = cls.range === 'thisweek' ? weekRange(0) : weekRange(1);
  const today = todayStr();
  const [jobs, custs, tasks, recs, scheds, pays] = await Promise.all([DB.all('jobs'), DB.all('customers'), DB.all('tasks'), DB.all('office'), DB.all('schedules'), DB.all('payments')]);
  const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
  const inR = (d) => d && d >= s && d <= e;
  const L = [`[${cls.range === 'thisweek' ? '이번 주' : '다음 주'} 할 일 점검] ${s.slice(5)} ~ ${e.slice(5)}`];
  const wj = jobs.filter((j) => j.status === '예약' && inR((j.scheduledAt || '').slice(0, 10)));
  const wt = tasks.filter((x) => !x.done && inR(x.date));
  const wo = recs.filter((r) => !r.done && inR(r.due));
  const ws = scheds.map((x) => ({ ...x, next: schedNext(x) })).filter((x) => inR(x.next));
  L.push('', `■ 잡혀 있는 일 ${wj.length + wt.length + wo.length + ws.length}건`,
    ...wj.map((j) => `- ${fmtDate(j.scheduledAt)} 작업: ${nameOf(cmap[j.customerId])} ${j.type || ''}`),
    ...wt.map((x) => `- ${fmtDate(x.date)} 할 일: ${x.text}`),
    ...wo.map((r) => `- ${fmtDate(r.due)} 관리사무소: ${r.loc ? r.loc + ' ' : ''}${r.action}`),
    ...ws.map((x) => `- ${fmtDate(x.next)} 정기점검: ${x.name}`));
  // 빠진 것 후보
  const miss = [];
  jobs.filter((j) => j.status === '예약' && !j.scheduledAt).forEach((j) => miss.push(`예약 상태인데 날짜가 없는 작업: ${nameOf(cmap[j.customerId])} ${j.type || ''}`));
  jobs.filter((j) => j.status === '견적' && !j.quote).forEach((j) => miss.push(`견적 상태인데 금액이 없는 작업: ${nameOf(cmap[j.customerId])}`));
  jobs.filter((j) => j.status === '접수' && j.createdAt && (Date.now() - new Date(j.createdAt).getTime()) / 864e5 >= 2).forEach((j) => miss.push(`2일 넘게 답하지 않은 문의: ${nameOf(cmap[j.customerId])} ${j.area || ''}`));
  jobs.filter((j) => j.status === '완료' && (Number(j.quote) || 0) - paidOf(j.id, pays) > 0).forEach((j) => miss.push(`입금이 덜 된 완료 작업: ${nameOf(cmap[j.customerId])}`));
  recs.filter((r) => !r.done && !r.due).forEach((r) => miss.push(`기한이 없는 관리사무소 미처리: ${r.loc || ''} ${r.action}`));
  recs.filter((r) => !r.done && r.due && r.due < today).forEach((r) => miss.push(`기한 지난 관리사무소 업무: ${r.loc || ''} ${r.action}`));
  scheds.map((x) => ({ ...x, next: schedNext(x) })).filter((x) => x.next < s).forEach((x) => miss.push(`이미 지난 정기점검: ${x.name}`));
  tasks.filter((x) => !x.done && x.date < today).forEach((x) => miss.push(`밀린 할 일: ${x.text}`));
  L.push('', `■ 빠졌거나 놓친 것 ${miss.length}건`, ...(miss.length ? miss.map((x) => `- ${x}`) : ['- 없음']));
  return L.join('\n');
}

/* 다이빙 기록: 수심·시간·종목·장소를 뽑아 프리다이빙 기록으로 저장 */
function parseDive(t) {
  const depth = (t.match(/(\d+(?:\.\d+)?)\s*(?:m|미터|메타)/i) || [])[1] || '';
  const min = (t.match(/(\d+)\s*분/) || [])[1];
  const sec = (t.match(/(\d+)\s*초/) || [])[1];
  const disc = (t.match(/CWT|CNF|FIM|CWTB|STA|DYN|DNF|스태틱|다이나믹|덕다이빙|프리이머전|컨스턴트|노핀|바이핀/i) || [''])[0];
  const place = (t.match(/K26|딥스테이션|[가-힣A-Za-z0-9]+\s?(?:풀|바다|해변|리조트|다이빙\s*센터|수영장|해수욕장)/i) || [''])[0];
  const buddy = (t.match(/([가-힣]{2,4})\s*(?:버디|님과|와\s*같이|하고)/) || [])[1] || '';
  return { depth, time: min || sec ? `${min ? min + '분' : ''}${sec ? ' ' + sec + '초' : ''}`.trim() : '', disc, place, buddy };
}

/* 마라톤 기록: 거리·시간·페이스 */
function parseRun(t) {
  const km = (t.match(/(\d+(?:\.\d+)?)\s*(?:km|킬로)/i) || [])[1] || '';
  const tm = t.match(/(\d+)\s*시간\s*(\d+)?\s*분?|(\d+)\s*분/);
  const pace = (t.match(/(\d+)\s*분\s*(\d+)\s*초\s*페이스|페이스\s*(\d+:\d+)/) || []);
  return { km, time: tm ? tm[0].replace(/\s+/g, '') : '', pace: pace[3] || (pace[1] ? `${pace[1]}:${pad(pace[2])}` : '') };
}

/* ───────── Claude에게 넘길 요청문 ───────── */
async function claudePrompt(text, cls) {
  const today = todayStr();
  const notes = await DB.all('notes');
  const recent = (tag) => notes.filter((n) => n.tag === tag).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 8)
    .map((n) => `- ${(n.createdAt || '').slice(0, 10)} ${(n.text || '').replace(/\n/g, ' ')}`).join('\n');
  const base = `오늘은 ${today}입니다. 한국어로, 결론 먼저, 짧게 답해 주세요.\n\n요청: ${text}`;
  if (cls.intent === 'news' || cls.area === '투자') {
    return `${base}\n\n조건: 최신 뉴스를 검색해 출처(매체·날짜)를 붙여 주세요. 공부용 정리이며 매수·매도 추천이나 목표가 제시는 하지 마세요. 용어는 쉽게 풀어 주세요.`;
  }
  if (cls.area === '마라톤') {
    const r = recent('마라톤');
    return `${base}\n\n참고(내 최근 러닝 기록):\n${r || '- 기록 없음'}\n\n조건: 요일별 표로, 강도(쉬움/보통/강함)와 거리·페이스를 적고, 부상 예방과 회복일을 넣어 주세요.`;
  }
  if (cls.area === '프리다이빙') {
    const r = recent('프리다이빙');
    return `${base}\n\n참고(내 최근 다이빙 기록):\n${r || '- 기록 없음'}\n\n조건: 안전(버디 필수, 무리한 수심 금지)을 먼저 적어 주세요.`;
  }
  if (cls.intent === 'photo') {
    return `${base}\n\n첨부한 사진의 글자와 내용을 빠짐없이 읽고, 업무 분류(사업/관리사무소/개인)·핵심 내용·해야 할 일·날짜를 나눠 정리해 주세요.`;
  }
  return base;
}

/* ───────── AI 비서 화면 ───────── */
const AI_LOG_KEY = 'aiLog';
function aiLog() { try { return JSON.parse(localStorage.getItem(AI_LOG_KEY) || '[]'); } catch { return []; } }
function aiLogSave(l) { try { localStorage.setItem(AI_LOG_KEY, JSON.stringify(l.slice(-30))); } catch { /* 무시 */ } }

async function runCommand(text, photo) {
  const cls = classifyCommand(text, !!photo);
  const out = { q: text, at: nowISO(), area: cls.area, intent: cls.intent, body: '', actions: [] };
  const t = text;

  if (cls.intent === 'save' || (cls.intent === 'chat' && (cls.area === '프리다이빙' || cls.area === '마라톤') && /\d/.test(t))) {
    // 기록 저장: 분야별로 내용을 뽑아 빠른 기록에 저장
    let extra = '';
    if (cls.area === '프리다이빙') { const d = parseDive(t); extra = [d.disc && `종목 ${d.disc}`, d.depth && `수심 ${d.depth}m`, d.time && `시간 ${d.time}`, d.place && `장소 ${d.place}`, d.buddy && `버디 ${d.buddy}`].filter(Boolean).join(' · '); }
    if (cls.area === '마라톤') { const r = parseRun(t); extra = [r.km && `거리 ${r.km}km`, r.time && `시간 ${r.time}`, r.pace && `페이스 ${r.pace}/km`].filter(Boolean).join(' · '); }
    const tag = NOTE_TAGS.includes(cls.area) ? cls.area : '개인';
    const clean = t.replace(/(저장해\s*줘?|저장|기록해\s*줘?|남겨\s*줘?|메모해\s*줘?|등록해\s*줘?)[.!]?\s*$/, '').trim();
    const note = { id: uid(), createdAt: nowISO(), tag, text: clean + (extra ? `\n[${extra}]` : ''), photo: photo || null, via: 'ai', done: false, data: extra };
    await DB.put('notes', note);
    out.body = `'${tag}' 기록으로 저장했습니다.${extra ? `\n정리: ${extra}` : ''}${cls.area === '프리다이빙' && !extra ? '\n수심·시간·장소를 말하면 같이 정리됩니다(예: 오늘 K26에서 FIM 25m, 1분 10초).' : ''}`;
    out.actions.push({ label: '기록 보기', href: `#/note/${note.id}` });
    return out;
  }
  if (cls.intent === 'check') {
    out.body = await aiCheckMissing(cls);
    out.actions.push({ label: '복사', copy: true });
    return out;
  }
  if ((cls.intent === 'summary') && cls.area === '사업' && /매출|입금|미수/.test(t)) {
    out.body = await aiSalesSummary(cls, /설치/.test(t));
    out.actions.push({ label: '매출 화면', href: '#/sales' }, { label: '복사', copy: true });
    return out;
  }
  if ((cls.intent === 'summary' || cls.intent === 'chat') && (cls.area === '일정·할 일' || /할\s*일|오늘/.test(t)) && !/뉴스/.test(t)) {
    out.body = await aiTodaySummary();
    out.actions.push({ label: '복사', copy: true });
    return out;
  }
  if (cls.intent === 'summary' && cls.area === '관리사무소') {
    out.body = '관리사무소 현황은 업무 일지·인수인계 화면에서 자동으로 정리됩니다.';
    out.actions.push({ label: '업무 일지', href: '#/odiary' }, { label: '인수인계', href: '#/handover' });
    return out;
  }
  if (cls.area === '관리사무소' && cls.intent === 'chat') {
    out.body = '시설 점검·이상 내용으로 보여서 관리사무소 기록으로 정리해 열겠습니다.';
    sessionStorage.setItem('officeDraft', t);
    out.actions.push({ label: '관리사무소 기록으로', href: '#/orec/new?draft=1' });
    return out;
  }
  // 새 글이 필요한 일(계획·뉴스·사진·기타) → Claude에게 넘김
  out.needClaude = true;
  out.prompt = await claudePrompt(t, cls);
  out.body = {
    plan: '계획은 새로 써야 하는 일이라 Claude에게 넘깁니다. 내 최근 기록을 붙여 요청문을 만들었습니다.',
    news: '최신 뉴스는 인터넷 검색이 필요해 Claude에게 넘깁니다. (평일 아침 텔레그램 브리핑에도 시장 요약이 옵니다)',
    photo: '사진 판독은 Claude에게 넘깁니다. Claude 앱이 열리면 이 사진을 첨부해 주세요.',
  }[cls.intent] || '앱 안에서 바로 처리할 수 없는 요청이라 Claude에게 넘길 요청문을 만들었습니다.';
  if (photo) {
    await DB.put('notes', { id: uid(), createdAt: nowISO(), tag: NOTE_TAGS.includes(cls.area) ? cls.area : '개인', text: t, photo, via: 'ai', done: false });
    out.body += '\n사진은 빠른 기록에도 저장했습니다.';
  }
  out.actions.push({ label: '🤖 Claude에게 보내기', claude: true });
  return out;
}

async function viewAI() {
  setTitle('AI 비서', true);
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const log = aiLog();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let photo = null;
  const EX = ['오늘 할 일 정리해 줘', '이번 달 설치 매출 정리해 줘', '이번 주 마라톤 훈련 계획 세워줘', '오늘 다이빙 기록 저장해', '이 사진에 있는 내용을 정리해 줘', '다음 주에 해야 할 일 중 빠진 게 있는지 확인해 줘', '오늘 주식시장 주요 AI 반도체 뉴스 정리해 줘'];

  view().innerHTML = `
    <div class="card" style="border-color:var(--blue)">
      <div class="row spread"><h2 style="margin:0">🎙 음성 기록</h2><a class="btn small" href="#/voice">목록 ›</a></div>
      <div class="muted" style="margin:4px 0 8px">녹음하거나 녹음 파일을 넣으면 글로 바꾸고, 요약과 할 일까지 뽑아 줍니다. (폰 안에서 처리)</div>
      <div class="grid2"><a class="btn primary" href="#/voice/new?m=rec">● 녹음 시작</a><a class="btn" href="#/voice/new?m=file">📁 녹음 파일 넣기</a></div>
    </div>
    <div id="aiLog"></div>
    <div class="card" style="position:sticky;bottom:calc(72px + env(safe-area-inset-bottom));z-index:4">
      <div id="aiPhoto"></div>
      <textarea id="aiIn" rows="2" placeholder="예: 오늘 할 일 정리해 줘" style="min-height:56px"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn" id="aiMic" type="button" aria-label="말로 입력">🎤</button>
        <label class="btn" style="margin:0;color:var(--ink)" aria-label="사진">📷<input id="aiCam" type="file" accept="image/*" hidden></label>
        <button class="btn primary" id="aiGo" type="button" style="flex:1">보내기</button>
      </div>
      <div id="aiState" class="muted"></div>
    </div>`;

  function draw() {
    const l = aiLog();
    $('#aiLog').innerHTML = l.length ? l.map((m, i) => `
      <div class="row" style="justify-content:flex-end;margin:10px 0 4px"><div style="background:var(--blue);color:#fff;border-radius:14px 14px 4px 14px;padding:8px 12px;max-width:85%">${esc(m.q)}</div></div>
      <div class="card" style="margin-bottom:6px">
        <div class="row wrap" style="gap:4px;margin-bottom:6px"><span class="badge">${esc(m.area)}</span><span class="badge">${esc(INTENT_LABEL[m.intent] || m.intent)}</span>${m.needClaude ? '<span class="badge" style="color:#7A4CD1">Claude 필요</span>' : '<span class="badge s-완료">앱에서 처리</span>'}</div>
        <div style="white-space:pre-wrap;font-size:15px">${esc(m.body)}</div>
        ${m.actions && m.actions.length ? `<div class="row wrap" style="margin-top:8px">${m.actions.map((a, k) => a.href ? `<a class="btn small" href="${a.href}">${esc(a.label)}</a>` : `<button class="btn small${a.claude ? ' primary' : ''}" data-i="${i}" data-k="${k}" type="button">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`).join('') : `<div class="card"><h2>🤖 무엇을 도와드릴까요?</h2><div class="muted" style="margin-bottom:6px">명령으로 물어보기</div><div class="muted">말하거나 적으면 업무별로 나눠서 처리합니다. 앱 안의 기록으로 되는 일은 바로 하고, 새 글이 필요한 일은 Claude에게 넘깁니다.</div>
        <div class="chips" style="flex-wrap:wrap;margin-top:10px">${EX.map((e) => `<button class="chip" data-ex="${esc(e)}" type="button">${esc(e)}</button>`).join('')}</div></div>`;
    if (l.length) $('#aiLog').insertAdjacentHTML('afterbegin', '<div class="row" style="justify-content:flex-end"><button class="btn small" id="aiClear" type="button">대화 지우기</button></div>');
    $('#aiClear') && ($('#aiClear').onclick = () => { aiLogSave([]); draw(); });
    if (l.length) setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 60); // 대화가 있을 때만 최근 대화가 보이게
  }
  $('#aiLog').onclick = async (e) => {
    const ex = e.target.closest('[data-ex]');
    if (ex) { $('#aiIn').value = ex.dataset.ex; if (/사진/.test(ex.dataset.ex)) $('#aiCam').click(); return; }
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const m = aiLog()[+b.dataset.i]; const a = m.actions[+b.dataset.k];
    if (a.copy) return copyText(m.body);
    if (a.claude) {
      try { await navigator.clipboard.writeText(m.prompt); } catch { /* 무시 */ }
      toast('요청문을 복사했습니다. Claude가 열리면 붙여넣기(이미 들어가 있으면 그대로 보내기)');
      window.open('https://claude.ai/new?q=' + encodeURIComponent(m.prompt), '_blank', 'noopener');
    }
  };
  const drawPhoto = () => {
    $('#aiPhoto').innerHTML = photo ? `<div class="row" style="margin-bottom:6px"><span class="badge">📷 사진 1장 첨부됨</span><button class="btn small" id="aiRm" type="button">빼기</button></div>` : '';
    if (photo) $('#aiRm').onclick = () => { photo = null; drawPhoto(); };
  };
  $('#aiCam').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { photo = await shrink(f, 1600, 0.82); drawPhoto(); } catch (err) { toast(err.message); } } };

  async function send() {
    const text = $('#aiIn').value.trim();
    if (!text && !photo) { toast('명령을 말하거나 적어 주세요'); return; }
    $('#aiGo').disabled = true;
    try {
      const r = await runCommand(text || '이 사진에 있는 내용을 정리해 줘', photo);
      const l = aiLog(); l.push(r); aiLogSave(l);
      $('#aiIn').value = ''; photo = null; drawPhoto(); draw();
    } catch (err) { console.error(err); toast('처리 중 오류: ' + err.message); }
    $('#aiGo').disabled = false;
  }
  $('#aiGo').onclick = send;
  $('#aiIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  let rec = null;
  $('#aiMic').onclick = () => {
    if (!SR) { toast('이 브라우저는 음성 입력을 지원하지 않습니다. 키보드의 🎤 버튼을 쓰세요'); $('#aiIn').focus(); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = false;
    let fin = '';
    rec.onresult = (ev) => { let it = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const x = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += x; else it += x; } $('#aiIn').value = fin + it; };
    rec.onstart = () => { $('#aiMic').textContent = '⏹'; $('#aiState').textContent = '듣는 중…'; };
    rec.onerror = (ev) => { $('#aiState').textContent = ev.error === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '음성 인식 오류: ' + ev.error; };
    rec.onend = () => { rec = null; $('#aiMic').textContent = '🎤'; $('#aiState').textContent = ''; if ($('#aiIn').value.trim()) send(); };
    try { rec.start(); } catch { rec = null; toast('음성 입력을 시작할 수 없습니다'); }
  };
  draw();
  if (qs.get('q')) { $('#aiIn').value = qs.get('q'); send(); }
  if (qs.get('m') === 'voice') setTimeout(() => $('#aiMic').click(), 300);
}
