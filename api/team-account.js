const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
const { saveTeamCredential } = require('../lib/customer-admin-security');

async function parse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function service(path, secret, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(await response.text());
  return parse(response);
}

async function notifyOwner(subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'VisuPlanner <notifikation@visuplanner.dk>', to: ['wiltrup@wiltrup.com'], subject, text })
  });
  if (!response.ok) console.error('Mailnotifikation fejlede', await response.text());
  return response.ok;
}

async function notifyCustomer(email, subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !email) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'VisuPlanner <notifikation@visuplanner.dk>', to: [email], subject, text })
  });
  if (!response.ok) console.error('Kundebekræftelse fejlede', await response.text());
  return response.ok;
}

module.exports = async function handler(request, response) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return response.status(503).json({ error: 'Kontofunktionen er ikke klar endnu.' });
  if (request.method !== 'POST') return response.status(405).json({ error: 'Kun POST er tilladt.' });
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return response.status(401).json({ error: 'Log ind som personale.' });
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: authorization } });
  if (!userResponse.ok) return response.status(401).json({ error: 'Personalesessionen er udløbet.' });
  const user = await parse(userResponse);
  const teams = await service(`/rest/v1/teams_registry?editor_user_id=eq.${encodeURIComponent(user.id)}&select=*`, secret);
  const team = teams?.[0];
  if (!team) return response.status(403).json({ error: 'Brugeren er ikke koblet til et team.' });
  try {
    const { action, value } = request.body || {};
    if (action === 'reset-viewer') {
      if (String(value || '').length < 6) return response.status(400).json({ error: 'Tavlekoden skal have mindst seks tegn.' });
      await service(`/auth/v1/admin/users/${team.viewer_user_id}`, secret, { method: 'PUT', body: JSON.stringify({ password: String(value) }) });
      await saveTeamCredential(team.slug, 'viewer', String(value), secret).catch(error => console.error('Tavlekoden kunne ikke gemmes krypteret.', error.message));
      return response.status(200).json({ ok: true });
    }
    if (action === 'request-subscription') {
      if (!team.customer_id) return response.status(400).json({ error: 'Kunden er ikke koblet til en aftale endnu.' });
      const customers = await service(`/rest/v1/customers?id=eq.${encodeURIComponent(team.customer_id)}&select=*`, secret);
      const customer = customers?.[0];
      if (!customer) return response.status(404).json({ error: 'Kunden blev ikke fundet.' });
      const now = new Date();
      const requestedAt = customer.subscription_interest_at || now.toISOString();
      const trialStartedAt = customer.trial_started_at ? new Date(customer.trial_started_at) : null;
      const graceEndsAt = trialStartedAt ? new Date(trialStartedAt.getTime() + 25 * 86400000) : null;
      const graceCanEdit = Boolean(graceEndsAt && graceEndsAt > now);
      if (!customer.subscription_interest_at) {
        await service(`/rest/v1/customers?id=eq.${encodeURIComponent(customer.id)}`, secret, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ subscription_interest_at: requestedAt, updated_at: now.toISOString() }) });
        const formattedGrace = graceEndsAt ? new Intl.DateTimeFormat('da-DK', { dateStyle: 'long' }).format(graceEndsAt) : 'den oplyste frist';
        await Promise.all([
          notifyOwner(`Kunde ønsker aktivering af VisuPlanner: ${customer.display_name}`, `Kunde: ${customer.display_name}\nTavle: ${team.name}\nKontakt: ${customer.contact_name || ''}\nMail: ${customer.contact_email || team.recovery_email}\nRedigering mulig til: ${formattedGrace}\n\nKontakt kunden om pakke, faktura og aktivering.`),
          notifyCustomer(customer.contact_email || team.recovery_email, 'Vi har modtaget jeres anmodning om aktivering', `Hej${customer.contact_name ? ` ${customer.contact_name}` : ''}\n\nVi har modtaget jeres anmodning om aktivering af VisuPlanner. Vi behandler jeres anmodning hurtigst muligt.\n\n${graceCanEdit ? `I kan fortsætte med at redigere tavlen frem til ${formattedGrace}, mens anmodningen behandles.` : 'Redigeringen forbliver låst, indtil Techus Nord har behandlet anmodningen.'}\n\nVenlig hilsen\nTechus Nord`)
        ]);
      }
      return response.status(200).json({ ok: true, requested_at: requestedAt, grace_ends_at: graceEndsAt?.toISOString() || null, can_edit: graceCanEdit });
    }
    return response.status(400).json({ error: 'Ukendt handling.' });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: 'Handlingen kunne ikke gennemføres.' });
  }
};
