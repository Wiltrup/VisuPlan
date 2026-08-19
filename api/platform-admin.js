const crypto = require('crypto');

const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
const TERMS_VERSION = '2026-08-16-v1.2';
const DAY = 24 * 60 * 60 * 1000;

const clean = (value, max = 300) => String(value || '').trim().slice(0, max);
const slugify = value => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'tavle';
const randomPassword = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const isoAfter = (date, years = 1) => { const next = new Date(date); next.setFullYear(next.getFullYear() + years); return next.toISOString(); };

const PLANS = {
  intro3: { label: 'Op til 3 tavler', limit: 3, intro: 1850, renewal: 2200 },
  intro8: { label: 'Op til 8 tavler', limit: 8, intro: 3200, renewal: 3800 },
  intro12: { label: 'Op til 12 tavler', limit: 12, intro: 4400, renewal: 5200 },
  custom: { label: 'Skræddersyet', limit: 25, intro: null, renewal: null }
};

async function json(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function verifyPlatformAdmin(authorization, secret) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: authorization } });
  if (!userResponse.ok) return null;
  const user = await json(userResponse);
  const roleResponse = await fetch(`${SUPABASE_URL}/rest/v1/platform_admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` }
  });
  if (!roleResponse.ok) return null;
  const roles = await json(roleResponse);
  return roles?.length ? user : null;
}

async function serviceFetch(path, secret, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error((await response.text()) || `Supabase svarede ${response.status}`);
  return json(response);
}

async function listStorageFiles(prefix, secret) {
  const items = await serviceFetch('/storage/v1/object/list/visuplan-images', secret, {
    method: 'POST', body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } })
  }) || [];
  const files = [];
  for (const item of items) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) files.push(path);
    else files.push(...await listStorageFiles(path, secret));
  }
  return files;
}

async function deleteTeamStorage(slug, secret) {
  const files = await listStorageFiles(slug, secret);
  for (let index = 0; index < files.length; index += 100) {
    await serviceFetch('/storage/v1/object/visuplan-images', secret, {
      method: 'DELETE', body: JSON.stringify({ prefixes: files.slice(index, index + 100) })
    });
  }
}

