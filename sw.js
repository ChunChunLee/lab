// 離線用：把網頁的檔案存在裝置上，沒有網路也打得開。有新版時會在背景更新，下次打開就是新版。
const VERSION = 'lcm-59ef9da9f8';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/views.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/config.js', 'js/sync.js', 'js/store.js', 'js/db.js', 'js/model.js', 'js/format.js', 'js/sample.js',
  'js/ui/dom.js', 'js/ui/kit.js',
  'js/logic/grades.js', 'js/logic/groupMaker.js', 'js/logic/rosterParser.js', 'js/logic/groupImport.js', 'js/logic/dutyImport.js', 'js/logic/syncEngine.js',
  'js/io/zip.js', 'js/io/xlsx.js', 'js/io/reports.js', 'js/io/exporter.js',
  'js/views/sideMenu.js', 'js/views/start.js', 'js/views/menuViews.js', 'js/views/masterRoster.js', 'js/views/rosterImport.js',
  'js/views/backup.js', 'js/views/roster.js', 'js/views/grades.js', 'js/views/groups.js', 'js/views/duties.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 先用存好的檔案（快、離線也行），同時到網路上拿新的存起來
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached ?? network;
  }));
});
