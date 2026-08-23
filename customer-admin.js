const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
const SESSION_KEY = 'visuplanner-customer-admin-session';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
let session = null;
let dashboard = null;
let inactivityTimer = null;
const invitedEmail = new URLSearchParams(location.search).get('email') || '';
if (invitedEmail) $('customerAdminEmail').value = invitedEmail;

async function signIn(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:'POST', headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error('Forkert arbejdsmail eller adgangskode.');
  return response.json();
}

async function refreshSession(saved) {
  if (!saved?.refresh_token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method:'POST', headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ refresh_token:saved.refresh_token })
  });
  return response.ok ? response.json() : null;
}

async function api(options = {}, retry = true) {
  const response = await fetch('/api/customer-admin', {
    ...options, headers:{ Authorization:`Bearer ${session?.access_token || ''}`, 'Content-Type':'application/json', ...(options.headers || {}) }
  });
  if ((response.status === 401 || response.status === 403) && retry && session?.refresh_token) {
    const renewed = await refreshSession(session);
    if (renewed) {
      session = renewed;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return api(options, false);
    }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Handlingen kunne ikke gennemføres.');
  return data;
}

function notify(message, type = '') {
  const node = $('customerAdminStatus');
  node.textContent = message;
  node.className = `show ${type}`;
  setTimeout(() => { if (node.textContent === message) node.className = ''; }, 4200);
}

const dateTime = value => value ? new Intl.DateTimeFormat('da-DK', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)) : 'Ikke registreret';
const codeLabel = (kind, scope = 'team') => kind === 'viewer' ? 'Tavlekode' : (scope === 'club' ? 'Redigeringskode' : 'Personalekode');
const auditTargetLabel = value => {
  const target = String(value || '');
  if (target.startsWith('deleted_team:')) return target.slice(13);
  if (target.startsWith('club:')) {
    const [, slug, detail] = target.split(':');
    const suffix = detail === 'viewer' ? ' · Tavlekode' : detail === 'editor' ? ' · Redigeringskode' : '';
    return `Klubtavle ${slug}${suffix}`;
  }
  return target === 'team' ? 'Tavle' : codeLabel(target);
};
const actionLabels = {
  board_created:'Tavle oprettet', code_revealed:'Kode vist', code_changed:'Kode ændret',
  team_updated:'Tavleoplysninger ændret', activation_sent:'Aktiveringslink sendt', password_reset_sent:'Nulstillingslink sendt',
  board_deleted:'Tavle slettet', club_created:'Klubtavle oprettet', club_activation_sent:'Aktiveringslink til klub sendt',
  club_password_reset_sent:'Nulstillingslink til klub sendt', club_code_changed:'Klubbens kode ændret',
  club_code_revealed:'Klubbens kode vist', club_updated:'Kluboplysninger ændret', club_deleted:'Klubtavle slettet'
};

function credentialHtml(item, kind, scope = 'team') {
  const hasCode = item[`has_${kind}_code`];
  const changed = item[`${kind}_changed_at`];
  const minimum = kind === 'viewer' ? 6 : 8;
  const resetAttribute = scope === 'club' ? 'data-reset-club-code' : 'data-reset-code';
  const label = codeLabel(kind, scope);
  return `<section class="credential-row" data-credential="${kind}"><div class="credential-title"><strong>${label}</strong><span class="credential-value">${hasCode ? '••••••••' : 'Ikke tilgængelig endnu'}</span></div><small>${hasCode ? `Senest ændret ${dateTime(changed)}` : 'Vælg en ny kode én gang for at gøre den synlig her.'}</small><div class="credential-actions">${hasCode ? `<button class="reveal-code" data-action="reveal-code" data-scope="${scope}" data-kind="${kind}" type="button">Vis kode</button>` : ''}</div><form class="credential-reset" ${resetAttribute}="${kind}"><input name="value" type="password" minlength="${minimum}" placeholder="Ny ${label.toLowerCase()} – mindst ${minimum} tegn" required><button type="submit">Vælg ny</button></form></section>`;
}

