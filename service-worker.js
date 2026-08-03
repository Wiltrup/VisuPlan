const CACHE='visuplanner-v18';
const ASSETS=['/','/index','/landing.css','/landing-overrides.css','/login','/finder.css','/finder.js','/demo','/demo.css','/demo.js','/admin','/admin.css','/admin.js','/app','/team-2','/styles.css','/app.js','/manifest.webmanifest','/assets/brand/wordmark.png','/assets/brand/calendar.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    return response;
  }).catch(()=>caches.match(event.request)));
});
