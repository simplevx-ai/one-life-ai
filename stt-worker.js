// 폰 안 음성 → 글 변환(Whisper, transformers.js). 모델은 처음 한 번 내려받아 브라우저에 보관된다.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
let asr = null, loaded = '';

self.onmessage = async (e) => {
  const { audio, model } = e.data;
  try {
    if (!asr || loaded !== model) {
      self.postMessage({ type: 'status', msg: '음성 인식 모델 준비 중' });
      asr = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, pct: p.progress }); },
      });
      loaded = model;
    }
    self.postMessage({ type: 'status', msg: '글로 바꾸는 중' });
    const out = await asr(audio, { language: 'korean', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    self.postMessage({ type: 'done', text: (out.text || '').trim() });
  } catch (err) {
    self.postMessage({ type: 'error', msg: String((err && err.message) || err) });
  }
};
