const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';

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

const crypto = require('crypto');
const clean = (value, max = 200) => String(value || '').trim().slice(0, max);
const slugify = value => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'team';
const randomPassword = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
async function sendInvitation(email, name, link) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const mail = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' }, body:JSON.stringify({
    from:'VisuPlanner <velkommen@visuplanner.dk>', to:[email], subject:`Gør ${name} klar i VisuPlanner`,
    text:`Jeres VisuPlanner-tavle er oprettet. Vælg selv personale- og tavlekode via dette engangslink:\n\n${link}\n\nLinket udløber efter 72 timer. Koderne sendes ikke til VisuPlanner-administratoren.`
  }) });
  if (!mail.ok) console.error('Invitationsmail fejlede', await mail.text());
  return mail.ok;
}

module.exports = async function handler(request, response) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return response.status(503).json({ error: 'Administratorfunktionen mangler SUPABASE_SECRET_KEY i Vercel.' });
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return response.status(401).json({ error: 'Log ind som administrator.' });
  const admin = await verifyPlatformAdmin(authorization, secret);
  if (!admin) return response.status(403).json({ error: 'Denne bruger er ikke platformadministrator.' });

  try {
    if (request.method === 'GET') {
      const [teams,onboarding,accessHelp] = await Promise.all([
        serviceFetch('/rest/v1/teams_registry?archived_at=is.null&select=*&order=name.asc', secret),
        serviceFetch('/rest/v1/onboarding_requests?select=*&order=created_at.desc&limit=100', secret),
        serviceFetch('/rest/v1/access_help_requests?select=*&order=created_at.desc&limit=100', secret)
      ]);
      return response.status(200).json({ teams: teams || [], onboarding: onboarding || [], accessHelp: accessHelp || [] });
    }
    if (request.method !== 'POST') return response.status(405).json({ error: 'Kun GET og POST er tilladt.' });
    const { slug, action, value, requestId } = request.body || {};
    if (action === 'create-from-request') {
      if (!requestId) return response.status(400).json({ error:'Forespørgslen mangler.' });
      const requests = await serviceFetch(`/rest/v1/onboarding_requests?id=eq.${encodeURIComponent(requestId)}&select=*`, secret);
      const item = requests?.[0];
      if (!item || item.status === 'activated') return response.status(400).json({ error:'Forespørgslen kan ikke oprettes.' });
      const baseSlug = slugify(`${item.workplace}-${item.team_name}`);
      let newSlug = baseSlug, suffix = 2;
      while ((await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(newSlug)}&select=slug`, secret))?.length) newSlug = `${baseSlug}-${suffix++}`;
      const editor = await serviceFetch('/auth/v1/admin/users', secret, { method:'POST', body:JSON.stringify({ email:item.contact_email.toLowerCase(), password:randomPassword(), email_confirm:true, user_metadata:{ role:'editor', team_slug:newSlug } }) });
      let viewer;
      try { viewer = await serviceFetch('/auth/v1/admin/users', secret, { method:'POST', body:JSON.stringify({ email:`${newSlug}-viewer@visuplanner.invalid`, password:randomPassword(), email_confirm:true, user_metadata:{ role:'viewer', team_slug:newSlug } }) }); }
      catch (error) { await serviceFetch(`/auth/v1/admin/users/${editor.id}`, secret, { method:'DELETE' }); throw error; }
      await serviceFetch('/rest/v1/teams_registry', secret, { method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify({ slug:newSlug, name:item.team_name, municipality:item.municipality, workplace:item.workplace, recovery_email:item.contact_email.toLowerCase(), editor_user_id:editor.id, viewer_user_id:viewer.id, onboarding_status:'invited' }) });
      await serviceFetch('/rest/v1/team_settings', secret, { method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify({ id:newSlug, team_slug:newSlug, active_week_start:new Date().toISOString().slice(0,10) }) });
      const token = crypto.randomBytes(32).toString('base64url');
      await serviceFetch('/rest/v1/team_invitations', secret, { method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify({ team_slug:newSlug, token_hash:tokenHash(token), contact_email:item.contact_email.toLowerCase(), expires_at:new Date(Date.now()+72*60*60*1000).toISOString() }) });
      await serviceFetch(`/rest/v1/onboarding_requests?id=eq.${encodeURIComponent(requestId)}`, secret, { method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({status:'invited'}) });
      const origin = `https://${request.headers.host || 'visuplanner.dk'}`;
      const inviteUrl = `${origin}/aktiver?token=${encodeURIComponent(token)}`;
      const mailSent = await sendInvitation(item.contact_email, item.team_name, inviteUrl);
      return response.status(200).json({ ok:true, slug:newSlug, inviteUrl, mailSent });
    }
    if (!slug || !action || (!['send-reset-editor','resend-invite','archive-team'].includes(action) && typeof value !== 'string')) return response.status(400).json({ error: 'Ugyldig anmodning.' });
    const teams = await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&select=*`, secret);
    const team = teams?.[0];
    if (!team) return response.status(404).json({ error: 'Teamet blev ikke fundet.' });

    if (action === 'resend-invite') {
      if (team.onboarding_status === 'active') return response.status(400).json({ error:'Teamet er allerede aktiveret. Brug nulstilling, hvis personalekoden er glemt.' });
      await serviceFetch(`/rest/v1/team_invitations?team_slug=eq.${encodeURIComponent(slug)}&used_at=is.null`, secret, { method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({used_at:new Date().toISOString()}) });
      const token=crypto.randomBytes(32).toString('base64url');
      await serviceFetch('/rest/v1/team_invitations', secret, { method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify({team_slug:slug,token_hash:tokenHash(token),contact_email:team.recovery_email,expires_at:new Date(Date.now()+72*60*60*1000).toISOString()}) });
      const origin=`https://${request.headers.host||'visuplanner.dk'}`,inviteUrl=`${origin}/aktiver?token=${encodeURIComponent(token)}`;
      return response.status(200).json({ok:true,inviteUrl,mailSent:await sendInvitation(team.recovery_email,team.name,inviteUrl)});
    }

    if (action === 'archive-team') {
      await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}`, secret, {method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({archived_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
      return response.status(200).json({ok:true});
    }

    if (action === 'send-reset-editor') {
      const user = await serviceFetch(`/auth/v1/admin/users/${team.editor_user_id}`, secret);
      const recover = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`https://visuplanner.dk/${team.slug}`)}`, { method:'POST', headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json' }, body:JSON.stringify({email:user.email}) });
      if (!recover.ok) throw new Error(await recover.text());
      return response.status(200).json({ ok:true });
    }

    if (action === 'save-contact') {
      if (!/^\S+@\S+\.\S+$/.test(value)) return response.status(400).json({ error: 'Skriv en gyldig arbejdsmail.' });
      if (team.editor_user_id) {
        await serviceFetch(`/auth/v1/admin/users/${team.editor_user_id}`, secret, { method:'PUT', body:JSON.stringify({ email:value, email_confirm:true }) });
      }
      await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}`, secret, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ recovery_email: value, updated_at: new Date().toISOString() })
      });
      return response.status(200).json({ ok: true });
    }

    const userId = action === 'reset-editor' ? team.editor_user_id : action === 'reset-viewer' ? team.viewer_user_id : null;
    if (!userId) return response.status(400).json({ error: 'Teamets loginbruger er ikke koblet korrekt.' });
    if (value.length < 6) return response.status(400).json({ error: 'Koden skal have mindst seks tegn.' });
    await serviceFetch(`/auth/v1/admin/users/${userId}`, secret, { method: 'PUT', body: JSON.stringify({ password: value }) });
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: 'Administratorhandlingen mislykkedes. Ingen data blev slettet.' });
  }
};
