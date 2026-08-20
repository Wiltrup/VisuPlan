const CACHE='visuplanner-v49-week-photo-reliability';
const ASSETS=['/','/index','/landing.css?v=47','/landing-overrides.css?v=48','/login','/finder.css','/finder.js?v=46','/demo','/demo.css?v=44','/demo.js?v=49','/admin','/admin.css?v=43','/admin-extra.css?v=43','/admin-v38.css?v=43','/admin.js?v=43','/app','/styles.css?v=49','/app.js?v=49','/shared-offer.html','/shared-offer.css?v=49','/shared-offer.js?v=49','/opret','/opret.js?v=40','/forms.css?v=44','/saadan-virker-det','/how.css?v=44','/priser','/ofte-spurgte-spoergsmaal','/betingelser','/privatliv','/databehandleraftale','/underdatabehandlere','/public-pages.css?v=40','/manifest.webmanifest','/assets/brand/wordmark.png','/assets/brand/calendar.png','/assets/demo/lasagne.webp','/assets/demo/tarteletter.webp','/assets/demo-staff/person-00.webp','/assets/demo-staff/person-01.webp','/assets/demo-staff/person-02.webp','/assets/demo-staff/person-03.webp','/assets/demo-staff/person-04.webp','/assets/demo-staff/person-05.webp','/assets/demo-staff/person-06.webp','/assets/demo-staff/person-07.webp','/assets/audio/mandag.mp3','/assets/audio/tirsdag.mp3','/assets/audio/onsdag.mp3','/assets/audio/torsdag.mp3','/assets/audio/fredag.mp3','/assets/audio/loerdag.mp3','/assets/audio/soendag.mp3','/assets/audio/morgenvagt.mp3','/assets/audio/aftenvagt.mp3','/assets/audio/nattevagt.mp3','/assets/audio/doegnvagt.mp3','/assets/audio/heldagsvagt.mp3','/assets/audio/morgenmad.mp3','/assets/audio/frokost.mp3','/assets/audio/aftensmad.mp3','/assets/audio/aktivitet.mp3'];
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
