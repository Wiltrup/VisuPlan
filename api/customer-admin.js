const mainHandler = require('../lib/customer-admin-main-handler');
const { customerAdminContext, audit, service, sendMail } = require('../lib/customer-admin-security');

function subscriptionPayload(customer) {
  return {
    status: customer.subscription_status,
    trial_started_at: customer.trial_started_at,
    trial_ends_at: customer.trial_ends_at,
    subscription_interest_at: customer.subscription_interest_at,
    subscription_renews_at: customer.subscription_renews_at,
    plan_code: customer.plan_code,
    board_limit: customer.board_limit
  };
}

module.exports = async function handler(request, response) {
  const action = request.body?.action;
  if (request.method === 'POST' && ['admin-login','subscription-status','request-subscription'].includes(action)) {
    response.setHeader('Cache-Control', 'no-store');
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return response.status(503).json({ error:'Kundeadministrationen er ikke klar.' });
    try {
      const context = await customerAdminContext(request.headers.authorization || '', secret);
      if (!context) return response.status(403).json({ error:'Du har ikke adgang som kundeadministrator.' });

      if (action === 'subscription-status') {
        return response.status(200).json(subscriptionPayload(context.customer));
      }

      if (action === 'request-subscription') {
        if (!['trial','read_only'].includes(context.customer.subscription_status)) {
          return response.status(200).json({ ok:true, already_active:true, ...subscriptionPayload(context.customer) });
        }
        const now = new Date().toISOString();
        if (!context.customer.subscription_interest_at) {
          await service(`/rest/v1/customers?id=eq.${encodeURIComponent(context.customer.id)}`, secret, {
            method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ subscription_interest_at:now, updated_at:now })
          });
          await audit(context, 'subscription_requested', null, 'subscription', secret);
          const ownerText = `Kunde: ${context.customer.display_name}\nKundeadministrator: ${context.admin.name} (${context.admin.email})\n\nKunden ønsker at fortsætte med VisuPlanner. Kontakt kunden om pakke, faktura og aktivering.`;
          const customerText = `Hej ${context.admin.name}\n\nVi har modtaget jeres anmodning om at fortsætte med VisuPlanner. Techus Nord behandler anmodningen hurtigst muligt.\n\nVenlig hilsen\nTechus Nord`;
          await Promise.all([
            sendMail('wiltrup@wiltrup.com', `Kunde ønsker aktivering af VisuPlanner: ${context.customer.display_name}`, ownerText),
            sendMail(context.admin.email, 'Vi har modtaget jeres anmodning om aktivering', customerText)
          ]).catch(error => console.error('Aktiveringsmail kunne ikke sendes.', error.message));
          context.customer.subscription_interest_at = now;
        }
        return response.status(200).json({ ok:true, ...subscriptionPayload(context.customer) });
      }

      const now = new Date().toISOString();
      await audit(context, 'admin_login', null, 'customer_admin', secret);
      await service(`/rest/v1/customer_admins?id=eq.${encodeURIComponent(context.admin.id)}`, secret, {
        method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ last_login_at:now })
      }).catch(() => {});
      return response.status(200).json({ ok:true });
    } catch (error) {
      console.error('Kundeadministratorhandlingen mislykkedes.', error);
      return response.status(500).json({ error:'Handlingen kunne ikke gennemføres.' });
    }
  }
  return mainHandler(request, response);
};
