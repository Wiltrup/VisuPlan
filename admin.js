const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
let session = null;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const slugify = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kunde';
const planLabels = { intro3:'Op til 3 tavler', intro8:'Op til 8 tavler', intro12:'Op til 12 tavler', custom:'Skræddersyet', legacy:'Eksisterende kunde' };
const statusLabels = { trial:'Prøveperiode', contracted:'Aftale indgået', invoice_sent:'Faktura sendt', active:'Betalt og aktiv', overdue:'Forfalden', read_only:'Kun visning', cancelled:'Opsagt' };

async function auth(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:'POST',
    headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error('Forkert administratorlogin.');
  return response.json();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers:{ Authorization:`Bearer ${session.access_token}`, 'Content-Type':'application/json', ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Handlingen kunne ikke gennemføres.');
  return result;
}

function status(message, type = '') {
  const node = $('adminStatus');
  node.textContent = message;
  node.className = type;
  setTimeout(() => { if (node.textContent === message) node.textContent = ''; }, 4500);
}

const date = value => value ? new Intl.DateTimeFormat('da-DK', { dateStyle:'medium' }).format(new Date(value)) : 'Ikke fastsat';
const dateTime = value => value ? new Intl.DateTimeFormat('da-DK', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)) : 'Ikke fastsat';
const inputDate = value => value ? String(value).slice(0, 10) : '';
const daysUntil = value => value ? Math.ceil((new Date(value) - new Date()) / 86400000) : null;
const fieldValue = (root, name) => root.querySelector(`[data-field="${name}"]`)?.value.trim() || '';
const activationGraceEndsAt = customer => customer.subscription_interest_at && customer.trial_started_at
  ? new Date(new Date(customer.trial_started_at).getTime() + 25 * 86400000).toISOString()
  : null;

