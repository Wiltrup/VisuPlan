(() => {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (!standalone) return;

  const path = location.pathname.replace(/\/+$/, '') || '/';
  const route = window.__VISUPLANNER_BOARD_ROUTE__ || null;
  const kind = route?.kind || 'team';
  const slug = route?.target_slug || location.pathname.split('/').filter(Boolean).at(-1) || '';
  const persistentKey = `visuplanner-pwa-viewer:${path}`;
  const sessionKeys = kind === 'club'
    ? [`visuplanner-offer-${slug}`]
    : ['visuplanner-viewer-session', 'visuplanner-session'];
  const viewerRole = kind === 'club' ? 'offer_viewer' : 'viewer';

  const parse = value => {
    try { return JSON.parse(value || 'null'); } catch { return null; }
  };
  const isViewer = value => parse(value)?.user?.user_metadata?.role === viewerRole;

  // Restore only a viewer session, never editor/admin sessions.
  const saved = localStorage.getItem(persistentKey);
  if (isViewer(saved)) {
    sessionKeys.forEach(key => sessionStorage.setItem(key, saved));
  } else if (saved) {
    localStorage.removeItem(persistentKey);
  }

  // Keep refreshed viewer tokens persistent while the installed PWA is open.
  const sync = () => {
    for (const key of sessionKeys) {
      const value = sessionStorage.getItem(key);
      if (isViewer(value)) {
        localStorage.setItem(persistentKey, value);
        return;
      }
    }
  };
  sync();
  const timer = setInterval(sync, 1000);
  window.addEventListener('pagehide', () => { sync(); clearInterval(timer); }, { once:true });

  // Manual viewer logout must forget the installed app's remembered session.
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#viewerLogoutButton, #offerLogout');
    if (!button) return;
    if (kind === 'club') {
      const current = sessionStorage.getItem(`visuplanner-offer-${slug}`);
      if (!isViewer(current)) return;
    }
    localStorage.removeItem(persistentKey);
  }, true);
})();
