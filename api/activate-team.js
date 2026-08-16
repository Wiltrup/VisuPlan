const crypto = require('crypto');
const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const TERMS_VERSION = '2026-08-16-v1.2';
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
async function data(response) { const text = await response.text(); return text ? JSON.parse(text) : null; }
async function service(path, secret, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(await response.text());
  return data(response);
}

module.exports = async function handler(request, response) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return response.status(503).json({ error: 'Aktiveringen er ikke klar.' });
  if (!['GET','POST'].includes(request.method)) return response.status(405).json({ error: 'Metoden er ikke tilladt.' });
  try {
    const token = String(request.method === 'GET' ? request.query?.token : request.body?.token || '');
    if (token.length < 30) return response.status(400).json({ error: 'Linket er ugyldigt.' });
    const rows = await service(`/rest/v1/team_invitations?token_hash=eq.${hash(token)}&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*,teams_registry(*)&limit=1`, secret);
    const invite = rows?.[0];
    if (!invite) return response.status(410).json({ error: 'Linket er brugt eller udløbet. Bed om et nyt link.' });
    const team = invite.teams_registry;
    if (!team) return response.status(404).json({ error: 'Tavlen blev ikke fundet.' });
    const customerId = invite.customer_id || team.customer_id;
    const customer = customerId ? (await service(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}&select=*`, secret))?.[0] : null;
    const acceptances = customerId ? await service(`/rest/v1/customer_acceptances?customer_id=eq.${encodeURIComponent(customerId)}&terms_version=eq.${encodeURIComponent(TERMS_VERSION)}&select=id&limit=1`, secret) : [];
    const needsAcceptance = invite.purpose !== 'password_reset' && !acceptances?.length;

    if (request.method === 'GET') return response.status(200).json({
      teamName: team.name || invite.team_slug,
      customerName: customer?.display_name || team.workplace,
      contactEmail: invite.contact_email,
      purpose: invite.purpose || 'activation',
      needsAcceptance,
      termsVersion: TERMS_VERSION
    });

    const editorPassword = String(request.body?.editorPassword || '');
    if (editorPassword.length < 8) return response.status(400).json({ error: 'Personalekoden skal have mindst 8 tegn.' });

    if (invite.purpose === 'password_reset') {
      await service(`/auth/v1/admin/users/${team.editor_user_id}`, secret, { method: 'PUT', body: JSON.stringify({ password: editorPassword }) });
      await service(`/rest/v1/team_invitations?id=eq.${invite.id}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: new Date().toISOString() }) });
      return response.status(200).json({ ok: true, slug: team.slug, reset: true });
    }

    const viewerPassword = String(request.body?.viewerPassword || '');
    if (viewerPassword.length < 6) return response.status(400).json({ error: 'Tavlekoden skal have mindst 6 tegn.' });
    if (editorPassword === viewerPassword) return response.status(400).json({ error: 'De to koder skal være forskellige.' });
    if (needsAcceptance) {
      if (!request.body?.acceptedTerms || !request.body?.acceptedDpa || !request.body?.authorized) return response.status(400).json({ error: 'Betingelserne og databehandleraftalen skal godkendes af en bemyndiget person.' });
      if (!String(request.body?.acceptedByName || '').trim()) return response.status(400).json({ error: 'Skriv navnet på den person, der accepterer.' });
    }

    await service(`/auth/v1/admin/users/${team.editor_user_id}`, secret, { method: 'PUT', body: JSON.stringify({ password: editorPassword }) });
    await service(`/auth/v1/admin/users/${team.viewer_user_id}`, secret, { method: 'PUT', body: JSON.stringify({ password: viewerPassword }) });
    const now = new Date();
    const nowIso = now.toISOString();
    await service(`/rest/v1/team_invitations?id=eq.${invite.id}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: nowIso }) });
    await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(team.slug)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ onboarding_status: 'active', activated_at: nowIso, updated_at: nowIso }) });

    if (needsAcceptance && customerId) {
      await service('/rest/v1/customer_acceptances', secret, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        customer_id: customerId, team_slug: team.slug,
        accepted_by_name: String(request.body.acceptedByName).trim().slice(0, 200),
        accepted_by_email: invite.contact_email,
        terms_version: TERMS_VERSION, privacy_version: TERMS_VERSION, dpa_version: TERMS_VERSION,
        user_agent: String(request.headers['user-agent'] || '').slice(0, 500)
      }) });
    }

    if (customer?.subscription_status === 'trial' && !customer.trial_started_at) {
      await service(`/rest/v1/customers?id=eq.${encodeURIComponent(customer.id)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ trial_started_at: nowIso, trial_ends_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(), updated_at: nowIso }) });
    }
    await service(`/rest/v1/onboarding_requests?contact_email=eq.${encodeURIComponent(invite.contact_email)}&team_name=eq.${encodeURIComponent(team.name)}&status=eq.invited`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'activated' }) });
    return response.status(200).json({ ok: true, slug: team.slug });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: 'Aktiveringen kunne ikke gennemføres. Prøv igen eller bed om et nyt link.' });
  }
};