function boardHtml(team) {
  const active = team.onboarding_status === 'active';
  const path = team.public_path || `/${team.slug}`;
  return `<article class="customer-board" data-team="${esc(team.slug)}"><div class="board-head"><div><h3>${esc(team.name)}</h3><code>visuplanner.dk${esc(path)}</code></div><span class="badge ${active ? '' : 'pending'}">${active ? 'Aktiv' : 'Afventer aktivering'}</span></div><div class="board-meta"><span>${esc(team.workplace)} · ${esc(team.municipality)}</span><span>Ansvarlig: ${esc(team.recovery_email)}</span></div><div class="credential-list">${credentialHtml(team,'viewer')}${credentialHtml(team,'editor')}</div><div class="board-actions"><a href="${esc(path)}" target="_blank" rel="noopener">Åbn tavle</a>${active ? '<button data-action="send-editor-reset" type="button">Send nulstillingslink</button>' : '<button data-action="send-invite" type="button">Send aktiveringslink igen</button>'}<button data-action="delete-board" class="danger" type="button">Slet tavle</button></div><details class="team-edit"><summary>Ret tavlenavn og kontakt</summary><form data-save-team class="field-grid"><label>Tavlenavn<input name="name" value="${esc(team.name)}" required></label><label>Ansvarlig mail<input name="recovery_email" type="email" value="${esc(team.recovery_email)}" required></label><label>Arbejdsplads<input name="workplace" value="${esc(team.workplace)}" required></label><div class="form-actions"><button type="submit">Gem oplysninger</button></div></form></details></article>`;
}

function clubHtml(offer) {
  const active = offer.onboarding_status === 'active';
  return `<article class="customer-board offer-card" data-offer="${esc(offer.id)}"><div class="board-head"><div><h3>${esc(offer.name)}</h3><code>visuplanner.dk${esc(offer.public_path)}</code></div><span class="badge ${active ? '' : 'pending'}">${active ? 'Aktiv' : 'Afventer aktivering'}</span></div><div class="board-meta"><span>${esc(offer.workplace || '')} · ${esc(dashboard.customer.municipality || '')}</span><span>Ansvarlig: ${esc(offer.recovery_email || '')}</span></div><div class="credential-list">${credentialHtml(offer,'viewer','club')}${credentialHtml(offer,'editor','club')}</div><div class="board-actions">${active ? `<a href="${esc(offer.public_path)}" target="_blank" rel="noopener">Åbn klubtavle</a><button data-club-action="send-club-reset" type="button">Send nulstillingslink</button>` : '<button data-club-action="send-club-invite" type="button">Send aktiveringslink igen</button>'}<button data-club-action="delete-club" class="danger" type="button">Slet klubtavle</button></div><details class="team-edit"><summary>Ret klubnavn og kontakt</summary><form data-save-club class="field-grid"><label>Klubnavn<input name="name" value="${esc(offer.name)}" required></label><label>Ansvarlig mail<input name="recovery_email" type="email" value="${esc(offer.recovery_email || '')}" required></label><label>Arbejdsplads<input name="workplace" value="${esc(offer.workplace || '')}" required></label><div class="form-actions"><button type="submit">Gem oplysninger</button></div></form></details></article>`;
}

function render() {
  const { customer, currentAdmin, teams, remainingBoards, canCreateBoards, admins, logs, offers } = dashboard;
  $('customerAdminCustomerName').textContent = `${customer.name} – administration`;
  $('customerAdminIdentity').textContent = `Logget ind som ${currentAdmin.name} · ${currentAdmin.email}`;
  $('customerAdminCapacity').textContent = `${teams.length} af ${customer.board_limit} tavler oprettet`;
  $('customerAdminRemaining').textContent = remainingBoards === 1 ? '1 tavle tilbage' : `${remainingBoards} tavler tilbage`;
  $('customerAdminCapacityBar').style.width = `${Math.min(100, customer.board_limit ? teams.length / customer.board_limit * 100 : 0)}%`;
  $('createBoardPanel').hidden = !canCreateBoards;
  const createForm = $('customerCreateBoardForm');
  if (!createForm.elements.workplace.value) createForm.elements.workplace.value = customer.name;
  $('customerAdminBoards').innerHTML = teams.length ? teams.map(boardHtml).join('') : '<p class="empty">Ingen tavler er oprettet endnu.</p>';
  $('customerAdminColleagues').innerHTML = admins.map(admin => `<div class="admin-person"><strong>${esc(admin.name)}</strong><span>${esc(admin.email)}</span></div>`).join('');
  $('customerAdminHelp').href = `mailto:wiltrup@wiltrup.com?subject=${encodeURIComponent(`Hjælp til VisuPlanner – ${customer.name}`)}&body=${encodeURIComponent(`Hej Techus Nord\n\nJeg har brug for hjælp til VisuPlanner.\n\nKunde: ${customer.name}\n\n`)}`;
  $('customerAdminAudit').innerHTML = logs.length ? logs.map(item => `<div class="audit-row"><div><strong>${esc(actionLabels[item.action] || item.action)}</strong><span>${item.team_slug ? ` · ${esc(item.team_slug)}` : ''}${item.target_kind ? ` · ${esc(auditTargetLabel(item.target_kind))}` : ''}</span></div><div><span>${esc(item.admin_name || item.admin_email || '')}</span><time>${dateTime(item.created_at)}</time></div></div>`).join('') : '<p class="empty">Ingen administratorhandlinger endnu.</p>';
  $('customerAdminOffersSection').hidden = !customer.club_module_enabled;
  $('customerAdminOffers').innerHTML = offers.length ? offers.map(clubHtml).join('') : '<p class="empty">Ingen klubtavler er oprettet endnu.</p>';
  if (customer.club_module_enabled) {
    const clubForm = $('customerCreateClubForm');
    if (!clubForm.elements.workplace.value) clubForm.elements.workplace.value = customer.name;
    $('customerClubTeams').innerHTML = teams.map(team => `<label><input type="checkbox" name="team_slugs" value="${esc(team.slug)}" checked> ${esc(team.name)}</label>`).join('') || '<p class="empty">Opret mindst én teamtavle for at vise klubindhold dér.</p>';
  }
  bindDashboardActions();
}

