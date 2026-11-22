/* 鏋墜鏃ユ姤 路 Service Worker
   鐩爣锛氬澹?+ 璧涚▼绂荤嚎鍙敤锛堥鏈轰笂銆佸湴閾侀噷涔熻兘鐪嬭涓婃鐨勬暟鎹級锛?   姣斿垎/绉垎姒滅敱椤甸潰鍐欒繘 localStorage锛屾墍浠ヨ繖閲屽彧璐熻矗闈欐€佽祫婧愩€?*/
const VERSION = 'arsenal-v6';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './fixtures.json',
  './icon-192.png', './icon-512.png', './icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 鎺ュ彛璇锋眰涓嶆嫤锛氳椤甸潰鑷繁澶勭悊澶辫触涓庡洖閫€
  if (url.hostname !== self.location.hostname) return;
  if (e.request.method !== 'GET') return;

  // 瀵艰埅璇锋眰锛氬厛缃戠粶锛堟嬁鏈€鏂板澹筹級锛屽け璐ュ洖缂撳瓨
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 闈欐€佽祫婧愶細缂撳瓨浼樺厛
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => hit))
  );
});
