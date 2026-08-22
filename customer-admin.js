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
const codeLabel = kind => kind === 'viewer' ? 'Tavlekode' : 'Personalekode';
const actionLabels = {
  board_created:'Tavle oprettet', code_revealed:'Kode vist', code_changed:'Kode ændret',
  team_updated:'Tavleoplysninger ændret', activation_sent:'Aktiveringslink sendt', password_reset_sent:'Nulstillingslink sendt'
};

function credentialHtml(team, kind) {
  const hasCode = team[`has_${kind}_code`];
  const changed = team[`${kind}_changed_at`];
  const minimum = kind === 'viewer' ? 6 : 8;
  return `<section class="credential-row" data-credential="${kind}"><div class="credential-title"><strong>${codeLabel(kind)}</strong><span class="credential-value">${hasCode ? '••••••••' : 'Ikke tilgængelig endnu'}</span></div><small>${hasCode ? `Senest ændret ${dateTime(changed)}` : 'Vælg en ny kode for at gøre den synlig her.'}</small><div class="credential-actions">${hasCode ? `<button class="reveal-code" data-action="reveal-code" data-kind="${kind}" type="button">Vis kode</button>` : ''}</div><form class="credential-reset" data-reset-code="${kind}"><input name="value" type="password" minlength="${minimum}" placeholder="Ny ${codeLabel(kind).toLowerCase()} – mindst ${minimum} tegn" required><button type="submit">Vælg ny</button></form></section>`;
}

function boardHtml(team) {
  const active = team.onboarding_status === 'active';
  return `<article class="customer-board" data-team="${esc(team.slug)}"><div class="board-head"><div><h3>${esc(team.name)}</h3><code>visuplanner.dk/${esc(team.slug)}</code></div><span class="badge ${active ? '' : 'pending'}">${active ? 'Aktiv' : 'Afventer aktivering'}</span></div><div class="board-meta"><span>${esc(team.workplace)} · ${esc(team.municipality)}</span><span>Ansvarlig: ${esc(team.recovery_email)}</span></div><div class="credential-list">${credentialHtml(team,'viewer')}${credentialHtml(team,'editor')}</div><div class="board-actions"><a href="/${esc(team.slug)}" target="_blank" rel="noopener">Åbn tavle</a>${active ? '<button data-action="send-editor-reset" type="button">Send nulstillingslink</button>' : '<button data-action="send-invite" type="button">Send aktiveringslink igen</button>'}</div><details class="team-edit"><summary>Ret tavlenavn og kontakt</summary><form data-save-team class="field-grid"><label>Tavlenavn<input name="name" value="${esc(team.name)}" required></label><label>Ansvarlig mail<input name="recovery_email" type="email" value="${esc(team.recovery_email)}" required></label><label>Arbejdsplads<input name="workplace" value="${esc(team.workplace)}" required></label><label>Kommune<input name="municipality" value="${esc(team.municipality)}" required></label><div class="form-actions"><button type="submit">Gem oplysninger</button></div></form></details></article>`;
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
  if (!createForm.elements.municipality.value) createForm.elements.municipality.value = customer.municipality || '';
  $('customerAdminBoards').innerHTML = teams.length ? teams.map(boardHtml).join('') : '<p class="empty">Ingen tavler er oprettet endnu.</p>';
  $('customerAdminColleagues').innerHTML = admins.map(admin => `<div class="admin-person"><strong>${esc(admin.name)}</strong><span>${esc(admin.email)}</span></div>`).join('');
  $('customerAdminAudit').innerHTML = logs.length ? logs.map(item => `<div class="audit-row"><div><strong>${esc(actionLabels[item.action] || item.action)}</strong><span>${item.team_slug ? ` · ${esc(item.team_slug)}` : ''}${item.target_kind ? ` · ${esc(codeLabel(item.target_kind))}` : ''}</span></div><div><span>${esc(item.admin_name || item.admin_email || '')}</span><time>${dateTime(item.created_at)}</time></div></div>`).join('') : '<p class="empty">Ingen administratorhandlinger endnu.</p>';
  $('customerAdminOffersSection').hidden = !offers.length;
  $('customerAdminOffers').innerHTML = offers.map(offer => `<article class="offer-card"><h3>${esc(offer.name)}</h3><a href="/${esc(offer.customer_slug || '')}/${esc(offer.slug)}" target="_blank" rel="noopener">Åbn tavle</a></article>`).join('');
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
    const board = button.closest('[data-team]');
    const row = button.closest('[data-credential]');
    button.disabled = true;
    try {
      const result = await post({ action:'reveal-code', team_slug:board.dataset.team, kind:button.dataset.kind });
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
  document.querySelectorAll('[data-action="send-invite"],[data-action="send-editor-reset"]').forEach(button => button.onclick = async () => {
    const board = button.closest('[data-team]'); button.disabled = true;
    try { const result = await post({ action:button.dataset.action, team_slug:board.dataset.team }); if (result.inviteUrl && !result.mailSent) await navigator.clipboard.writeText(result.inviteUrl).catch(() => {}); notify(result.mailSent ? 'Linket er sendt.' : 'Mail kunne ikke sendes. Linket er kopieret.'); await loadDashboard(); }
    catch (error) { notify(error.message,'error'); button.disabled = false; }
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
$('customerCreateBoardForm').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const result = await post({ action:'create-board', ...values });
    if (result.inviteUrl && !result.mailSent) await navigator.clipboard.writeText(result.inviteUrl).catch(() => {});
    event.currentTarget.elements.name.value = ''; event.currentTarget.elements.recovery_email.value = ''; event.currentTarget.elements.slug.value = '';
    notify(result.mailSent ? 'Tavlen er oprettet, og aktiveringslinket er sendt.' : 'Tavlen er oprettet. Aktiveringslinket er kopieret.');
    await loadDashboard();
  } catch (error) { notify(error.message,'error'); button.disabled = false; }
};

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
