// 앱 화면 파일을 폰에 저장해 인터넷 없이도 열리게 한다. (고객 데이터는 IndexedDB에 따로 있음)
const CACHE = 'onelife-v0.13.2';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'office.js', 'office2.js', 'ai.js', 'report.js', 'voice.js', 'stt-worker.js', 'mkt.js', 'sport.js', 'biz.js', 'rcpt.js', 'rcptform.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/shortcut-receipt-96.png', 'icons/shortcut-receipt-192.png', 'icons/shortcut-ledger-96.png', 'icons/shortcut-ledger-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('onelife-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 인터넷이 되면 새 버전을 받아 저장, 안 되면 저장된 화면을 보여 준다
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // 폰 캐시(10분)를 건너뛰고 서버에 새 버전이 있는지 확인
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
