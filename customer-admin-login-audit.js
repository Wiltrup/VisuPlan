(() => {
  const SESSION_KEY = 'visuplanner-customer-admin-session';
  const loginForm = document.getElementById('customerAdminLoginForm');
  const dashboard = document.getElementById('customerAdminDashboard');
  const audit = document.getElementById('customerAdminAudit');
  let pendingLogin = false;
  let sentForAttempt = false;

  const patchLabels = () => {
    audit?.querySelectorAll('.audit-row strong').forEach(node => {
      if (node.textContent.trim() === 'admin_login') node.textContent = 'Logget ind i kundeadministration';
    });
  };

  loginForm?.addEventListener('submit', () => {
    pendingLogin = true;
    sentForAttempt = false;
    setTimeout(() => { if (!sentForAttempt) pendingLogin = false; }, 30000);
  });

  const observer = new MutationObserver(async () => {
    patchLabels();
    if (!pendingLogin || sentForAttempt || dashboard?.hidden) return;

    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch {}
    if (!saved?.access_token) return;

    sentForAttempt = true;
    pendingLogin = false;
    try {
      const response = await fetch('/api/customer-admin-login-event', {
        method:'POST',
        headers:{ Authorization:`Bearer ${saved.access_token}`, 'Content-Type':'application/json' },
        body:'{}'
      });
      if (response.ok && typeof window.loadDashboard === 'function') {
        await window.loadDashboard();
        patchLabels();
      }
    } catch (error) {
      console.warn('Login kunne ikke føjes til administratorloggen.', error);
    }
  });

  if (dashboard) observer.observe(dashboard, { attributes:true, attributeFilter:['hidden'], subtree:true, childList:true });
  if (audit) observer.observe(audit, { subtree:true, childList:true });
  patchLabels();
})();
