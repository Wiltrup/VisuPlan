const CACHE='visuplanner-v37-week-drafts-and-save-all';
const ASSETS=['/','/index','/landing.css','/landing-overrides.css','/login','/finder.css','/finder.js','/demo','/demo.css','/demo.js','/admin','/admin.css?v=32','/admin-extra.css?v=32','/admin.js?v=32','/app','/trekloeveret-team-2','/styles.css?v=37','/app.js?v=37','/opret','/opret.js','/forms.css','/saadan-virker-det','/how.css','/manifest.webmanifest','/assets/brand/wordmark.png','/assets/brand/calendar.png','/assets/audio/mandag.mp3','/assets/audio/tirsdag.mp3','/assets/audio/onsdag.mp3','/assets/audio/torsdag.mp3','/assets/audio/fredag.mp3','/assets/audio/loerdag.mp3','/assets/audio/soendag.mp3','/assets/audio/morgenvagt.mp3','/assets/audio/aftenvagt.mp3','/assets/audio/nattevagt.mp3','/assets/audio/doegnvagt.mp3','/assets/audio/heldagsvagt.mp3','/assets/audio/morgenmad.mp3','/assets/audio/frokost.mp3','/assets/audio/aftensmad.mp3','/assets/audio/aktivitet.mp3'];
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