async function loadDashboard() {
  dashboard = await api();
  $('customerAdminLogin').hidden = true;
  $('customerAdminDashboard').hidden = false;
  render();
  resetInactivity();
}

async function post(body) {
  return api({ method:'POST', body:JSON.stringify(body) });
}

function bindDashboardActions() {
  document.querySelectorAll('[data-action="reveal-code"]').forEach(button => button.onclick = async () => {
    const scope = button.dataset.scope === 'club' ? 'club' : 'team';
    const board = button.closest(scope === 'club' ? '[data-offer]' : '[data-team]');
    const row = button.closest('[data-credential]');
    button.disabled = true;
    try {
      const result = await post(scope === 'club'
        ? { action:'reveal-club-code', offer_id:board.dataset.offer, kind:button.dataset.kind }
        : { action:'reveal-code', team_slug:board.dataset.team, kind:button.dataset.kind });
      const value = row.querySelector('.credential-value');
      value.textContent = result.value;
      const copy = document.createElement('button');
      copy.type = 'button'; copy.textContent = 'Kopiér';
      copy.onclick = async () => { await navigator.clipboard.writeText(result.value); notify('Koden er kopieret.'); };
      row.querySelector('.credential-actions').appendChild(copy);
      button.textContent = 'Skjul kode'; button.disabled = false;
      let visible = true;
      const hide = () => { value.textContent = '••••••••'; copy.remove(); button.textContent = 'Vis kode'; visible = false; button.onclick = null; loadDashboard().catch(() => {}); };
      button.onclick = () => visible && hide();
      setTimeout(() => { if (visible) hide(); }, 30000);
    } catch (error) { notify(error.message,'error'); button.disabled = false; }
  });
  document.querySelectorAll('[data-reset-code]').forEach(form => form.onsubmit = async event => {
    event.preventDefault();
    const board = form.closest('[data-team]');
    const kind = form.dataset.resetCode;
    const value = new FormData(form).get('value');
    if (!confirm(`Vælg den nye ${codeLabel(kind).toLowerCase()} til ${board.querySelector('h3').textContent}?`)) return;
    const button = event.submitter; button.disabled = true;
    try { await post({ action:'reset-code', team_slug:board.dataset.team, kind, value }); notify(`${codeLabel(kind)}n er ændret.`); await loadDashboard(); }
    catch (error) { notify(error.message,'error'); button.disabled = false; }
  });
  document.querySelectorAll('[data-save-team]').forEach(form => form.onsubmit = async event => {
    event.preventDefault(); const board = form.closest('[data-team]'); const values = Object.fromEntries(new FormData(form)); const button = event.submitter; button.disabled = true;
    try { await post({ action:'save-team', team_slug:board.dataset.team, ...values }); notify('Tavleoplysningerne er gemt.'); await loadDashboard(); }
    catch (error) { notify(error.message,'error'); button.disabled = false; }
  });
  document.querySelectorAll('[data-save-club]').forEach(form => form.onsubmit = async event => {
    event.preventDefault(); const card = form.closest('[data-offer]'); const values = Object.fromEntries(new FormData(form)); const button = event.submitter; button.disabled = true;
    try { await post({ action:'save-club', offer_id:card.dataset.offer, ...values }); notify('Kluboplysningerne er gemt.'); await loadDashboard(); }
    catch (error) { notify(error.message,'error'); button.disabled = false; }
  });
  document.querySelectorAll('[data-action="send-invite"],[data-action="send-editor-reset"]').forEach(button => button.onclick = async () => {
    const board = button.closest('[data-team]'); button.disabled = true;
    try { const result = await post({ action:button.dataset.action, team_slug:board.dataset.team }); if (result.inviteUrl && !result.mailSent) await navigator.clipboard.writeText(result.inviteUrl).catch(() => {}); notify(result.mailSent ? 'Linket er sendt.' : 'Mail kunne ikke sendes. Linket er kopieret.'); await loadDashboard(); }
    catch (error) { notify(error.message,'error'); button.disabled = false; }
  });
  document.querySelectorAll('[data-action="delete-board"]').forEach(button => button.onclick = async () => {
    const board = button.closest('[data-team]');
    const name = board.querySelector('h3').textContent;
    if (!confirm(`Slet ${name} permanent? Alle ugeplaner, billeder, lyd, koder og login til denne tavle bliver slettet. Handlingen kan ikke fortrydes.`)) return;
    if (prompt('Skriv SLET TAVLE for at bekræfte:') !== 'SLET TAVLE') return;
    button.disabled = true;
    try {
      await post({ action:'delete-board', team_slug:board.dataset.team, confirmation:'SLET TAVLE' });
      notify(`${name} er slettet. Pladsen er frigivet i pakken.`);
      await loadDashboard();
    } catch (error) { notify(error.message,'error'); button.disabled = false; }
  });
  document.querySelectorAll('[data-club-action]').forEach(button => button.onclick = async () => {
    const card = button.closest('[data-offer]');
    const action = button.dataset.clubAction;
    if (action === 'delete-club') {
      const name = card.querySelector('h3').textContent;
      if (!confirm(`Slet ${name} permanent? Alt klubindhold, billeder, tilmeldinger, koder og login bliver slettet. Handlingen kan ikke fortrydes.`)) return;
      if (prompt('Skriv SLET KLUBTAVLE for at bekræfte:') !== 'SLET KLUBTAVLE') return;
    }
    button.disabled = true;
    try {
      const result = await post({ action, offer_id:card.dataset.offer, ...(action === 'delete-club' ? { confirmation:'SLET KLUBTAVLE' } : {}) });
      if (action === 'delete-club') { notify('Klubtavlen er slettet.'); await loadDashboard(); return; }
      if (result.inviteUrl && !result.mailSent) await navigator.clipboard.writeText(result.inviteUrl).catch(() => {});
      notify(result.mailSent ? 'Linket er sendt.' : 'Mail kunne ikke sendes. Linket er kopieret.');
      await loadDashboard();
    } catch (error) { notify(error.message, 'error'); button.disabled = false; }
  });
  document.querySelectorAll('[data-reset-club-code]').forEach(form => form.onsubmit = async event => {
    event.preventDefault();
    const card = form.closest('[data-offer]');
    const kind = form.dataset.resetClubCode;
    const value = new FormData(form).get('value');
    if (!confirm(`Vælg en ny ${kind === 'viewer' ? 'tavlekode' : 'redigeringskode'} til klubben?`)) return;
    const button = event.submitter; button.disabled = true;
    try { await post({ action:'reset-club-code', offer_id:card.dataset.offer, kind, value }); notify(`${codeLabel(kind,'club')}n er ændret.`); await loadDashboard(); }
    catch (error) { notify(error.message, 'error'); button.disabled = false; }
  });
}

