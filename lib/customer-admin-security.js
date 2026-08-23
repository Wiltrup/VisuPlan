const crypto = require('crypto');

const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';

const clean = (value, max = 300) => String(value || '').trim().slice(0, max);
const tokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const randomPassword = () => crypto.randomBytes(32).toString('base64url');
const slugify = value => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'tavle';

async function parse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function service(path, secret, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey:secret, Authorization:`Bearer ${secret}`, 'Content-Type':'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error((await response.text()) || `Supabase svarede ${response.status}`);
  return parse(response);
}

function encryptionKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY || '';
  if (raw.length < 32) {
    const error = new Error('Kryptering af fælleskoder er ikke konfigureret. Tilføj CREDENTIALS_ENCRYPTION_KEY i Vercel.');
    error.code = 'MISSING_ENCRYPTION_KEY';
    throw error;
  }
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptCredential(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptCredential(payload) {
  if (!payload) return '';
  const [version, iv, tag, encrypted] = String(payload).split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Den gemte kode kunne ikke læses. Vælg en ny kode.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Den gemte kode kunne ikke dekrypteres. Vælg en ny kode.');
  }
}

async function saveTeamCredential(teamSlug, kind, value, secret) {
  const column = kind === 'viewer' ? 'viewer_code_ciphertext' : 'editor_code_ciphertext';
  const changed = kind === 'viewer' ? 'viewer_changed_at' : 'editor_changed_at';
  const now = new Date().toISOString();
  await service('/rest/v1/team_credentials?on_conflict=team_slug', secret, {
    method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' },
    body:JSON.stringify({ team_slug:teamSlug, [column]:encryptCredential(value), [changed]:now, updated_at:now })
  });
}

async function saveOfferCredential(offerId, kind, value, secret) {
  const column = kind === 'viewer' ? 'viewer_code_ciphertext' : 'editor_code_ciphertext';
  const changed = kind === 'viewer' ? 'viewer_changed_at' : 'editor_changed_at';
  const now = new Date().toISOString();
  await service('/rest/v1/shared_offer_credentials?on_conflict=offer_id', secret, {
    method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' },
    body:JSON.stringify({ offer_id:offerId, [column]:encryptCredential(value), [changed]:now, updated_at:now })
  });
}

async function authenticatedUser(authorization) {
  if (!String(authorization || '').startsWith('Bearer ')) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers:{ apikey:SUPABASE_KEY, Authorization:authorization } });
  return response.ok ? parse(response) : null;
}

async function customerAdminContext(authorization, secret) {
  const user = await authenticatedUser(authorization);
  if (!user) return null;
  const rows = await service(`/rest/v1/customer_admins?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=*`, secret);
  const admin = rows?.[0];
  if (!admin) return null;
  const customers = await service(`/rest/v1/customers?id=eq.${encodeURIComponent(admin.customer_id)}&archived_at=is.null&select=*`, secret);
  const customer = customers?.[0];
  if (!customer) return null;
  return { user, admin, customer };
}

async function audit(context, action, teamSlug, targetKind, secret) {
  try {
    await service('/rest/v1/customer_admin_audit_log', secret, {
      method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({
        customer_id:context.customer.id, admin_user_id:context.user.id,
        admin_name:context.admin.name, admin_email:context.admin.email,
        team_slug:teamSlug || null, action, target_kind:targetKind || null
      })
    });
    return true;
  } catch (error) {
    console.error('Administratorhandlingen kunne ikke skrives i hændelsesloggen.', { action, teamSlug, targetKind, error:error.message });
    return false;
  }
}

async function sendMail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST', headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ from:'VisuPlanner <velkommen@visuplanner.dk>', to:[to], subject, text })
    });
    if (!response.ok) console.error('Kundeadministratormail fejlede', await response.text());
    return response.ok;
  } catch (error) {
    console.error('Kundeadministratormail kunne ikke sendes.', error.message);
    return false;
  }
}

async function createCustomerAdminInvitation({ customer, name, email, userId = null, purpose = 'activation', secret, host }) {
  const safeEmail = clean(email, 200).toLowerCase();
  const safeName = clean(name, 150);
  if (!safeName || !/^\S+@\S+\.\S+$/.test(safeEmail)) throw new Error('Udfyld navn og en gyldig arbejdsmail.');
  await service(`/rest/v1/customer_admin_invitations?customer_id=eq.${encodeURIComponent(customer.id)}&email=eq.${encodeURIComponent(safeEmail)}&purpose=eq.${purpose}&used_at=is.null`, secret, {
    method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ used_at:new Date().toISOString() })
  });
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (purpose === 'password_reset' ? 60 : 72 * 60) * 60 * 1000).toISOString();
  await service('/rest/v1/customer_admin_invitations', secret, {
    method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({
      customer_id:customer.id, admin_user_id:userId, name:safeName, email:safeEmail,
      purpose, token_hash:tokenHash(token), expires_at:expiresAt
    })
  });
  const origin = `https://${host || 'visuplanner.dk'}`;
  const inviteUrl = `${origin}/kundeadmin-aktiver?token=${encodeURIComponent(token)}`;
  const reset = purpose === 'password_reset';
  const subject = reset ? `Vælg en ny adgangskode til ${customer.display_name}` : `Administratoradgang til ${customer.display_name} i VisuPlanner`;
  const text = reset
    ? `Vælg en ny personlig adgangskode til kundeadministrationen via dette engangslink:\n\n${inviteUrl}\n\nLinket udløber efter 1 time.`
    : `Du er inviteret som kundeadministrator for ${customer.display_name} i VisuPlanner. Opret dit personlige login via dette engangslink:\n\n${inviteUrl}\n\nLinket udløber efter 72 timer.`;
  return { inviteUrl, mailSent:await sendMail(safeEmail, subject, text) };
}

module.exports = {
  SUPABASE_URL, SUPABASE_KEY, clean, tokenHash, randomPassword, slugify, parse, service,
  encryptCredential, decryptCredential, saveTeamCredential, saveOfferCredential, authenticatedUser,
  customerAdminContext, audit, sendMail, createCustomerAdminInvitation
};
