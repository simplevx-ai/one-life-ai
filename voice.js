/* ONE LIFE AI — 음성 기록
 * 녹음하거나 녹음 파일을 넣으면 폰 안에서 글로 바꾸고(Whisper), 요약과 할 일을 뽑아 체크리스트에 넣을 수 있다.
 * 소리와 글은 폰 밖으로 나가지 않는다(모델 파일만 처음 한 번 내려받음).
 * 요약·할 일 뽑기는 규칙 방식이다. 더 잘 정리하려면 Claude로 넘긴다.
 */
'use strict';

const STT_MODELS = { '빠름(기본)': 'onnx-community/whisper-base', '정확도 우선': 'onnx-community/whisper-small' };

/* ───────── 소리 → 16kHz 모노 ───────── */
async function decodeAudio(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const n = buf.numberOfChannels, len = buf.length, out = new Float32Array(len);
    for (let c = 0; c < n; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) out[i] += d[i] / n; }
    return { pcm: out, sec: buf.duration };
  } catch { throw new Error('이 녹음 파일 형식은 열 수 없습니다(m4a·mp3·wav·webm 권장)'); }
  finally { ctx.close(); }
}

let sttWorker = null;
function transcribe(pcm, model, onMsg) {
  return new Promise((res, rej) => {
    if (!sttWorker) sttWorker = new Worker('stt-worker.js', { type: 'module' });
    sttWorker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'done') res(m.text);
      else if (m.type === 'error') rej(new Error(m.msg));
      else onMsg(m);
    };
    sttWorker.onerror = (e) => rej(new Error(e.message || '음성 인식을 시작할 수 없습니다'));
    sttWorker.postMessage({ audio: pcm, model }, [pcm.buffer]);
  });
}

/* ───────── 요약·할 일 뽑기(규칙) ───────── */
const TASK_RE = /(해야|하기로|해\s*줘|해주세요|해 주세요|부탁|요청|확인|연락|전화|보내|준비|예약|주문|챙기|잊지\s*말|필요|까지|하자|할\s*것|드리기|드려야|처리)/;
function splitSentences(t) {
  return String(t || '').replace(/\s+/g, ' ').split(/(?<=[.?!。]|다\.|요\.|[가-힣](?:다|요|죠|까)\s)(?=\s|$)|\n/).map((s) => s.trim()).filter((s) => s.length > 3);
}
function dateIn(s, base = new Date()) {
  const f = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const d = new Date(base);
  if (/모레/.test(s)) { d.setDate(d.getDate() + 2); return f(d); }
  if (/내일/.test(s)) { d.setDate(d.getDate() + 1); return f(d); }
  if (/오늘/.test(s)) return f(d);
  let m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) { const x = new Date(d.getFullYear(), +m[1] - 1, +m[2]); if (x < new Date(d.getFullYear(), d.getMonth(), d.getDate() - 30)) x.setFullYear(x.getFullYear() + 1); return f(x); }
  m = s.match(/(다음\s*주|이번\s*주)?\s*([월화수목금토일])요일/);
  if (m) {
    const want = '일월화수목금토'.indexOf(m[2]);
    const x = new Date(d);
    if (m[1]) {
      // 월요일 시작 주 기준: 이번 주/다음 주의 그 요일
      const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      x.setTime(mon.getTime()); x.setDate(mon.getDate() + ((want + 6) % 7) + (/다음/.test(m[1]) ? 7 : 0));
    } else x.setDate(d.getDate() + ((want - d.getDay() + 7) % 7)); // 가장 가까운 그 요일(오늘 포함)
    return f(x);
  }
  m = s.match(/(\d{1,2})\s*일\s*(까지|에|날)/);
  if (m) { const x = new Date(d.getFullYear(), d.getMonth(), +m[1]); if (x < new Date(d.getFullYear(), d.getMonth(), d.getDate())) x.setMonth(x.getMonth() + 1); return f(x); }
  return '';
}
function extractTasks(text) {
  return splitSentences(text).filter((s) => TASK_RE.test(s)).slice(0, 12).map((s) => {
    const area = (typeof classifyCommand === 'function' ? classifyCommand(s).area : '개인');
    return { text: s.replace(/^(그리고|그래서|아|음|어|네|그럼)\s*/, '').slice(0, 100), date: dateIn(s), area: TASK_AREAS.includes(area) ? area : (area === '일정·할 일' ? '개인' : '개인'), pick: true };
  });
}
function summarize(text) {
  const ss = splitSentences(text);
  if (ss.length <= 3) return ss.join('\n');
  // 자주 나온 단어(2글자 이상)를 많이 담은 문장 + 숫자·날짜·할 일 문장에 점수
  const words = {};
  ss.forEach((s) => (s.match(/[가-힣A-Za-z]{2,}/g) || []).forEach((w) => { words[w] = (words[w] || 0) + 1; }));
  const score = (s) => (s.match(/[가-힣A-Za-z]{2,}/g) || []).reduce((a, w) => a + (words[w] > 1 ? words[w] : 0), 0) / Math.sqrt(s.length)
    + (/\d/.test(s) ? 1.5 : 0) + (TASK_RE.test(s) ? 1 : 0) + (/(결론|정리하면|중요|핵심|결정)/.test(s) ? 2 : 0);
  const n = Math.min(5, Math.max(3, Math.round(ss.length / 5)));
  const top = ss.map((s, i) => ({ s, i, v: score(s) })).sort((a, b) => b.v - a.v).slice(0, n).sort((a, b) => a.i - b.i);
  return top.map((x) => '- ' + x.s).join('\n');
}

