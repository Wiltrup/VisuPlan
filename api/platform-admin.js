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
        serviceFetch('/rest/v1/teams_registry?select=*&order=name.asc', secret),
        serviceFetch('/rest/v1/onboarding_requests?select=*&order=created_at.desc&limit=100', secret),
        serviceFetch('/rest/v1/access_help_requests?select=*&order=created_at.desc&limit=100', secret)
      ]);
      return response.status(200).json({ teams: teams || [], onboarding: onboarding || [], accessHelp: accessHelp || [] });
    }
    if (request.method !== 'POST') return response.status(405).json({ error: 'Kun GET og POST er tilladt.' });
    const { slug, action, value } = request.body || {};
    if (!slug || !action || typeof value !== 'string') return response.status(400).json({ error: 'Ugyldig anmodning.' });
    const teams = await serviceFetch(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&select=*`, secret);
    const team = teams?.[0];
    if (!team) return response.status(404).json({ error: 'Teamet blev ikke fundet.' });

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