async function slugAvailable(slug, secret, currentSlug = '') {
  if (!/^[a-z0-9-]{3,120}$/.test(slug)) return false;
  if (slug === currentSlug) return true;
  const rows = await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&select=slug`, secret);
  return !rows?.length;
}

async function uniqueSlug(base, secret) {
  const stem = slugify(base);
  let candidate = stem;
  let suffix = 2;
  while (!(await slugAvailable(candidate, secret))) candidate = `${stem}-${suffix++}`;
  return candidate;
}

async function offerSlugAvailable(slug, secret, currentSlug = '') {
  if (!/^[a-z0-9-]{3,120}$/.test(slug)) return false;
  if (slug === currentSlug) return true;
  const rows = await serviceFetch(`/rest/v1/shared_offers?slug=eq.${encodeURIComponent(slug)}&select=slug`, secret);
  return !rows?.length;
}

async function uniqueOfferSlug(base, secret) {
  const stem = slugify(base);
  let candidate = stem;
  let suffix = 2;
  while (!(await offerSlugAvailable(candidate, secret))) candidate = `${stem}-${suffix++}`;
  return candidate;
}

async function createSharedOffer(input, customer, secret) {
  const name = clean(input.name, 150);
  const recoveryEmail = clean(input.recovery_email || customer.contact_email, 200).toLowerCase();
  const editorPassword = String(input.editor_password || '');
  const viewerPassword = String(input.viewer_password || '');
  if (!name || !/^\S+@\S+\.\S+$/.test(recoveryEmail)) throw new Error('Tilbuddets navn og kontaktmail skal udfyldes.');
  if (editorPassword.length < 8 || viewerPassword.length < 6) throw new Error('Redigeringskoden skal have mindst 8 tegn, og visningskoden mindst 6 tegn.');
  const requested = clean(input.slug, 120);
  const slug = requested ? slugify(requested) : await uniqueOfferSlug(`${customer.display_name}-${name}`, secret);
  if (!(await offerSlugAvailable(slug, secret))) throw new Error('Den ønskede tilbudsadresse er allerede i brug.');
  let editor = null;
  let viewer = null;
  let offer = null;
  try {
    editor = await serviceFetch('/auth/v1/admin/users', secret, {
      method: 'POST', body: JSON.stringify({ email: `${slug}-offer-editor@visuplanner.invalid`, password: editorPassword, email_confirm: true, user_metadata: { role: 'offer_editor', offer_slug: slug } })
    });
    viewer = await serviceFetch('/auth/v1/admin/users', secret, {
      method: 'POST', body: JSON.stringify({ email: `${slug}-offer-viewer@visuplanner.invalid`, password: viewerPassword, email_confirm: true, user_metadata: { role: 'offer_viewer', offer_slug: slug } })
    });
    const rows = await serviceFetch('/rest/v1/shared_offers?select=*', secret, {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        customer_id: customer.id, slug, name,
        workplace: clean(input.workplace || customer.display_name, 200) || null,
        municipality: clean(input.municipality || customer.municipality, 150) || null,
        recovery_email: recoveryEmail, editor_user_id: editor.id, viewer_user_id: viewer.id,
        own_board_enabled: input.own_board_enabled !== false
      })
    });
    offer = rows?.[0];
    const teamSlugs = Array.isArray(input.team_slugs) ? input.team_slugs.filter(value => /^[a-z0-9-]{3,120}$/.test(value)) : [];
    if (offer && teamSlugs.length) await serviceFetch('/rest/v1/shared_offer_team_links', secret, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(teamSlugs.map(team_slug => ({ offer_id: offer.id, team_slug, visible_on_team: true })))
    });
    return offer;
  } catch (error) {
    if (offer?.id) await serviceFetch(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(offer.id)}`, secret, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    if (viewer?.id) await serviceFetch(`/auth/v1/admin/users/${viewer.id}`, secret, { method: 'DELETE' }).catch(() => {});
    if (editor?.id) await serviceFetch(`/auth/v1/admin/users/${editor.id}`, secret, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}

async function sendInvitation(email, name, link, purpose = 'activation') {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const reset = purpose === 'password_reset';
  const mail = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VisuPlanner <velkommen@visuplanner.dk>', to: [email],
      subject: reset ? `Vælg en ny personalekode til ${name}` : `Gør ${name} klar i VisuPlanner`,
      text: reset
        ? `Vælg en ny personalekode via dette engangslink:\n\n${link}\n\nLinket udløber efter 1 time.`
        : `Jeres VisuPlanner-tavle er oprettet. Vælg selv personale- og tavlekode via dette engangslink:\n\n${link}\n\nLinket udløber efter 72 timer. Koderne sendes ikke til VisuPlanner-administratoren.`
    })
  });
  if (!mail.ok) console.error('Invitationsmail fejlede', await mail.text());
  return mail.ok;
}

async function createInvitation(team, customer, secret, host, purpose = 'activation') {
  await serviceFetch(`/rest/v1/team_invitations?team_slug=eq.${encodeURIComponent(team.slug)}&purpose=eq.${purpose}&used_at=is.null`, secret, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: new Date().toISOString() })
  });
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = purpose === 'password_reset' ? 1 : 72;
  await serviceFetch('/rest/v1/team_invitations', secret, {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      team_slug: team.slug, customer_id: customer?.id || team.customer_id || null,
      purpose, token_hash: tokenHash(token), contact_email: team.recovery_email,
      expires_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    })
  });
  const origin = `https://${host || 'visuplanner.dk'}`;
  const inviteUrl = `${origin}/aktiver?token=${encodeURIComponent(token)}`;
  return { inviteUrl, mailSent: await sendInvitation(team.recovery_email, team.name, inviteUrl, purpose) };
}

