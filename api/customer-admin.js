const mainHandler = require('../lib/customer-admin-main-handler');
const { customerAdminContext, audit, service } = require('../lib/customer-admin-security');

module.exports = async function handler(request, response) {
  if (request.method === 'POST' && request.body?.action === 'admin-login') {
    response.setHeader('Cache-Control', 'no-store');
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return response.status(503).json({ error:'Kundeadministrationen er ikke klar.' });
    try {
      const context = await customerAdminContext(request.headers.authorization || '', secret);
      if (!context) return response.status(403).json({ error:'Du har ikke adgang som kundeadministrator.' });
      const now = new Date().toISOString();
      await audit(context, 'admin_login', null, 'customer_admin', secret);
      await service(`/rest/v1/customer_admins?id=eq.${encodeURIComponent(context.admin.id)}`, secret, {
        method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ last_login_at:now })
      }).catch(() => {});
      return response.status(200).json({ ok:true });
    } catch (error) {
      console.error('Login til kundeadministrationen kunne ikke registreres.', error);
      return response.status(500).json({ error:'Login kunne ikke registreres i hændelsesloggen.' });
    }
  }
  return mainHandler(request, response);
};
