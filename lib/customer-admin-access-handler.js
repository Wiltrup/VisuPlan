const {
  SUPABASE_URL, clean, tokenHash, service, createCustomerAdminInvitation
} = require('./customer-admin-security');

async function invitationForToken(token, secret) {
  if (String(token || '').length < 30) return null;
  const rows = await service(`/rest/v1/customer_admin_invitations?token_hash=eq.${tokenHash(token)}&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`, secret);
  return rows?.[0] || null;
}

module.exports = async function customerAdminAccess(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return response.status(503).json({ error:'Kundeadministrationen er ikke klar.' });
  if (!['GET','POST'].includes(request.method)) return response.status(405).json({ error:'Metoden er ikke tilladt.' });
  try {
    if (request.method === 'POST' && request.body?.action === 'request-reset') {
      const email = clean(request.body.email, 200).toLowerCase();
      if (/^\S+@\S+\.\S+$/.test(email)) {
        const admins = await service(`/rest/v1/customer_admins?email=eq.${encodeURIComponent(email)}&active=eq.true&select=*`, secret);
        const admin = admins?.[0];
        if (admin) {
          const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const recent = await service(`/rest/v1/customer_admin_invitations?admin_user_id=eq.${encodeURIComponent(admin.user_id)}&purpose=eq.password_reset&used_at=is.null&created_at=gt.${encodeURIComponent(since)}&select=id&limit=1`, secret);
          if (!recent?.length) {
            const customers = await service(`/rest/v1/customers?id=eq.${encodeURIComponent(admin.customer_id)}&archived_at=is.null&select=*`, secret);
            const customer = customers?.[0];
            if (customer) await createCustomerAdminInvitation({ customer, name:admin.name, email:admin.email, userId:admin.user_id, purpose:'password_reset', secret, host:request.headers.host });
          }
        }
      }
      return response.status(200).json({ ok:true });
    }

    const token = String(request.method === 'GET' ? request.query?.token : request.body?.token || '');
    const invitation = await invitationForToken(token, secret);
    if (!invitation) return response.status(410).json({ error:'Linket er brugt eller udløbet. Bed Techus Nord om et nyt link.' });
    const customers = await service(`/rest/v1/customers?id=eq.${encodeURIComponent(invitation.customer_id)}&archived_at=is.null&select=id,display_name`, secret);
    const customer = customers?.[0];
    if (!customer) return response.status(404).json({ error:'Kunden blev ikke fundet.' });

    if (request.method === 'GET') return response.status(200).json({
      customerName:customer.display_name, name:invitation.name, email:invitation.email, purpose:invitation.purpose
    });

    const password = String(request.body?.password || '');
    if (password.length < 10) return response.status(400).json({ error:'Adgangskoden skal have mindst 10 tegn.' });
    const now = new Date().toISOString();

    if (invitation.purpose === 'password_reset') {
      if (!invitation.admin_user_id) return response.status(400).json({ error:'Nulstillingslinket mangler en administrator.' });
      const admins = await service(`/rest/v1/customer_admins?user_id=eq.${encodeURIComponent(invitation.admin_user_id)}&customer_id=eq.${encodeURIComponent(customer.id)}&active=eq.true&select=id`, secret);
      if (!admins?.length) return response.status(403).json({ error:'Administratoradgangen er ikke længere aktiv.' });
      await service(`/auth/v1/admin/users/${invitation.admin_user_id}`, secret, { method:'PUT', body:JSON.stringify({ password }) });
      await service(`/rest/v1/customer_admin_invitations?id=eq.${encodeURIComponent(invitation.id)}`, secret, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ used_at:now }) });
      return response.status(200).json({ ok:true, reset:true });
    }

    const existing = await service(`/rest/v1/customer_admins?customer_id=eq.${encodeURIComponent(customer.id)}&email=eq.${encodeURIComponent(invitation.email)}&select=id`, secret);
    if (existing?.length) return response.status(409).json({ error:'Denne administrator er allerede oprettet. Brug “Glemt adgangskode” på login-siden.' });
    let user = null;
    try {
      user = await service('/auth/v1/admin/users', secret, {
        method:'POST', body:JSON.stringify({
          email:invitation.email, password, email_confirm:true,
          user_metadata:{ role:'customer_admin', customer_id:customer.id, name:invitation.name }
        })
      });
      await service('/rest/v1/customer_admins', secret, {
        method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({
          customer_id:customer.id, user_id:user.id, name:invitation.name, email:invitation.email,
          active:true, invited_at:invitation.created_at, activated_at:now
        })
      });
      await service(`/rest/v1/customer_admin_invitations?id=eq.${encodeURIComponent(invitation.id)}`, secret, {
        method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ admin_user_id:user.id, used_at:now })
      });
      return response.status(200).json({ ok:true, reset:false });
    } catch (error) {
      if (user?.id) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method:'DELETE', headers:{ apikey:secret, Authorization:`Bearer ${secret}` } }).catch(() => {});
      if (/already|registered|duplicate/i.test(String(error.message))) return response.status(409).json({ error:'Arbejdsmailen er allerede knyttet til et login. Kontakt Techus Nord.' });
      throw error;
    }
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error:'Handlingen kunne ikke gennemføres. Prøv igen eller kontakt Techus Nord.' });
  }
};