$('customerAdminLoginForm').onsubmit = async event => {
  event.preventDefault(); $('customerAdminLoginError').textContent = '';
  const button = event.submitter; button.disabled = true;
  try {
    session = await signIn($('customerAdminEmail').value.trim(), $('customerAdminPassword').value);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    $('customerAdminPassword').value = '';
    await loadDashboard();
  } catch (error) { session = null; sessionStorage.removeItem(SESSION_KEY); $('customerAdminLoginError').textContent = error.message; button.disabled = false; }
};

$('customerAdminForgotForm').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    await fetch('/api/customer-admin?flow=access', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'request-reset', email:$('customerAdminForgotEmail').value.trim() }) });
    $('customerAdminForgotStatus').textContent = 'Hvis mailen er registreret, er der sendt et nulstillingslink.';
  } finally { button.disabled = false; }
};

async function logout() {
  if (session?.access_token) await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, { method:'POST', headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${session.access_token}` } }).catch(() => {});
  session = null; sessionStorage.removeItem(SESSION_KEY); location.reload();
}

function resetInactivity() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => { notify('Du blev logget ud efter 30 minutters inaktivitet.'); setTimeout(logout, 900); }, 30 * 60 * 1000);
}

$('customerAdminLogout').onclick = logout;
$('customerAdminReload').onclick = () => loadDashboard().then(() => notify('Oversigten er opdateret.')).catch(error => notify(error.message,'error'));
$('customerAdminReloadClubs').onclick = () => loadDashboard().then(() => notify('Oversigten er opdateret.')).catch(error => notify(error.message,'error'));
$('customerCreateBoardForm').onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget; const button = event.submitter; button.disabled = true; const values = Object.fromEntries(new FormData(form));
  try {
    const result = await post({ action:'create-board', ...values });
    if (result.inviteUrl && !result.mailSent) await navigator.clipboard.writeText(result.inviteUrl).catch(() => {});
    form.elements.name.value = ''; form.elements.recovery_email.value = ''; form.elements.slug.value = '';
    const addressNote = result.slugAdjusted ? ` Adressen blev ændret til visuplanner.dk${result.publicPath}, fordi ønsket var optaget eller reserveret.` : '';
    notify((result.mailSent ? 'Tavlen er oprettet, og aktiveringslinket er sendt.' : 'Tavlen er oprettet. Aktiveringslinket er kopieret.') + addressNote);
    $('customerBoardSlugStatus').textContent = 'Skriv fx team 1 eller /team-1. Systemet indsætter selv bindestreger og vælger en unik adresse.';
    await loadDashboard();
  } catch (error) { notify(error.message,'error'); button.disabled = false; }
};

{
  const input = $('customerCreateBoardForm').elements.slug;
  const note = $('customerBoardSlugStatus');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!input.value.trim()) {
        note.textContent = 'Feltet er tomt – systemet vælger automatisk en sikker, unik adresse.';
        return;
      }
      try {
        const result = await post({ action:'check-slug', value:input.value });
        input.value = `/${result.slug}`;
        note.textContent = result.available
          ? `visuplanner.dk/${dashboard.customer.url_slug}/${result.slug} er ledig.`
          : `Den ønskede adresse er optaget. Vi foreslår visuplanner.dk/${dashboard.customer.url_slug}/${result.slug}.`;
      } catch (error) { note.textContent = error.message; }
    }, 450);
  });
}

$('customerCreateClubForm').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  button.disabled = true;
  const data = new FormData(form);
  const payload = Object.fromEntries(data);
  payload.action = 'create-shared-offer';
  payload.team_slugs = data.getAll('team_slugs');
  try {
    const result = await post(payload);
    const changed = result.slugAdjusted ? ` Adressen blev justeret til visuplanner.dk${result.publicPath}.` : '';
    if (result.inviteUrl && !result.mailSent) await navigator.clipboard.writeText(result.inviteUrl).catch(() => {});
    notify(`${result.mailSent ? 'Klubtavlen er oprettet, og aktiveringslinket er sendt.' : 'Klubtavlen er oprettet. Aktiveringslinket er kopieret.'}${changed}`);
    form.reset();
    await loadDashboard();
  } catch (error) { notify(error.message, 'error'); button.disabled = false; }
};

{
  const input = $('customerCreateClubForm').elements.slug;
  const note = $('customerClubSlugStatus');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!input.value.trim()) return note.textContent = 'Feltet er tomt – systemet bruger klubbens navn.';
      try {
        const result = await post({ action:'check-slug', value:input.value });
        input.value = result.slug;
        note.textContent = result.available ? `visuplanner.dk/${dashboard.customer.url_slug}/${result.slug} er ledig.` : `Vi foreslår visuplanner.dk/${dashboard.customer.url_slug}/${result.slug}.`;
      } catch (error) { note.textContent = error.message; }
    }, 450);
  });
}

['pointerdown','keydown'].forEach(name => document.addEventListener(name, () => { if (session) resetInactivity(); }, { passive:true }));

(async function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    session = await refreshSession(saved);
    if (!session) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    await loadDashboard();
  } catch { session = null; sessionStorage.removeItem(SESSION_KEY); }
})();