/* ───────── 목록 ───────── */
async function viewVoiceList() {
  setTitle('음성 기록', true);
  const list = (await DB.all('notes')).filter((n) => n.via === 'voice-rec').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  view().innerHTML = `
    <div class="grid2" style="margin-bottom:12px"><a class="btn primary" href="#/voice/new?m=rec">● 녹음 시작</a><a class="btn" href="#/voice/new?m=file">📁 녹음 파일 넣기</a></div>
    ${list.map((n) => `<a class="item" href="#/voice/${n.id}"><div class="row spread"><span class="t">${esc(n.title || '음성 기록')}</span><span class="muted">${esc(fmtSec(n.sec))}</span></div>
      <div class="muted">${esc((n.createdAt || '').slice(0, 16).replace('T', ' '))} · ${esc(n.tag || '')}${n.tasks && n.tasks.length ? ` · 할 일 ${n.tasks.length}` : ''}${n.text ? '' : ' · 변환 전'}</div></a>`).join('') || '<div class="empty">음성 기록이 없습니다.</div>'}`;
}
const fmtSec = (s) => (s ? `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}` : '');

/* ───────── 새 녹음·파일 ───────── */
async function viewVoiceNew() {
  const mode = new URLSearchParams(location.hash.split('?')[1] || '').get('m') || 'rec';
  setTitle(mode === 'file' ? '녹음 파일 넣기' : '녹음', true);
  const modelName = (() => { try { return localStorage.getItem('sttModel') || '빠름(기본)'; } catch { return '빠름(기본)'; } })();
  view().innerHTML = `
    <div class="card" style="text-align:center">
      ${mode === 'file' ? `<label class="btn primary block" style="min-height:64px;font-size:18px;color:#fff">📁 녹음 파일 고르기<input id="vf" type="file" accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.amr,video/mp4" hidden></label>
        <div class="muted" style="margin-top:8px">휴대폰 녹음 앱·통화 녹음 파일(m4a 등)을 고르세요.</div>`
      : `<div id="vt" style="font-size:44px;font-weight:800;font-variant-numeric:tabular-nums">0:00</div>
        <button class="btn primary block" id="vr" type="button" style="min-height:64px;font-size:18px">● 녹음 시작</button>
        <div class="muted" style="margin-top:8px">멈추면 바로 글로 바꿉니다. 화면을 끄면 녹음이 멈출 수 있습니다.</div>`}
    </div>
    <div class="card"><label for="vm">변환 방식</label><select id="vm">${opts(Object.keys(STT_MODELS), modelName)}</select>
      <div class="muted" style="margin-top:6px">처음 한 번 음성 인식 모델을 내려받습니다(빠름 약 80MB, 정확도 우선 약 250MB). 와이파이에서 하세요. 이후에는 인터넷 없이도 됩니다.</div></div>
    <div id="vs" class="card" hidden></div>`;
  $('#vm').onchange = (e) => { try { localStorage.setItem('sttModel', e.target.value); } catch { /* 무시 */ } };

  const process = async (blob, name) => {
    const st = $('#vs'); st.hidden = false;
    st.innerHTML = '<b>소리 읽는 중…</b>';
    const now = nowISO();
    const note = { id: uid(), via: 'voice-rec', tag: '개인', createdAt: now, updatedAt: now, audio: blob, audioName: name || '', text: '', title: name ? name.replace(/\.[^.]+$/, '') : `음성 기록 ${now.slice(5, 16).replace('T', ' ')}`, done: false };
    await DB.put('notes', note); // 변환이 실패해도 녹음은 남긴다
    try {
      const { pcm, sec } = await decodeAudio(blob);
      note.sec = sec; await DB.put('notes', note);
      if (sec > 30 * 60) toast('30분이 넘는 녹음은 변환에 오래 걸립니다');
      const t0 = Date.now();
      const timer = setInterval(() => { const el = $('#vs .el'); if (el) el.textContent = `${Math.round((Date.now() - t0) / 1000)}초 지남`; }, 1000);
      const files = {};
      try {
        const text = await transcribe(pcm, STT_MODELS[$('#vm').value], (m) => {
          if (m.type === 'progress') { files[m.file] = m.pct; const v = Object.values(files); st.innerHTML = `<b>모델 내려받는 중 ${Math.round(v.reduce((a, x) => a + x, 0) / v.length)}%</b><div class="muted">처음 한 번만 합니다</div>`; }
          else st.innerHTML = `<b>${esc(m.msg)}…</b> <span class="muted el"></span><div class="muted">녹음 ${fmtSec(sec)} · 폰에 따라 녹음 길이의 1~3배 걸릴 수 있습니다. 화면을 켜 두세요.</div>`;
        });
        clearInterval(timer);
        await finishNote(note, text);
        location.replace(`#/voice/${note.id}`);
      } catch (e) { clearInterval(timer); throw e; }
    } catch (e) {
      st.innerHTML = `<div style="color:var(--red)">변환 실패: ${esc(e.message)}</div><div class="muted">녹음은 저장했습니다. 음성 기록 목록에서 다시 변환할 수 있습니다.</div><a class="btn small" href="#/voice/${note.id}" style="margin-top:8px">기록 열기</a>`;
    }
  };

  if (mode === 'file') {
    $('#vf').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) process(f, f.name); };
    setTimeout(() => $('#vf').click(), 300);
    return;
  }
  let mr = null, chunks = [], t0 = 0, tick = null, stream = null;
  $('#vr').onclick = async () => {
    if (mr) { mr.stop(); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast('마이크 권한을 허용해 주세요'); return; }
    chunks = [];
    mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      clearInterval(tick); stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      mr = null; $('#vr').textContent = '● 녹음 시작'; $('#vr').disabled = true;
      process(blob, '');
    };
    mr.start(1000);
    t0 = Date.now();
    tick = setInterval(() => { const s = (Date.now() - t0) / 1000; $('#vt').textContent = fmtSec(s); }, 500);
    $('#vr').textContent = '■ 멈추고 글로 바꾸기';
  };
}