function planOptions(selected = 'intro3') {
  return Object.entries(planLabels).filter(([key]) => key !== 'legacy').map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function summaryHtml(customers) {
  const boards = customers.reduce((sum, customer) => sum + customer.teams.length, 0);
  const trials = customers.filter(customer => customer.subscription_status === 'trial').length;
  const active = customers.filter(customer => ['contracted','invoice_sent','active','overdue'].includes(customer.subscription_status)).length;
  const attention = customers.filter(customer => needsAttention(customer)).length;
  return [
    ['Kunder', customers.length],
    ['Tavler', boards],
    ['Aktive aftaler', active],
    ['Kræver blik', attention]
  ].map(([label, value]) => `<article class="summary-card"><strong>${value}</strong><span>${label}</span></article>`).join('');
}

function needsAttention(customer) {
  const renewalDays = daysUntil(customer.subscription_renews_at);
  const trialDays = daysUntil(customer.trial_ends_at);
  return Boolean(customer.subscription_status === 'trial' && customer.subscription_interest_at) ||
    (customer.subscription_status === 'trial' && trialDays !== null && trialDays <= 4) ||
    (renewalDays !== null && renewalDays <= 45);
}

function attentionHtml(customer) {
  const renewalDays = daysUntil(customer.subscription_renews_at);
  const trialDays = daysUntil(customer.trial_ends_at);
  const graceEnd = activationGraceEndsAt(customer);
  const graceDays = daysUntil(graceEnd);
  let text = 'Kunden har bedt om kontakt om betaling og aktivering.';
  if (customer.subscription_status === 'trial' && customer.subscription_interest_at) text = graceDays === null
    ? 'Aktivering er anmodet. Prøvens startdato mangler og bør kontrolleres.'
    : graceDays < 0
      ? 'Aktivering er anmodet, men fristen på dag 25 er udløbet.'
      : `Aktivering er anmodet. Redigering er mulig i ${graceDays} ${graceDays === 1 ? 'dag' : 'dage'} endnu – til ${date(graceEnd)}.`;
  if (!customer.subscription_interest_at && customer.subscription_status === 'trial') text = trialDays < 0 ? 'Prøveperioden er udløbet.' : `Prøveperioden udløber om ${trialDays} dage.`;
  if (!customer.subscription_interest_at && renewalDays !== null && renewalDays <= 45) text = renewalDays < 0 ? 'Årsfornyelsen er overskredet.' : `Årsfornyelsen nærmer sig om ${renewalDays} dage.`;
  return `<article class="attention-card"><div><strong>${esc(customer.display_name)}</strong><p>${esc(text)}</p></div><span class="status-badge ${esc(customer.subscription_status)}">${esc(statusLabels[customer.subscription_status] || customer.subscription_status)}</span></article>`;
}

function teamCard(team, archived = false) {
  if (archived) return `<article class="board-card" data-team="${esc(team.slug)}"><div class="board-title"><div><h5>${esc(team.name)}</h5><code>/${esc(team.slug)}</code></div><span class="status-badge read_only">Arkiveret</span></div><p>${esc(team.workplace)} · ${esc(team.municipality)}</p><div class="board-actions"><button data-team-action="delete-team" class="danger">Slet permanent</button></div></article>`;
  return `<article class="board-card" data-team="${esc(team.slug)}">
    <div class="board-title"><div><h5>${esc(team.name)}</h5><code>visuplanner.dk/${esc(team.slug)}</code></div><span class="status-badge ${team.onboarding_status === 'active' ? '' : 'trial'}">${team.onboarding_status === 'active' ? 'Aktiv tavle' : 'Afventer aktivering'}</span></div>
    <div class="field-grid">
      <label>Tavlenavn<input data-field="name" value="${esc(team.name)}"></label>
      <label>Arbejdsplads<input data-field="workplace" value="${esc(team.workplace)}"></label>
      <label>Kommune<input data-field="municipality" value="${esc(team.municipality)}"></label>
      <label>Ansvarlig arbejdsmail<input data-field="recovery_email" type="email" value="${esc(team.recovery_email)}"></label>
    </div>
    <p class="slug-note">Visningsnavne kan rettes frit. Tavleadressen ændres ikke automatisk.</p>
    <div class="board-actions">
      <a data-board-link href="/${esc(team.slug)}">Åbn tavle</a>
      <button data-team-action="save-team">Gem navne og kontakt</button>
      ${team.onboarding_status !== 'active' ? '<button data-team-action="resend-invite">Send invitation igen</button>' : ''}
      <button data-team-action="send-reset-editor">Send nulstillingslink</button>
      <button data-team-action="archive-team" class="danger">Arkivér tavle</button>
    </div>
    <details><summary>Nødhjælp: sæt midlertidige koder</summary>
      <div class="field-grid two"><label>Ny personalekode<input data-field="editor_password" type="password" minlength="8"></label><label>Ny tavlekode<input data-field="viewer_password" type="password" minlength="6"></label></div>
      <div class="board-actions"><button data-team-action="reset-editor">Sæt personalekode</button><button data-team-action="reset-viewer">Sæt tavlekode</button><button data-team-action="delete-team" class="danger">Slet tavlen permanent</button></div>
    </details>
  </article>`;
}

function teamLinkOptions(customer, selected = []) {
  const chosen = new Set(selected);
  return customer.teams.map(team => `<label class="offer-team-choice"><input type="checkbox" data-offer-team value="${esc(team.slug)}" ${chosen.has(team.slug) ? 'checked' : ''}><span>${esc(team.name)}</span></label>`).join('') || '<p class="slug-note">Kunden har ingen aktive tavler.</p>';
}

function customerAdministratorSection(customer) {
  const admins = customer.customer_admins || [];
  const pending = (customer.customer_admin_invitations || []).filter(invite => invite.purpose === 'activation');
  const adminRows = admins.length ? admins.map(admin => `<article class="customer-admin-row ${admin.active ? '' : 'is-inactive'}" data-customer-admin="${esc(admin.id)}"><div><strong>${esc(admin.name)}</strong><span>${esc(admin.email)}</span><small>${admin.active ? 'Aktiv kundeadministrator' : 'Deaktiveret'}</small></div>${admin.active ? `<div class="board-actions"><button data-customer-admin-action="reset-customer-admin" type="button">Send nulstillingslink</button><button data-customer-admin-action="deactivate-customer-admin" class="danger" type="button">Deaktivér</button></div>` : '<div class="board-actions"><button data-customer-admin-action="reactivate-customer-admin" type="button">Genaktivér og send nyt link</button></div>'}</article>`).join('') : '<p class="slug-note">Ingen kundeadministratorer er aktiveret endnu.</p>';
  const pendingRows = pending.map(invite => `<article class="pending-admin-invite" data-customer-admin-invite="${esc(invite.id)}"><div><strong>Invitation afventer</strong><span>${esc(invite.name)} · ${esc(invite.email)}</span><small>Udløber ${dateTime(invite.expires_at)}</small></div><button data-customer-admin-invite-action="delete-customer-admin-invitation" class="danger" type="button">Slet invitation</button></article>`).join('');
  return `<section class="boards-block customer-admin-block"><h4>Kundeadministratorer</h4><p class="slug-note">Personlige administratorer kan kun administrere denne kundes egne tavler og fælleskoder.</p><div class="customer-admin-list">${adminRows}${pendingRows}</div><details><summary>Invitér kundeadministrator</summary><div class="inline-create customer-admin-create"><label>Navn<input data-new-admin="name" autocomplete="name"></label><label>Arbejdsmail<input data-new-admin="email" type="email" autocomplete="email"></label><button data-customer-action="invite-customer-admin" type="button">Send personlig invitation</button></div></details></section>`;
}

function sharedOfferCard(offer, customer) {
  const selected = (offer.team_links || []).map(link => link.team_slug);
  const customerSlug = offer.customer_slug || customer.url_slug || slugify(customer.display_name);
  const offerPath = `/${customerSlug}/${offer.slug}`;
  return `<article class="board-card shared-offer-card" data-offer="${esc(offer.id)}">
    <div class="board-title"><div><h5>${esc(offer.name)}</h5><code>visuplanner.dk${esc(offerPath)}</code></div><span class="status-badge">Fælles tilbud</span></div>
    <div class="field-grid">
      <label>Navn<input data-offer-field="name" value="${esc(offer.name)}"></label>
      <label>Arbejdsplads<input data-offer-field="workplace" value="${esc(offer.workplace)}"></label>
      <label>Kommune<input data-offer-field="municipality" value="${esc(offer.municipality)}"></label>
      <label>Ansvarlig arbejdsmail<input data-offer-field="recovery_email" type="email" value="${esc(offer.recovery_email)}"></label>
      <label class="toggle-setting"><input data-offer-field="own_board_enabled" type="checkbox" ${offer.own_board_enabled ? 'checked' : ''}><span><strong>Egen tavle</strong><small>Kan åbnes på tablet og af eksterne beboere.</small></span></label>
      <label class="toggle-setting"><input data-offer-field="registration_module_enabled" type="checkbox" ${offer.registration_module_enabled ? 'checked' : ''}><span><strong>Tilmeldingsmodul</strong><small>Viser kommende tilmeldingsaktiviteter på de tilknyttede teamtavler.</small></span></label>
    </div>
    <div class="offer-team-grid"><strong>Tilgængeligt for disse tavler</strong>${teamLinkOptions(customer, selected)}</div>
    <div class="board-actions"><a href="${esc(offerPath)}" target="_blank" rel="noopener">Åbn tilbudstavle</a><button data-offer-action="save-shared-offer">Gem tilbud og tilknytninger</button></div>
    <details><summary>Nødhjælp: skift tilbuddets koder</summary><div class="field-grid two"><label>Ny redigeringskode<input data-offer-field="editor_password" type="password" minlength="8"></label><label>Ny visningskode<input data-offer-field="viewer_password" type="password" minlength="6"></label></div><div class="board-actions"><button data-offer-action="reset-editor-code">Sæt redigeringskode</button><button data-offer-action="reset-viewer-code">Sæt visningskode</button></div></details>
  </article>`;
}

function customerCard(customer) {
  const graceEnd = activationGraceEndsAt(customer);
  const trialText = customer.subscription_status === 'trial'
    ? customer.subscription_interest_at
      ? `Aktiveringsfrist: ${date(graceEnd)} (dag 25)`
      : `Prøve slutter: ${date(customer.trial_ends_at)}`
    : `Fornyelse: ${date(customer.subscription_renews_at)}`;
  return `<article class="customer-card" data-customer="${esc(customer.id)}">
    <div class="customer-head"><div><h3>${esc(customer.display_name)}</h3><p>${esc(customer.legal_name || customer.municipality || '')}</p></div><span class="status-badge ${esc(customer.subscription_status)}">${esc(statusLabels[customer.subscription_status] || customer.subscription_status)}</span></div>
    <div class="customer-facts"><span>${esc(planLabels[customer.plan_code] || customer.plan_code)}</span><span>${customer.teams.length} af ${customer.board_limit} tavler</span><span>${esc(trialText)}</span>${customer.subscription_status === 'trial' && customer.subscription_interest_at ? '<span class="interest-flag">Aktivering anmodet</span>' : ''}</div>
    ${customerAdministratorSection(customer)}
    <details><summary>Kunde- og fakturaoplysninger</summary>
      <div class="field-grid">
        <label>Visningsnavn<input data-field="display_name" value="${esc(customer.display_name)}"></label>
        <label>Juridisk navn<input data-field="legal_name" value="${esc(customer.legal_name)}"></label>
        <label>Kommune<input data-field="municipality" value="${esc(customer.municipality)}"></label>
        <label>Kontaktperson<input data-field="contact_name" value="${esc(customer.contact_name)}"></label>
        <label>Kontaktmail<input data-field="contact_email" type="email" value="${esc(customer.contact_email)}"></label>
        <label>Fakturamail<input data-field="billing_email" type="email" value="${esc(customer.billing_email)}"></label>
        <label>Telefon<input data-field="phone" value="${esc(customer.phone)}"></label>
        <label>CVR<input data-field="cvr" value="${esc(customer.cvr)}"></label>
        <label>EAN<input data-field="ean" value="${esc(customer.ean)}"></label>
        <label>Fakturareference<input data-field="invoice_reference" value="${esc(customer.invoice_reference)}"></label>
        <label>Betalingsform<select data-field="payment_method"><option value="">Ikke valgt</option><option value="ean" ${customer.payment_method === 'ean' ? 'selected' : ''}>EAN</option><option value="card" ${customer.payment_method === 'card' ? 'selected' : ''}>Kort</option><option value="mobilepay" ${customer.payment_method === 'mobilepay' ? 'selected' : ''}>MobilePay</option><option value="bank" ${customer.payment_method === 'bank' ? 'selected' : ''}>Bank</option><option value="other" ${customer.payment_method === 'other' ? 'selected' : ''}>Andet</option></select></label>
        <label>Interne noter<textarea data-field="internal_notes" rows="3">${esc(customer.internal_notes)}</textarea></label>
      </div>
      <div class="action-row"><button data-customer-action="save-customer">Gem kundeoplysninger</button></div>
    </details>
    <details ${customer.subscription_status === 'trial' ? 'open' : ''}><summary>Pakke, prøveperiode og betaling</summary>
      <div class="field-grid">
        <label>Pakke<select data-field="plan_code">${planOptions(customer.plan_code === 'legacy' ? 'intro3' : customer.plan_code)}</select></label>
        <label>Tavlegrænse ved specialaftale<input data-field="board_limit" type="number" min="1" value="${customer.board_limit}"></label>
        <label>Introduktionspris, kr.<input data-field="intro_price_dkk" type="number" min="0" value="${customer.intro_price_dkk ?? ''}"></label>
        <label>Årspris derefter, kr.<input data-field="renewal_price_dkk" type="number" min="0" value="${customer.renewal_price_dkk ?? ''}"></label>
        <label>Fakturanummer<input data-field="invoice_number" value="${esc(customer.invoice_number)}"></label>
        <label>Betalingsfrist<input data-field="invoice_due_at" type="date" value="${inputDate(customer.invoice_due_at)}"></label>
        <label>Fakturatype<select data-field="invoice_kind"><option value="first">Første år</option><option value="renewal">Årsfornyelse</option></select></label>
        <label>Betalingsform<select data-field="invoice_payment_method"><option value="ean">EAN</option><option value="card">Kort</option><option value="mobilepay">MobilePay</option><option value="bank">Bank</option><option value="other">Andet</option></select></label>
      </div>
      <p class="slug-note">Den valgte pakke er allerede tilgængelig i prøveperioden. Brug kun pakkeændringen, når kunden senere skifter løsning.</p>
      <div class="action-row">
        <button data-customer-action="activate-subscription" class="secondary">Aktivér valgt pakkeændring</button>
        <button data-customer-action="extend-trial" class="secondary">Forlæng prøve 7 dage</button>
        <button data-customer-action="mark-invoice-sent" class="secondary">Markér faktura sendt</button>
        <button data-customer-action="mark-paid">Betaling modtaget</button>
        <button data-customer-action="set-read-only" class="warning">Lås redigering</button>
      </div>
    </details>
    <section class="boards-block"><h4>Tavler under samme betaler</h4><div class="board-list">${customer.teams.length ? customer.teams.map(team => teamCard(team)).join('') : '<p>Ingen tavler endnu.</p>'}</div>
      <details><summary>Opret endnu en tavle</summary>
        <div class="inline-create">
          <label>Tavlenavn<input data-new-board="name" placeholder="Fx Syd"></label>
          <label>Arbejdsplads<input data-new-board="workplace" value="${esc(customer.display_name)}"></label>
          <label>Kommune<input data-new-board="municipality" value="${esc(customer.municipality)}"></label>
          <label>Kontaktmail<input data-new-board="recovery_email" type="email" value="${esc(customer.contact_email)}"></label>
          <label>Ønsket slutning på URL<input data-new-board="slug" placeholder="/team-1"></label>
          <button data-customer-action="create-board">Opret og send aktiveringslink</button>
          <p class="slug-note" data-slug-status>Skriv fx team 1 eller /team-1. Systemet indsætter selv bindestreger og vælger en unik adresse. Skriv ikke hele visuplanner.dk-adressen.</p>
        </div>
      </details>
    </section>
    <section class="boards-block shared-offers-block"><h4>Fælles tilbud</h4><p class="slug-note">Et fælles tilbud redigeres ét sted og kan vises på flere af kundens tavler.</p><div class="board-list">${(customer.shared_offers || []).length ? customer.shared_offers.map(offer => sharedOfferCard(offer, customer)).join('') : '<p>Ingen fælles tilbud endnu.</p>'}</div>
      <details><summary>Opret fælles tilbud til kunden</summary><div class="inline-create shared-offer-create">
        <label>Navn<input data-new-offer="name" placeholder="Fx Trekløverets Klub"></label>
        <label>Arbejdsplads<input data-new-offer="workplace" value="${esc(customer.display_name)}"></label>
        <label>Kommune<input data-new-offer="municipality" value="${esc(customer.municipality)}"></label>
        <label>Kontaktmail<input data-new-offer="recovery_email" type="email" value="${esc(customer.contact_email)}"></label>
        <label>Ønsket adresse<input data-new-offer="slug" placeholder="trekloeverets-klub"></label>
        <label>Redigeringskode<input data-new-offer="editor_password" type="password" minlength="8"></label>
        <label>Visningskode<input data-new-offer="viewer_password" type="password" minlength="6"></label>
        <label class="toggle-setting"><input data-new-offer="own_board_enabled" type="checkbox" checked><span><strong>Opret egen klubtavle</strong><small>Kan bruges på klubbens tablet og af eksterne beboere.</small></span></label>
        <label class="toggle-setting"><input data-new-offer="registration_module_enabled" type="checkbox"><span><strong>Tilmeldingsmodul</strong><small>Valgfrit modul. Det kan også aktiveres senere på det enkelte klubtilbud.</small></span></label>
        <div class="offer-team-grid"><strong>Gør tilbuddet tilgængeligt for</strong>${teamLinkOptions(customer)}</div>
        <button data-customer-action="create-shared-offer">Opret fælles tilbud</button>
      </div></details>
    </section>
    <details class="customer-danger-zone"><summary>Arkivér kunden</summary><p>Alle kundens tavler og klubtilbud lukkes, men data og filer bevares. Kunden kan gendannes fra listen over arkiverede kunder.</p><button data-customer-action="archive-customer" class="danger">Arkivér hele kunden</button></details>
  </article>`;
}

function archivedCustomerCard(customer) {
  return `<article class="customer-card archived-customer-card" data-customer="${esc(customer.id)}">
    <div class="customer-head"><div><h3>${esc(customer.display_name)}</h3><p>Arkiveret ${dateTime(customer.archived_at)}</p></div><span class="status-badge read_only">Arkiveret kunde</span></div>
    <div class="customer-facts"><span>${customer.teams.length} tavler</span><span>${customer.shared_offers.length} klubtilbud</span><span>Indholdet er bevaret</span></div>
    <div class="action-row"><button data-customer-action="restore-customer">Gendan kunden</button><button data-customer-action="delete-customer" class="permanent-delete">Slet kunden permanent</button></div>
    <p class="archived-note">Permanent sletning fjerner alle kundens tavler, klubtilbud, ugeplaner, billeder, lydfiler og loginbrugere.</p>
  </article>`;
}

function requestCard(item) {
  return `<article class="request-card" data-request="${esc(item.id)}">
    <strong>${esc(item.workplace)}</strong> <span class="plan-label">${esc(planLabels[item.requested_plan] || 'Op til 3 tavler')}</span>
    <p>${esc(item.contact_name)} · <a href="mailto:${esc(item.contact_email)}">${esc(item.contact_email)}</a></p>
    <p>${esc(item.municipality)} · ${esc(item.workplace)} · ${Number(item.resident_count)} beboere</p>
    ${item.phone ? `<p>Tlf. ${esc(item.phone)}</p>` : ''}${item.notes ? `<p class="request-notes">${esc(item.notes)}</p>` : ''}
    <div class="request-form">
      <label>Kundenavn<input data-field="customer_name" value="${esc(item.workplace)}"></label>
      <label>Juridisk navn<input data-field="legal_name" value="${esc(item.workplace)}"></label>
      <label>Kommune<input data-field="municipality" value="${esc(item.municipality)}"></label>
      <label>Forventet pakke<select data-field="plan_code">${planOptions(item.requested_plan || 'intro3')}</select></label>
      <div class="request-actions"><button data-request-action="create">Opret prøvekunde og invitér administrator</button><button data-request-action="delete" class="secondary danger-text">Slet forespørgsel</button></div>
    </div>
    <small>Modtaget ${dateTime(item.created_at)}</small>
  </article>`;
}

async function openDashboard() {
  const data = await api('/api/platform-admin');
  $('adminLoginCard').hidden = true;
  $('adminDashboard').hidden = false;
  $('adminSummary').innerHTML = summaryHtml(data.customers);
  const attention = data.customers.filter(needsAttention);
  $('renewalSection').hidden = !attention.length;
  $('renewalCards').innerHTML = attention.map(attentionHtml).join('');
  $('onboardingRequests').innerHTML = data.onboarding.length ? data.onboarding.map(requestCard).join('') : '<p class="empty-requests">Ingen nye forespørgsler.</p>';
  $('customerCards').innerHTML = data.customers.length ? data.customers.map(customerCard).join('') : '<p class="empty-requests">Ingen kunder endnu.</p>';
  $('archivedCustomersSection').hidden = !data.archivedCustomers.length;
  $('archivedCustomerCards').innerHTML = data.archivedCustomers.map(archivedCustomerCard).join('');
  $('archivedSection').hidden = !data.archivedTeams.length;
  $('archivedTeamCards').innerHTML = data.archivedTeams.map(team => teamCard(team, true)).join('');
  $('accessHelpRequests').innerHTML = data.accessHelp.length ? data.accessHelp.map(item => `<article class="request-card"><strong>${esc(item.contact_name)}</strong><p><a href="mailto:${esc(item.contact_email)}">${esc(item.contact_email)}</a></p><p>Tavle: ${esc(item.team_slug)}</p><small>${dateTime(item.created_at)}</small></article>`).join('') : '<p class="empty-requests">Ingen anmodninger om hjælp.</p>';
  bindActions();
}

async function copyFallback(result, successText) {
  if (result.inviteUrl && !result.mailSent) {
    try { await navigator.clipboard.writeText(result.inviteUrl); } catch {}
    alert(`${successText}\n\nMail er ikke sat op. Linket er kopieret:\n${result.inviteUrl}`);
  }
}

function customerPayload(card, action) {
  const payload = { action, customerId:card.dataset.customer };
  if (action === 'save-customer') {
    ['display_name','legal_name','municipality','contact_name','contact_email','billing_email','phone','cvr','ean','invoice_reference','internal_notes','payment_method'].forEach(name => payload[name] = fieldValue(card, name));
  } else if (action === 'activate-subscription') {
    payload.plan_code = fieldValue(card, 'plan_code');
    payload.board_limit = Number(fieldValue(card, 'board_limit'));
    payload.intro_price_dkk = fieldValue(card, 'intro_price_dkk') === '' ? null : Number(fieldValue(card, 'intro_price_dkk'));
    payload.renewal_price_dkk = fieldValue(card, 'renewal_price_dkk') === '' ? null : Number(fieldValue(card, 'renewal_price_dkk'));
  } else if (action === 'extend-trial') payload.days = 7;
  else if (action === 'mark-invoice-sent') {
    payload.invoice_number = fieldValue(card, 'invoice_number');
    payload.invoice_due_at = fieldValue(card, 'invoice_due_at');
    payload.invoice_kind = fieldValue(card, 'invoice_kind');
    payload.payment_method = fieldValue(card, 'invoice_payment_method');
  } else if (action === 'create-board') {
    card.querySelectorAll('[data-new-board]').forEach(input => payload[input.dataset.newBoard] = input.value.trim());
  } else if (action === 'invite-customer-admin') {
    card.querySelectorAll('[data-new-admin]').forEach(input => payload[input.dataset.newAdmin] = input.value.trim());
  } else if (action === 'create-shared-offer') {
    const create = card.querySelector('.shared-offer-create');
    create.querySelectorAll('[data-new-offer]').forEach(input => payload[input.dataset.newOffer] = input.type === 'checkbox' ? input.checked : input.value.trim());
    payload.team_slugs = [...create.querySelectorAll('[data-offer-team]:checked')].map(input => input.value);
  } else if (action === 'delete-customer') {
    payload.confirmation = 'SLET KUNDE';
  }
  return payload;
}

function bindActions() {
  document.querySelectorAll('[data-customer-action]').forEach(button => button.onclick = async () => {
    const card = button.closest('[data-customer]');
    const action = button.dataset.customerAction;
    if (action === 'activate-subscription' && !confirm('Aktivér den valgte pakkeændring? Kundens tavlegrænse og priser opdateres med det samme.')) return;
    if (action === 'set-read-only' && !confirm('Lås kundens redigering? Tavlerne kan stadig ses.')) return;
    if (action === 'mark-paid' && !confirm('Bekræft, at betalingen er modtaget. Kunden får fuld adgang, og årsperioden aktiveres.')) return;
    if (action === 'archive-customer' && !confirm('Arkivér hele kunden? Alle kundens tavler og klubtilbud lukkes, men indholdet bevares.')) return;
    if (action === 'restore-customer' && !confirm('Gendan kunden og de tavler og klubtilbud, der blev lukket sammen med kunden?')) return;
    if (action === 'delete-customer') {
      if (!confirm('Dette sletter hele kunden permanent – inklusive alle tavler, klubtilbud, planer, billeder, lyd og loginbrugere. Handlingen kan ikke fortrydes.')) return;
      if (prompt('Skriv SLET KUNDE for at bekræfte:') !== 'SLET KUNDE') return;
    }
    button.disabled = true;
    try {
      const result = await api('/api/platform-admin', { method:'POST', body:JSON.stringify(customerPayload(card, action)) });
      await copyFallback(result, action === 'invite-customer-admin' ? 'Administratorinvitationen er oprettet.' : 'Tavlen er oprettet.');
      const messages = { 'create-board':'Tavlen er oprettet, og invitationen er sendt.', 'create-shared-offer':'Det fælles tilbud er oprettet.', 'invite-customer-admin':'Kundeadministratorens invitation er sendt.', 'archive-customer':'Kunden og alle tilknyttede tavler er arkiveret.', 'restore-customer':'Kunden er gendannet.', 'delete-customer':'Kunden og alle tilknyttede data er slettet permanent.' };
      const addressNote = action === 'create-board' && result.slugAdjusted
        ? ` Adressen blev ændret til visuplanner.dk/${result.team.slug}, fordi ønsket var optaget eller reserveret.`
        : '';
      status((messages[action] || 'Kundens aftale er opdateret.') + addressNote, 'success');
      await openDashboard();
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  });

  document.querySelectorAll('[data-customer-admin-action]').forEach(button => button.onclick = async () => {
    const customerCard = button.closest('[data-customer]');
    const adminRow = button.closest('[data-customer-admin]');
    const action = button.dataset.customerAdminAction;
    if (action === 'deactivate-customer-admin' && !confirm('Deaktivér denne kundeadministrator? Vedkommende mister straks adgang til kundeadministrationen.')) return;
    button.disabled = true;
    try {
      const result = await api('/api/platform-admin', { method:'POST', body:JSON.stringify({ action, customerId:customerCard.dataset.customer, admin_id:adminRow.dataset.customerAdmin }) });
      await copyFallback(result, 'Linket er oprettet.');
      status(action === 'deactivate-customer-admin' ? 'Kundeadministratoren er deaktiveret.' : action === 'reactivate-customer-admin' ? 'Kundeadministratoren er genaktiveret, og et nyt link er sendt.' : 'Nulstillingslinket er sendt.', 'success');
      await openDashboard();
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  });

  document.querySelectorAll('[data-customer-admin-invite-action]').forEach(button => button.onclick = async () => {
    const customerCard = button.closest('[data-customer]');
    const inviteRow = button.closest('[data-customer-admin-invite]');
    if (!confirm('Slet den afventende invitation? Linket stopper straks med at virke.')) return;
    button.disabled = true;
    try {
      await api('/api/platform-admin', { method:'POST', body:JSON.stringify({
        action:button.dataset.customerAdminInviteAction,
        customerId:customerCard.dataset.customer,
        invitation_id:inviteRow.dataset.customerAdminInvite
      }) });
      status('Den afventende administratorinvitation er slettet.', 'success');
      await openDashboard();
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  });

  document.querySelectorAll('[data-offer-action]').forEach(button => button.onclick = async () => {
    const offerCard = button.closest('[data-offer]');
    const customerCard = button.closest('[data-customer]');
    const action = button.dataset.offerAction;
    const payload = { customerId:customerCard.dataset.customer, offer_id:offerCard.dataset.offer };
    if (action === 'save-shared-offer') {
      payload.action = action;
      offerCard.querySelectorAll('[data-offer-field]').forEach(input => payload[input.dataset.offerField] = input.type === 'checkbox' ? input.checked : input.value.trim());
      payload.team_slugs = [...offerCard.querySelectorAll('[data-offer-team]:checked')].map(input => input.value);
    } else {
      payload.action = 'reset-shared-offer-code';
      payload.code_kind = action === 'reset-viewer-code' ? 'viewer' : 'editor';
      payload.value = offerCard.querySelector(`[data-offer-field="${payload.code_kind === 'viewer' ? 'viewer_password' : 'editor_password'}"]`)?.value || '';
      if (!confirm(`Sæt en ny ${payload.code_kind === 'viewer' ? 'visningskode' : 'redigeringskode'} til tilbuddet?`)) return;
    }
    button.disabled = true;
    try {
      await api('/api/platform-admin', { method:'POST', body:JSON.stringify(payload) });
      status(action === 'save-shared-offer' ? 'Tilbuddet og tilknytningerne er gemt.' : 'Koden er ændret.', 'success');
      await openDashboard();
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  });

  document.querySelectorAll('[data-team-action]').forEach(button => button.onclick = async () => {
    const card = button.closest('[data-team]');
    const action = button.dataset.teamAction;
    const payload = { action, slug:card.dataset.team };
    if (action === 'save-team') ['name','workplace','municipality','recovery_email'].forEach(name => payload[name] = fieldValue(card, name));
    if (action === 'reset-editor') payload.value = fieldValue(card, 'editor_password');
    if (action === 'reset-viewer') payload.value = fieldValue(card, 'viewer_password');
    if (action === 'archive-team' && !confirm('Arkivér tavlen? Den lukkes uden at indholdet slettes.')) return;
    if (action === 'delete-team') {
      if (!confirm('Slet tavlen permanent med data, filer og loginbrugere?')) return;
      if (prompt('Skriv SLET for at bekræfte:') !== 'SLET') return;
    }
    if (action.startsWith('reset-') && !confirm('Sæt den midlertidige kode efter aftale med kunden?')) return;
    button.disabled = true;
    try {
      const result = await api('/api/platform-admin', { method:'POST', body:JSON.stringify(payload) });
      await copyFallback(result, 'Linket er oprettet.');
      status(action === 'save-team' ? 'Tavleoplysningerne er gemt.' : 'Handlingen er gennemført.', 'success');
      await openDashboard();
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  });

  document.querySelectorAll('[data-request-action]').forEach(button => button.onclick = async () => {
    const card = button.closest('[data-request]');
    const action = button.dataset.requestAction;
    if (action === 'delete' && !confirm('Slet denne forespørgsel?')) return;
    const payload = { action:action === 'create' ? 'create-from-request' : 'delete-request', requestId:card.dataset.request };
    if (action === 'create') card.querySelectorAll('[data-field]').forEach(input => payload[input.dataset.field] = input.value.trim());
    button.disabled = true;
    try {
      const result = await api('/api/platform-admin', { method:'POST', body:JSON.stringify(payload) });
      await copyFallback(result, 'Prøvekunden og administratorinvitationen er oprettet.');
      status(action === 'create' ? 'Prøvekunden er oprettet, og administratorinvitationen er sendt.' : 'Forespørgslen er slettet.', 'success');
      await openDashboard();
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  });

  document.querySelectorAll('[data-new-board="slug"], [data-field="desired_slug"]').forEach(input => {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const note = input.closest('.inline-create')?.querySelector('[data-slug-status]');
        if (!input.value.trim()) { if (note) note.textContent = 'URL’en dannes automatisk, hvis feltet er tomt.'; return; }
        try {
          const result = await api('/api/platform-admin', { method:'POST', body:JSON.stringify({ action:'check-slug', value:input.value }) });
          input.value = result.slug;
          if (note) {
            note.textContent = result.available
              ? `visuplanner.dk/${result.slug} er ledig.`
              : `Den ønskede adresse er optaget eller reserveret. Vi foreslår visuplanner.dk/${result.slug}.`;
            note.className = 'slug-note good';
          }
        } catch (error) { if (note) note.textContent = error.message; }
      }, 450);
    });
  });
}

$('platformLoginForm').onsubmit = async event => {
  event.preventDefault();
  $('platformLoginError').textContent = '';
  try {
    session = await auth($('platformEmail').value.trim(), $('platformPassword').value);
    $('platformPassword').value = '';
    await openDashboard();
  } catch (error) { $('platformLoginError').textContent = error.message; }
};

$('platformLogout').onclick = () => { session = null; location.reload(); };
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-board-link]');
  if (link && session) sessionStorage.setItem('visuplanner-session', JSON.stringify(session));
});
