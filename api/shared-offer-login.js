const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';

async function parse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function service(path, secret) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` }
  });
  if (!response.ok) throw new Error(await response.text());
  return parse(response);
}

module.exports = async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return response.status(405).json({ error: 'Metoden er ikke tilladt.' });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return response.status(503).json({ error: 'Loginfunktionen er ikke klar.' });
  try {
    const input = request.method === 'GET' ? request.query : (request.body || {});
    const slug = String(input.slug || '');
    if (!/^[a-z0-9-]{3,120}$/.test(slug)) return response.status(404).json({ error: 'Tilbuddet blev ikke fundet.' });
    const offers = await service(`/rest/v1/shared_offers?slug=eq.${encodeURIComponent(slug)}&archived_at=is.null&select=*`, secret);
    const offer = offers?.[0];
    if (!offer || offer.onboarding_status === 'invited') return response.status(404).json({ error: 'Tilbuddet blev ikke fundet eller er endnu ikke aktiveret.' });
    if (request.method === 'GET') {
      let linkedTeams = [];
      if (offer.registration_module_enabled) {
        const links = await service(`/rest/v1/shared_offer_team_links?offer_id=eq.${encodeURIComponent(offer.id)}&select=team_slug`, secret);
        const teamSlugs = (links || []).map(link => link.team_slug);
        if (teamSlugs.length) {
          const teams = await service(`/rest/v1/teams_registry?slug=in.(${teamSlugs.map(encodeURIComponent).join(',')})&archived_at=is.null&select=slug,name&order=name.asc`, secret);
          linkedTeams = teams || [];
        }
      }
      return response.status(200).json({
        id: offer.id, slug: offer.slug, customer_slug: offer.customer_slug || '', name: offer.name,
        workplace: offer.workplace, municipality: offer.municipality,
        own_board_enabled: offer.own_board_enabled,
        registration_module_enabled: offer.registration_module_enabled === true,
        linked_teams: linkedTeams
      });
    }
    const action = input.action;
    if (!['viewer-login', 'editor-login'].includes(action)) return response.status(400).json({ error: 'Ukendt handling.' });
    if (action === 'viewer-login' && !offer.own_board_enabled) return response.status(403).json({ error: 'Tilbuddet har ikke sin egen tavle.' });
    const userId = action === 'editor-login' ? offer.editor_user_id : offer.viewer_user_id;
    if (!userId) return response.status(400).json({ error: 'Tilbuddets login er ikke koblet korrekt.' });
    const user = await service(`/auth/v1/admin/users/${userId}`, secret);
    const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: String(input.password || '') })
    });
    const result = await parse(login);
    if (!login.ok) return response.status(401).json({ error: action === 'editor-login' ? 'Forkert redigeringskode.' : 'Forkert visningskode.' });
    return response.status(200).json(result);
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: 'Loginhandlingen mislykkedes.' });
  }
};