async function createBoard(input, customer, secret, host) {
  const name = clean(input.name, 150);
  const municipality = clean(input.municipality || customer.municipality, 150);
  const workplace = clean(input.workplace || customer.display_name, 200);
  const recoveryEmail = clean(input.recovery_email || customer.contact_email, 200).toLowerCase();
  if (!name || !municipality || !workplace || !/^\S+@\S+\.\S+$/.test(recoveryEmail)) throw new Error('Tavlens navn, kommune, arbejdsplads og kontaktmail skal udfyldes.');

  const requested = clean(input.slug, 120);
  const slug = requested ? slugify(requested) : await uniqueSlug(`${workplace}-${name}`, secret);
  if (!(await slugAvailable(slug, secret))) throw new Error('Den ønskede tavleadresse er allerede i brug.');

  const editorEmail = `${slug}-editor@visuplanner.invalid`;
  const viewerEmail = `${slug}-viewer@visuplanner.invalid`;
  let editor = null;
  let viewer = null;
  let teamCreated = false;
  try {
    editor = await serviceFetch('/auth/v1/admin/users', secret, {
      method: 'POST', body: JSON.stringify({ email: editorEmail, password: randomPassword(), email_confirm: true, user_metadata: { role: 'editor', team_slug: slug } })
    });
    viewer = await serviceFetch('/auth/v1/admin/users', secret, {
      method: 'POST', body: JSON.stringify({ email: viewerEmail, password: randomPassword(), email_confirm: true, user_metadata: { role: 'viewer', team_slug: slug } })
    });
    const rows = await serviceFetch('/rest/v1/teams_registry?select=*', secret, {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        slug, name, municipality, workplace, recovery_email: recoveryEmail,
        editor_user_id: editor.id, viewer_user_id: viewer.id,
        onboarding_status: 'invited', customer_id: customer.id
      })
    });
    teamCreated = true;
    const team = rows?.[0] || { slug, name, recovery_email: recoveryEmail, customer_id: customer.id };
    const invitation = await createInvitation(team, customer, secret, host);
    return { team, ...invitation };
  } catch (error) {
    if (teamCreated) await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}`, secret, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    if (viewer?.id) await serviceFetch(`/auth/v1/admin/users/${viewer.id}`, secret, { method: 'DELETE' }).catch(() => {});
    if (editor?.id) await serviceFetch(`/auth/v1/admin/users/${editor.id}`, secret, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}

function publicAdminError(error) {
  const message = String(error?.message || error || '');
  if (/already.*registered|duplicate.*email/i.test(message)) return { status: 409, message: 'Et teknisk login findes allerede. Vælg en anden tavleadresse.' };
  if (/allerede i brug|Tavlens navn|Tilbuddets navn|redigeringskoden|visningskoden|ønskede tavleadresse|tilbudsadresse|pakken tillader|prøveperioden/i.test(message)) return { status: 400, message };
  return { status: 500, message: 'Administratorhandlingen mislykkedes. Ingen eksisterende tavledata blev slettet.' };
}

module.exports = async function handler(request, response) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return response.status(503).json({ error: 'Administratorfunktionen mangler SUPABASE_SECRET_KEY i Vercel.' });
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return response.status(401).json({ error: 'Log ind som administrator.' });
  if (!(await verifyPlatformAdmin(authorization, secret))) return response.status(403).json({ error: 'Denne bruger er ikke platformadministrator.' });

  try {
    if (request.method === 'GET') {
      const [customers, teams, archivedTeams, onboarding, accessHelp, acceptances, sharedOffers, sharedOfferLinks] = await Promise.all([
        serviceFetch('/rest/v1/customers?archived_at=is.null&select=*&order=display_name.asc', secret),
        serviceFetch('/rest/v1/teams_registry?archived_at=is.null&select=*&order=name.asc', secret),
        serviceFetch('/rest/v1/teams_registry?archived_at=not.is.null&select=*&order=archived_at.desc', secret),
        serviceFetch('/rest/v1/onboarding_requests?status=eq.new&select=*&order=created_at.desc&limit=100', secret),
        serviceFetch('/rest/v1/access_help_requests?select=*&order=created_at.desc&limit=100', secret),
        serviceFetch('/rest/v1/customer_acceptances?select=customer_id,terms_version,accepted_by_name,accepted_at&order=accepted_at.desc', secret),
        serviceFetch('/rest/v1/shared_offers?archived_at=is.null&select=*&order=name.asc', secret),
        serviceFetch('/rest/v1/shared_offer_team_links?select=*&order=created_at.asc', secret)
      ]);
      const grouped = (customers || []).map(customer => ({
        ...customer,
        teams: (teams || []).filter(team => team.customer_id === customer.id),
        shared_offers: (sharedOffers || []).filter(offer => offer.customer_id === customer.id).map(offer => ({ ...offer, team_links: (sharedOfferLinks || []).filter(link => link.offer_id === offer.id) })),
        latest_acceptance: (acceptances || []).find(item => item.customer_id === customer.id) || null
      }));
      return response.status(200).json({ customers: grouped, ungroupedTeams: (teams || []).filter(team => !team.customer_id), archivedTeams: archivedTeams || [], onboarding: onboarding || [], accessHelp: accessHelp || [], termsVersion: TERMS_VERSION });
    }
    if (request.method !== 'POST') return response.status(405).json({ error: 'Kun GET og POST er tilladt.' });

    const body = request.body || {};
    const { action, requestId, customerId, slug } = body;

    if (action === 'check-slug') {
      const candidate = slugify(body.value || body.slug);
      return response.status(200).json({ slug: candidate, available: await slugAvailable(candidate, secret) });
    }
    if (action === 'create-shared-offer') {
      const customers = await serviceFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}&select=*`, secret);
      const customer = customers?.[0];
      if (!customer) return response.status(404).json({ error: 'Kunden blev ikke fundet.' });
      const customerTeams = await serviceFetch(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(customerId)}&archived_at=is.null&select=slug`, secret);
      const allowed = new Set((customerTeams || []).map(team => team.slug));
      body.team_slugs = (Array.isArray(body.team_slugs) ? body.team_slugs : []).filter(teamSlug => allowed.has(teamSlug));
      const offer = await createSharedOffer(body, customer, secret);
      return response.status(200).json({ ok: true, offer, boardUrl: `/tilbud/${offer.slug}` });
    }
    if (action === 'save-shared-offer') {
      const offerId = clean(body.offer_id, 60);
      const offers = await serviceFetch(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(offerId)}&customer_id=eq.${encodeURIComponent(customerId)}&select=*`, secret);
      const offer = offers?.[0];
      if (!offer) return response.status(404).json({ error: 'Tilbuddet blev ikke fundet.' });
      const update = {
        name: clean(body.name, 150), workplace: clean(body.workplace, 200) || null,
        municipality: clean(body.municipality, 150) || null, recovery_email: clean(body.recovery_email, 200).toLowerCase(),
        own_board_enabled: body.own_board_enabled !== false, updated_at: new Date().toISOString()
      };
      if (!update.name || !/^\S+@\S+\.\S+$/.test(update.recovery_email)) return response.status(400).json({ error: 'Udfyld navn og en gyldig kontaktmail.' });
      await serviceFetch(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(offer.id)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update) });
      const customerTeams = await serviceFetch(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(customerId)}&archived_at=is.null&select=slug`, secret);
      const allowed = new Set((customerTeams || []).map(team => team.slug));
      const selected = new Set((Array.isArray(body.team_slugs) ? body.team_slugs : []).filter(teamSlug => allowed.has(teamSlug)));
      const existingLinks = await serviceFetch(`/rest/v1/shared_offer_team_links?offer_id=eq.${encodeURIComponent(offer.id)}&select=team_slug,visible_on_team`, secret);
      const existing = new Set((existingLinks || []).map(link => link.team_slug));
      const removed = [...existing].filter(teamSlug => !selected.has(teamSlug));
      const added = [...selected].filter(teamSlug => !existing.has(teamSlug));
      if (removed.length) await serviceFetch(`/rest/v1/shared_offer_team_links?offer_id=eq.${encodeURIComponent(offer.id)}&team_slug=in.(${removed.map(encodeURIComponent).join(',')})`, secret, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (added.length) await serviceFetch('/rest/v1/shared_offer_team_links', secret, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(added.map(team_slug => ({ offer_id: offer.id, team_slug, visible_on_team: true }))) });
      return response.status(200).json({ ok: true });
    }
    if (action === 'reset-shared-offer-code') {
      const offers = await serviceFetch(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(clean(body.offer_id, 60))}&customer_id=eq.${encodeURIComponent(customerId)}&select=*`, secret);
      const offer = offers?.[0];
      if (!offer) return response.status(404).json({ error: 'Tilbuddet blev ikke fundet.' });
      const kind = body.code_kind === 'viewer' ? 'viewer' : 'editor';
      const value = String(body.value || '');
      if (value.length < (kind === 'viewer' ? 6 : 8)) return response.status(400).json({ error: kind === 'viewer' ? 'Visningskoden skal have mindst 6 tegn.' : 'Redigeringskoden skal have mindst 8 tegn.' });
      await serviceFetch(`/auth/v1/admin/users/${offer[`${kind}_user_id`]}`, secret, { method: 'PUT', body: JSON.stringify({ password: value }) });
      return response.status(200).json({ ok: true });
    }
    if (action === 'delete-request') {
      if (!requestId) return response.status(400).json({ error: 'Forespørgslen mangler.' });
      await serviceFetch(`/rest/v1/onboarding_requests?id=eq.${encodeURIComponent(requestId)}&status=eq.new`, secret, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return response.status(200).json({ ok: true });
    }
    if (action === 'create-from-request') {
      const requests = await serviceFetch(`/rest/v1/onboarding_requests?id=eq.${encodeURIComponent(requestId)}&select=*`, secret);
      const item = requests?.[0];
      if (!item || item.status === 'activated') return response.status(400).json({ error: 'Forespørgslen kan ikke oprettes.' });
      const desiredPlan = PLANS[body.plan_code] ? body.plan_code : (PLANS[item.requested_plan] ? item.requested_plan : 'intro3');
      const plan = PLANS[desiredPlan];
      let customer = null;
      try {
        const customerRows = await serviceFetch('/rest/v1/customers?select=*', secret, {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            display_name: clean(body.customer_name || item.workplace, 200), legal_name: clean(body.legal_name || item.workplace, 200),
            municipality: clean(body.municipality || item.municipality, 150), contact_name: item.contact_name,
            contact_email: item.contact_email.toLowerCase(), billing_email: item.contact_email.toLowerCase(), phone: item.phone,
            plan_code: desiredPlan, board_limit: 1, intro_price_dkk: plan.intro, renewal_price_dkk: plan.renewal,
            subscription_status: 'trial', internal_notes: item.notes
          })
        });
        customer = customerRows?.[0];
        const created = await createBoard({
          name: body.team_name || item.team_name, municipality: body.municipality || item.municipality,
          workplace: body.workplace || item.workplace, recovery_email: item.contact_email, slug: body.desired_slug
        }, customer, secret, request.headers.host);
        await serviceFetch(`/rest/v1/onboarding_requests?id=eq.${encodeURIComponent(requestId)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'invited' }) });
        return response.status(200).json({ ok: true, customer, ...created });
      } catch (error) {
        if (customer?.id) await serviceFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(customer.id)}`, secret, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
        throw error;
      }
    }
    if (action === 'create-board') {
      const customers = await serviceFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}&select=*`, secret);
      const customer = customers?.[0];
      if (!customer) return response.status(404).json({ error: 'Kunden blev ikke fundet.' });
      const teams = await serviceFetch(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(customer.id)}&archived_at=is.null&select=slug`, secret);
      if (customer.subscription_status === 'trial' && teams.length >= 1) throw new Error('Prøveperioden omfatter én tavle. Aktivér en pakke før flere tavler oprettes.');
      if (teams.length >= customer.board_limit) throw new Error(`Pakken tillader højst ${customer.board_limit} tavler.`);
      return response.status(200).json({ ok: true, ...(await createBoard(body, customer, secret, request.headers.host)) });
    }
    if (action === 'save-customer') {
      const allowed = ['display_name','legal_name','municipality','contact_name','contact_email','billing_email','phone','cvr','ean','invoice_reference','internal_notes','payment_method'];
      const update = Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(body, key)).map(key => [key, clean(body[key], key === 'internal_notes' ? 2000 : 300) || null]));
      update.updated_at = new Date().toISOString();
      await serviceFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update) });
      return response.status(200).json({ ok: true });
    }
    if (action === 'save-team') {
      const update = { name: clean(body.name, 150), municipality: clean(body.municipality, 150), workplace: clean(body.workplace, 200), recovery_email: clean(body.recovery_email, 200).toLowerCase(), updated_at: new Date().toISOString() };
      if (!update.name || !update.municipality || !update.workplace || !/^\S+@\S+\.\S+$/.test(update.recovery_email)) return response.status(400).json({ error: 'Udfyld gyldige tavleoplysninger.' });
      await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update) });
      return response.status(200).json({ ok: true });
    }
    if (['activate-subscription','extend-trial','mark-invoice-sent','mark-paid','set-read-only'].includes(action)) {
      const rows = await serviceFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}&select=*`, secret);
      const customer = rows?.[0];
      if (!customer) return response.status(404).json({ error: 'Kunden blev ikke fundet.' });
      const now = new Date();
      let update = { updated_at: now.toISOString() };
      if (action === 'activate-subscription') {
        const planCode = PLANS[body.plan_code] ? body.plan_code : 'intro3';
        const plan = PLANS[planCode];
        const limit = planCode === 'custom' ? Math.max(1, Number(body.board_limit) || customer.board_limit || 1) : plan.limit;
        const renews = isoAfter(now);
        update = { ...update, plan_code: planCode, board_limit: limit, intro_price_dkk: body.intro_price_dkk ?? plan.intro, renewal_price_dkk: body.renewal_price_dkk ?? plan.renewal, subscription_status: 'contracted', subscription_started_at: customer.subscription_started_at || now.toISOString(), subscription_renews_at: customer.subscription_renews_at || renews, invoice_period_end: customer.subscription_renews_at || renews };
      } else if (action === 'extend-trial') {
        const base = customer.trial_ends_at && new Date(customer.trial_ends_at) > now ? new Date(customer.trial_ends_at) : now;
        update = { ...update, subscription_status: 'trial', trial_ends_at: new Date(base.getTime() + Math.max(1, Number(body.days) || 7) * DAY).toISOString() };
      } else if (action === 'mark-invoice-sent') {
        const currentRenewal = customer.subscription_renews_at ? new Date(customer.subscription_renews_at) : new Date(isoAfter(now));
        update = { ...update, subscription_status: 'invoice_sent', invoice_number: clean(body.invoice_number, 100), invoice_sent_at: now.toISOString(), invoice_due_at: body.invoice_due_at || null, payment_method: body.payment_method || null, invoice_period_end: body.invoice_kind === 'renewal' ? isoAfter(currentRenewal) : currentRenewal.toISOString() };
      } else if (action === 'mark-paid') {
        update = { ...update, subscription_status: 'active', paid_at: now.toISOString() };
        if (customer.invoice_period_end) update.subscription_renews_at = customer.invoice_period_end;
      } else update = { ...update, subscription_status: 'read_only' };
      await serviceFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update) });
      return response.status(200).json({ ok: true });
    }

    if (!slug) return response.status(400).json({ error: 'Tavlen mangler.' });
    const teams = await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&select=*`, secret);
    const team = teams?.[0];
    if (!team) return response.status(404).json({ error: 'Tavlen blev ikke fundet.' });
    const customer = team.customer_id ? (await serviceFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(team.customer_id)}&select=*`, secret))?.[0] : null;
    if (action === 'resend-invite') {
      if (team.onboarding_status === 'active') return response.status(400).json({ error: 'Tavlen er allerede aktiveret. Brug nulstilling, hvis personalekoden er glemt.' });
      return response.status(200).json({ ok: true, ...(await createInvitation(team, customer, secret, request.headers.host)) });
    }
    if (action === 'send-reset-editor') return response.status(200).json({ ok: true, ...(await createInvitation(team, customer, secret, request.headers.host, 'password_reset')) });
    if (action === 'archive-team') {
      await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      return response.status(200).json({ ok: true });
    }
    if (action === 'delete-team') {
      await deleteTeamStorage(slug, secret);
      if (team.editor_user_id) await serviceFetch(`/auth/v1/admin/users/${team.editor_user_id}`, secret, { method: 'DELETE' });
      if (team.viewer_user_id) await serviceFetch(`/auth/v1/admin/users/${team.viewer_user_id}`, secret, { method: 'DELETE' });
      await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}`, secret, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      await serviceFetch(`/rest/v1/access_help_requests?team_slug=eq.${encodeURIComponent(slug)}`, secret, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return response.status(200).json({ ok: true });
    }
    const value = clean(body.value, 300);
    const userId = action === 'reset-editor' ? team.editor_user_id : action === 'reset-viewer' ? team.viewer_user_id : null;
    if (!userId) return response.status(400).json({ error: 'Ukendt handling eller manglende loginbruger.' });
    if (value.length < 6) return response.status(400).json({ error: 'Koden skal have mindst seks tegn.' });
    await serviceFetch(`/auth/v1/admin/users/${userId}`, secret, { method: 'PUT', body: JSON.stringify({ password: value }) });
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    const safeError = publicAdminError(error);
    return response.status(safeError.status).json({ error: safeError.message });
  }
};
