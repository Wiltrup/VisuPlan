(async () => {
  const status = document.getElementById('routeStatus');
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const fail = message => {
    document.title = 'Tavlen blev ikke fundet – VisuPlanner';
    status.innerHTML = `${message}<br><br><a href="/login">Find jeres tavle</a>`;
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', { scope:'/' }).catch(error => console.warn('Service worker kunne ikke registreres.', error));
  }
  if (parts.length !== 2 || !parts.every(part => /^[a-z0-9-]{2,80}$/.test(part))) return fail('Tavlen blev ikke fundet.');
  try {
    const response = await fetch(`/api/team-login?resolve_customer=${encodeURIComponent(parts[0])}&resolve_slug=${encodeURIComponent(parts[1])}`, { cache:'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.target_slug) throw new Error(result.error || 'Tavlen blev ikke fundet.');
    const route = { path, kind:result.kind, target_slug:result.target_slug, customer_slug:parts[0], board_slug:parts[1] };
    sessionStorage.setItem('visuplanner-board-route', JSON.stringify(route));
    const page = await fetch(result.kind === 'club' ? '/shared-offer' : '/app', { cache:'no-store' });
    if (!page.ok) throw new Error('Tavlen kunne ikke åbnes.');
    const routeScript = `<script>window.__VISUPLANNER_BOARD_ROUTE__=${JSON.stringify(route).replace(/</g, '\\u003c')}<\/script>`;
    const resumeScript = `<script>(()=>{let hiddenAt=null;document.addEventListener('visibilitychange',()=>{if(document.hidden){hiddenAt=Date.now();return;}if(!hiddenAt||Date.now()-hiddenAt<20*60*1000)return;hiddenAt=null;if(document.querySelector('dialog[open]'))return;location.reload();},{capture:true});})();<\/script>`;
    const html = (await page.text()).replace('<head>', `<head>${routeScript}${resumeScript}`);
    document.open(); document.write(html); document.close();
  } catch (error) {
    fail(error.message || 'Tavlen kunne ikke åbnes.');
  }
})();
