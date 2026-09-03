(() => {
  const SESSION_KEY = 'visuplanner-customer-admin-session';
  const panel = document.getElementById('customerSubscriptionPanel');
  const title = document.getElementById('customerSubscriptionTitle');
  const text = document.getElementById('customerSubscriptionText');
  const button = document.getElementById('customerSubscriptionActivate');
  const dashboard = document.getElementById('customerAdminDashboard');
  if (!panel || !title || !text || !button || !dashboard) return;

  const formatDate = value => value
    ? new Intl.DateTimeFormat('da-DK', { dateStyle:'long' }).format(new Date(value))
    : 'ikke fastsat';
  const daysUntil = value => value ? Math.max(0, Math.ceil((new Date(value) - new Date()) / 86400000)) : null;

  function savedSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  async function post(action) {
    const session = savedSession();
    if (!session?.access_token) throw new Error('Log ind igen for at fortsætte.');
    const response = await fetch('/api/customer-admin', {
      method:'POST',
      headers:{ Authorization:`Bearer ${session.access_token}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ action })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Handlingen kunne ikke gennemføres.');
    return data;
  }

  function render(status) {
    panel.hidden = false;
    button.hidden = true;
    button.disabled = false;

    if (status.subscription_interest_at) {
      title.textContent = 'Aktivering anmodet';
      const expiry = status.trial_ends_at ? ` Den nuværende prøveperiode løber til ${formatDate(status.trial_ends_at)}.` : '';
      text.textContent = `Techus Nord har modtaget jeres anmodning og kontakter jer om den videre aftale.${expiry}`;
      return;
    }

    if (status.status === 'trial') {
      const days = daysUntil(status.trial_ends_at);
      title.textContent = 'Prøveperiode';
      text.textContent = status.trial_ends_at
        ? `Prøveperioden udløber ${formatDate(status.trial_ends_at)}${days !== null ? ` · ${days} ${days === 1 ? 'dag' : 'dage'} tilbage` : ''}.`
        : 'Prøveperiodens udløbsdato er ikke fastsat.';
      button.hidden = false;
      button.textContent = 'Aktiver';
      return;
    }

    if (status.status === 'read_only') {
      title.textContent = 'Prøveperioden er udløbet';
      text.textContent = 'Tavlerne kan fortsat ses. Vælg Aktiver, hvis I ønsker at fortsætte med VisuPlanner.';
      button.hidden = false;
      button.textContent = 'Aktiver';
      return;
    }

    const labels = { contracted:'Aftale indgået', invoice_sent:'Faktura sendt', active:'Aktivt abonnement', overdue:'Betaling forfalden', cancelled:'Opsagt' };
    title.textContent = labels[status.status] || 'Abonnement';
    text.textContent = status.subscription_renews_at
      ? `Næste fornyelse: ${formatDate(status.subscription_renews_at)}.`
      : 'Jeres abonnement er registreret hos Techus Nord.';
  }

  async function load() {
    if (dashboard.hidden) return;
    try { render(await post('subscription-status')); }
    catch (error) { console.error('Abonnementsstatus kunne ikke hentes.', error); }
  }

  button.addEventListener('click', async () => {
    if (!confirm('Send anmodning til Techus Nord om at fortsætte med VisuPlanner?')) return;
    button.disabled = true;
    try {
      const result = await post('request-subscription');
      render(result);
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  });

  const observer = new MutationObserver(() => { if (!dashboard.hidden) load(); });
  observer.observe(dashboard, { attributes:true, attributeFilter:['hidden'] });
  if (!dashboard.hidden) load();
  document.getElementById('customerAdminReload')?.addEventListener('click', () => setTimeout(load, 300));
})();
