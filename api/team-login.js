const crypto = require('crypto');

const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';

async function data(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function service(path, secret, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(await response.text());
  return data(response);
}

function canEdit(customer) {
  if (!customer) return true;
  if (['contracted', 'invoice_sent', 'active', 'overdue'].includes(customer.subscription_status)) return true;
  return customer.subscription_status === 'trial' && customer.trial_ends_at && new Date(customer.trial_ends_at) > new Date();
}

function subscription(customer) {
  if (!customer) return { status: 'legacy', can_edit: true };
  return {
    status: customer.subscription_status,
    can_edit: canEdit(customer),
    trial_started_at: customer.trial_started_at,
    trial_ends_at: customer.trial_ends_at,
    subscription_renews_at: customer.subscription_renews_at,
    subscription_interest_at: customer.subscription_interest_at
  };
}

async function sendReset(email, name, link) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VisuPlanner <velkommen@visuplanner.dk>',
      to: [email],
      subject: `Vælg en ny personalekode til ${name}`,
      text: `Vælg en ny personalekode via dette engangslink:\n\n${link}\n\nLinket udløber efter 1 time.`
    })
  });
  if (!response.ok) console.error('Nulstillingsmail fejlede', await response.text());
  return response.ok;
}

module.exports = async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return response.status(405).json({ error: 'Metoden er ikke tilladt.' });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return response.status(503).json({ error: 'Loginfunktionen er ikke klar.' });
  try {
    const input = request.method === 'GET' ? request.query : (request.body || {});
    const { slug, action, password, email } = input;
    if (request.method === 'GET' && !slug) {
      const directory = await service('/rest/v1/teams_registry?onboarding_status=eq.active&archived_at=is.null&select=slug,name,municipality,workplace&order=municipality.asc,workplace.asc,name.asc', secret);
      return response.status(200).json(directory || []);
    }
    if (!/^[a-z0-9-]{3,120}$/.test(String(slug || ''))) return response.status(404).json({ error: 'Teamet blev ikke fundet.' });
    const teams = await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&select=*`, secret);
    const team = teams?.[0];
    if (!team || team.onboarding_status !== 'active' || team.archived_at) return response.status(404).json({ error: 'Teamet blev ikke fundet eller er endnu ikke aktiveret.' });
    const customers = team.customer_id ? await service(`/rest/v1/customers?id=eq.${encodeURIComponent(team.customer_id)}&select=*`, secret) : [];
    const customer = customers?.[0] || null;
    if (request.method === 'GET') return response.status(200).json({ slug: team.slug, name: team.name, workplace: team.workplace, municipality: team.municipality, subscription: subscription(customer) });
    if (!team.editor_user_id || !team.viewer_user_id) return response.status(400).json({ error: 'Teamets login er ikke koblet korrekt.' });
    const userId = action === 'viewer-login' ? team.viewer_user_id : team.editor_user_id;
    const user = await service(`/auth/v1/admin/users/${userId}`, secret);
    if (action === 'login' || action === 'viewer-login') {
      const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: String(password || '') })
      });
      const result = await data(login);
      if (!login.ok) return response.status(401).json({ error: action === 'viewer-login' ? 'Forkert tavlekode.' : 'Forkert personalekode.' });
      return response.status(200).json(result);
    }
    if (action === 'recover') {
      if (String(email || '').trim().toLowerCase() !== String(team.recovery_email || '').toLowerCase()) return response.status(200).json({ ok: true });
      await service(`/rest/v1/team_invitations?team_slug=eq.${encodeURIComponent(team.slug)}&purpose=eq.password_reset&used_at=is.null`, secret, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: new Date().toISOString() })
      });
      const token = crypto.randomBytes(32).toString('base64url');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      await service('/rest/v1/team_invitations', secret, {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ team_slug: team.slug, customer_id: team.customer_id, purpose: 'password_reset', token_hash: hash, contact_email: team.recovery_email, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
      });
      const origin = `https://${request.headers.host || 'visuplanner.dk'}`;
      await sendReset(team.recovery_email, team.name, `${origin}/aktiver?token=${encodeURIComponent(token)}`);
      return response.status(200).json({ ok: true });
    }
    return response.status(400).json({ error: 'Ukendt handling.' });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: 'Loginhandlingen mislykkedes.' });
  }
};
