// Offline shell. The app's files are cached so the waste form opens with no
// signal; data changes wait in the app's outbox (see js/store.js), not here.
// Network first, so a deploy is picked up as soon as there is a connection.
const CACHE = 'threadback-shell-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg',
  'js/main.js', 'js/store.js', 'js/transport.js', 'js/seed.js', 'js/ui.js', 'js/forms.js',
  'js/engine/rules.js', 'js/engine/db.js', 'js/engine/checks.js', 'js/engine/ledger.js', 'js/engine/trace.js',
  'js/engine/declaration.js', 'js/engine/commands.js', 'js/engine/ledgerlog.js', 'js/engine/visibility.js', 'js/engine/flow.js', 'js/engine/pack.js',
  'js/views/common.js', 'js/views/tenant.js', 'js/views/detail.js', 'js/views/supplier.js', 'js/views/declare.js',
  'js/views/product.js', 'js/views/system.js', 'js/views/pack.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
