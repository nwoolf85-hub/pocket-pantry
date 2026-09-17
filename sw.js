/* Diet Dash service worker — cache the app shell so it opens offline.
   Food lookups (openfoodfacts) always go to network. */
const CACHE = 'dietdash-v1.2.4';
const SHELL = [
  './', './index.html', './app.js?v=1.2.0', './styles.css?v=1.2.0', './manifest.json',
  './pantry-seed.json', './vendor/zxing.min.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const url=new URL(e.request.url);
  if(url.hostname.includes('openfoodfacts')) return; // never cache lookups
  if(e.request.method!=='GET') return;
  e.respondWith(
    caches.match(e.request).then(hit=> hit || fetch(e.request).then(res=>{
      if(url.origin===location.origin){ const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); }
      return res;
    }).catch(()=>hit))
  );
});