async function finishNote(note, text) {
  note.text = text;
  note.summary = summarize(text);
  note.tasks = extractTasks(text);
  const area = classifyCommand(text).area;
  note.tag = NOTE_TAGS.includes(area) ? area : '개인';
  const first = splitSentences(text)[0] || '';
  if (!note.audioName) note.title = first.slice(0, 30) || note.title;
  note.updatedAt = nowISO();
  await DB.put('notes', note);
}

/* ───────── 기록 상세 ───────── */
async function viewVoice(id) {
  const n = await DB.get('notes', id);
  if (!n) { setTitle('음성 기록', true); view().innerHTML = '<div class="empty">기록을 찾을 수 없습니다.</div>'; return; }
  setTitle('음성 기록', true);
  const url = n.audio ? URL.createObjectURL(n.audio) : '';
  const tasks = n.tasks || [];
  view().innerHTML = `
    <div class="card">
      <label for="v_title">제목</label><input id="v_title" value="${esc(n.title)}">
      <div class="muted" style="margin:6px 0">${esc((n.createdAt || '').slice(0, 16).replace('T', ' '))} · ${esc(fmtSec(n.sec))} · <select id="v_tag" style="width:auto;min-height:32px;padding:2px 8px">${opts(NOTE_TAGS, n.tag)}</select></div>
      ${url ? `<audio controls src="${url}" style="width:100%"></audio>` : ''}
    </div>
    ${n.text ? '' : `<div class="card warnbox"><b>아직 글로 바꾸지 않았습니다</b><div class="row" style="margin-top:8px"><select id="v_model" style="width:auto">${opts(Object.keys(STT_MODELS))}</select><button class="btn primary" id="v_redo" type="button">글로 바꾸기</button></div><div id="v_st" class="muted"></div></div>`}
    <div class="card"><h2>📝 요약 <span class="muted">(자동)</span></h2><textarea id="v_sum" rows="5">${esc(n.summary)}</textarea></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">☑️ 할 일 ${tasks.length}</h2><button class="btn small" id="v_reTask" type="button">다시 뽑기</button></div>
      <div id="v_tasks" style="margin-top:8px">${tasks.map((t, i) => `
        <div class="row" style="padding:6px 0;border-bottom:1px solid var(--line);align-items:flex-start">
          <input type="checkbox" data-i="${i}" ${t.pick !== false ? 'checked' : ''} style="width:22px;min-height:22px;flex:none;margin-top:8px">
          <div style="flex:1"><input data-t="${i}" value="${esc(t.text)}" style="min-height:36px;padding:6px 8px">
            <div class="row" style="margin-top:4px"><input data-d="${i}" type="date" value="${esc(t.date)}" style="min-height:32px;padding:2px 6px"><select data-a="${i}" style="width:auto;min-height:32px;padding:2px 6px">${opts(TASK_AREAS, t.area)}</select></div></div>
        </div>`).join('') || '<div class="muted">찾은 할 일이 없습니다.</div>'}</div>
      ${tasks.length ? '<button class="btn primary block" id="v_add" type="button" style="margin-top:10px">체크한 할 일을 체크리스트에 넣기</button>' : ''}
      <div class="muted" style="margin-top:6px">날짜가 없으면 오늘 할 일로 들어갑니다.</div></div>
    <div class="card"><h2>📄 전체 글</h2><textarea id="v_text" rows="10">${esc(n.text)}</textarea></div>
    <div class="row"><button class="btn primary block" id="v_save" type="button">💾 저장</button><button class="btn block" id="v_copy" type="button">📋 글 복사</button></div>
    <button class="btn block" id="v_claude" type="button" style="margin-top:8px">🤖 Claude로 요약·할 일 정리</button>
    <button class="btn danger block" id="v_del" type="button" style="margin-top:8px">기록 삭제</button>`;

  const collect = () => ({
    ...n, title: $('#v_title').value.trim(), tag: $('#v_tag').value, summary: $('#v_sum').value, text: $('#v_text').value,
    tasks: tasks.map((t, i) => ({ text: view().querySelector(`[data-t="${i}"]`).value.trim(), date: view().querySelector(`[data-d="${i}"]`).value, area: view().querySelector(`[data-a="${i}"]`).value, pick: view().querySelector(`[data-i="${i}"]`).checked, added: t.added })),
    updatedAt: nowISO(),
  });
  $('#v_save').onclick = async () => { await DB.put('notes', collect()); toast('저장했습니다'); };
  $('#v_copy').onclick = () => copyText($('#v_text').value);
  $('#v_reTask').onclick = async () => {
    const x = collect(); x.tasks = extractTasks(x.text); x.summary = summarize(x.text);
    await DB.put('notes', x); render();
  };
  if ($('#v_add')) $('#v_add').onclick = async () => {
    const x = collect(); let k = 0;
    for (const t of x.tasks) {
      if (!t.pick || t.added || !t.text) continue;
      await DB.put('tasks', { id: uid(), text: t.text, area: t.area, date: t.date || todayStr(), done: false, createdAt: nowISO(), noteId: n.id });
      t.added = true; k++;
    }
    await DB.put('notes', x);
    toast(k ? `할 일 ${k}개를 체크리스트에 넣었습니다` : '새로 넣을 할 일이 없습니다');
  };
  $('#v_claude').onclick = () => {
    const p = `아래는 내가 녹음한 내용을 글로 바꾼 것입니다(음성 인식이라 틀린 글자가 있을 수 있음). 한국어로 ① 핵심 요약 3~5줄 ② 할 일 목록(누가·무엇을·언제까지) ③ 확인이 필요한 부분으로 정리해 주세요.\n\n${$('#v_text').value}`;
    try { navigator.clipboard.writeText(p); } catch { /* 무시 */ }
    toast('요청문을 복사했습니다');
    window.open('https://claude.ai/new?q=' + encodeURIComponent(p.slice(0, 6000)), '_blank', 'noopener');
  };
  $('#v_del').onclick = async () => { if (confirm('녹음과 글을 모두 지울까요?')) { await DB.del('notes', n.id); location.replace('#/voice'); } };
  if ($('#v_redo')) $('#v_redo').onclick = async () => {
    if (!n.audio) { toast('녹음 파일이 없습니다'); return; }
    $('#v_redo').disabled = true;
    try {
      $('#v_st').textContent = '소리 읽는 중…';
      const { pcm, sec } = await decodeAudio(n.audio);
      n.sec = sec;
      const text = await transcribe(pcm, STT_MODELS[$('#v_model').value], (m) => { $('#v_st').textContent = m.type === 'progress' ? `모델 내려받는 중 ${Math.round(m.pct)}%` : m.msg + '…'; });
      await finishNote(n, text); render();
    } catch (e) { $('#v_st').textContent = '실패: ' + e.message; $('#v_redo').disabled = false; }
  };
}
