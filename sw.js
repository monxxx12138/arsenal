/* 枪手日报 · Service Worker
   目标：外壳 + 赛程离线可用（飞机上、地铁里也能看见上次的数据），
   比分/积分榜由页面写进 localStorage，所以这里只负责静态资源。 */
const VERSION = 'arsenal-v39';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './fixtures.json', './details.json',
  './icon-192.png', './icon-512.png', './icon-180.png', './icon-32.png',
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
  // 接口请求不拦：让页面自己处理失败与回退
  if (url.hostname !== self.location.hostname) return;
  if (e.request.method !== 'GET') return;

  // 导航请求：先网络（拿最新外壳），失败回缓存
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

  // 数据文件走「网络优先」：服务器一更新就能拿到新赛程/前瞻，不用等版本号
  if (/\.(json)$/i.test(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => hit))
  );
});
