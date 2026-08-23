const crypto = require('crypto');
const { saveTeamCredential, saveOfferCredential } = require('../lib/customer-admin-security');
const { safeRoutes, publicPath } = require('../lib/board-routes');
const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
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
    let invite = rows?.[0];
    let kind = 'team';
    if (!invite) {
      const clubRows = await service(`/rest/v1/shared_offer_invitations?token_hash=eq.${hash(token)}&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*,shared_offers(*)&limit=1`, secret).catch(() => []);
      invite = clubRows?.[0];
      if (invite) kind = 'club';
    }
    if (!invite) return response.status(410).json({ error: 'Linket er brugt eller udløbet. Bed om et nyt link.' });
    const team = kind === 'team' ? invite.teams_registry : null;
    const offer = kind === 'club' ? invite.shared_offers : null;
    const board = team || offer;
    if (!board) return response.status(404).json({ error: 'Tavlen blev ikke fundet.' });
    const customerId = invite.customer_id || board.customer_id;
    const customer = customerId ? (await service(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}&select=*`, secret))?.[0] : null;

    if (request.method === 'GET') return response.status(200).json({
      teamName: board.name || invite.team_slug,
      customerName: customer?.display_name || board.workplace,
      contactEmail: invite.contact_email,
      purpose: invite.purpose || 'activation',
      kind
    });

    const editorPassword = String(request.body?.editorPassword || '');
    if (editorPassword.length < 8) return response.status(400).json({ error: `${kind === 'club' ? 'Redigeringskoden' : 'Personalekoden'} skal have mindst 8 tegn.` });

    if (invite.purpose === 'password_reset') {
      await service(`/auth/v1/admin/users/${board.editor_user_id}`, secret, { method: 'PUT', body: JSON.stringify({ password: editorPassword }) });
      if (kind === 'team') await saveTeamCredential(team.slug, 'editor', editorPassword, secret).catch(error => console.error('Personalekoden kunne ikke gemmes krypteret.', error.message));
      else await saveOfferCredential(offer.id, 'editor', editorPassword, secret).catch(error => console.error('Klubbens redigeringskode kunne ikke gemmes krypteret.', error.message));
      const invitationTable = kind === 'club' ? 'shared_offer_invitations' : 'team_invitations';
      await service(`/rest/v1/${invitationTable}?id=eq.${invite.id}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: new Date().toISOString() }) });
      const route = (await safeRoutes(service, secret, kind === 'team' ? `team_slug=eq.${encodeURIComponent(team.slug)}&select=*&limit=1` : `offer_id=eq.${encodeURIComponent(offer.id)}&select=*&limit=1`))?.[0];
      return response.status(200).json({ ok: true, slug: board.slug, path:publicPath(route) || (kind === 'club' ? `/${offer.customer_slug}/${offer.slug}` : `/${team.slug}`), reset: true, kind });
    }

    const viewerPassword = String(request.body?.viewerPassword || '');
    if (viewerPassword.length < 6) return response.status(400).json({ error: 'Tavlekoden skal have mindst 6 tegn.' });
    if (editorPassword === viewerPassword) return response.status(400).json({ error: 'De to koder skal være forskellige.' });

    await service(`/auth/v1/admin/users/${board.editor_user_id}`, secret, { method: 'PUT', body: JSON.stringify({ password: editorPassword }) });
    await service(`/auth/v1/admin/users/${board.viewer_user_id}`, secret, { method: 'PUT', body: JSON.stringify({ password: viewerPassword }) });
    if (kind === 'team') await Promise.all([
      saveTeamCredential(team.slug, 'editor', editorPassword, secret),
      saveTeamCredential(team.slug, 'viewer', viewerPassword, secret)
    ]).catch(error => console.error('Tavlekoderne kunne ikke gemmes krypteret.', error.message));
    else await Promise.all([
      saveOfferCredential(offer.id, 'editor', editorPassword, secret),
      saveOfferCredential(offer.id, 'viewer', viewerPassword, secret)
    ]).catch(error => console.error('Klubbens koder kunne ikke gemmes krypteret.', error.message));
    const now = new Date();
    const nowIso = now.toISOString();
    const invitationTable = kind === 'club' ? 'shared_offer_invitations' : 'team_invitations';
    await service(`/rest/v1/${invitationTable}?id=eq.${invite.id}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: nowIso }) });
    if (kind === 'club') await service(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(offer.id)}`, secret, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ onboarding_status:'active', updated_at:nowIso }) });
    else await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(team.slug)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ onboarding_status: 'active', activated_at: nowIso, updated_at: nowIso }) });

    if (customer?.subscription_status === 'trial' && !customer.trial_started_at) {
      await service(`/rest/v1/customers?id=eq.${encodeURIComponent(customer.id)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ trial_started_at: nowIso, trial_ends_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(), updated_at: nowIso }) });
    }
    if (kind === 'team') await service(`/rest/v1/onboarding_requests?contact_email=eq.${encodeURIComponent(invite.contact_email)}&team_name=eq.${encodeURIComponent(team.name)}&status=eq.invited`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'activated' }) });
    const route = (await safeRoutes(service, secret, kind === 'team' ? `team_slug=eq.${encodeURIComponent(team.slug)}&select=*&limit=1` : `offer_id=eq.${encodeURIComponent(offer.id)}&select=*&limit=1`))?.[0];
    return response.status(200).json({ ok: true, slug: board.slug, path:publicPath(route) || (kind === 'club' ? `/${offer.customer_slug}/${offer.slug}` : `/${team.slug}`), kind });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: 'Aktiveringen kunne ikke gennemføres. Prøv igen eller bed om et nyt link.' });
  }
};
