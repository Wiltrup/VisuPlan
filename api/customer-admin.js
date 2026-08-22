const crypto = require('crypto');
const customerAdminAccess = require('../lib/customer-admin-access-handler');
const {
  clean, randomPassword, slugify, service, customerAdminContext,
  audit, sendMail, decryptCredential, encryptCredential, saveTeamCredential
} = require('../lib/customer-admin-security');

async function slugAvailable(slug, secret) {
  if (!/^[a-z0-9-]{3,120}$/.test(slug)) return false;
  const rows = await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&select=slug`, secret);
  return !rows?.length;
}

async function uniqueSlug(base, secret) {
  const stem = slugify(base);
  let candidate = stem;
  let suffix = 2;
  while (!(await slugAvailable(candidate, secret))) candidate = `${stem}-${suffix++}`;
  return candidate;
}

const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');

async function createTeamInvitation(team, customer, secret, host, purpose = 'activation') {
  await service(`/rest/v1/team_invitations?team_slug=eq.${encodeURIComponent(team.slug)}&purpose=eq.${purpose}&used_at=is.null`, secret, {
    method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ used_at:new Date().toISOString() })
  });
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = purpose === 'password_reset' ? 1 : 72;
  await service('/rest/v1/team_invitations', secret, {
    method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({
      team_slug:team.slug, customer_id:customer.id, purpose, token_hash:hash(token),
      contact_email:team.recovery_email, expires_at:new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    })
  });
  const origin = `https://${host || 'visuplanner.dk'}`;
  const inviteUrl = `${origin}/aktiver?token=${encodeURIComponent(token)}`;
  const reset = purpose === 'password_reset';
  const subject = reset ? `Vælg en ny personalekode til ${team.name}` : `Gør ${team.name} klar i VisuPlanner`;
  const text = reset
    ? `Vælg en ny personalekode via dette engangslink:\n\n${inviteUrl}\n\nLinket udløber efter 1 time.`
    : `Jeres VisuPlanner-tavle er oprettet. Vælg personale- og tavlekode via dette engangslink:\n\n${inviteUrl}\n\nLinket udløber efter 72 timer.`;
  return { inviteUrl, mailSent:await sendMail(team.recovery_email, subject, text) };
}

async function createBoard(input, context, secret, host) {
  const customer = context.customer;
  const existing = await service(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(customer.id)}&archived_at=is.null&select=slug`, secret);
  const trialLimit = customer.subscription_status === 'trial' ? 1 : Number(customer.board_limit || 1);
  if ((existing || []).length >= trialLimit) throw new Error(customer.subscription_status === 'trial'
    ? 'Prøveperioden omfatter én tavle. Techus Nord skal aktivere pakken, før flere tavler kan oprettes.'
    : `Pakken tillader højst ${customer.board_limit} tavler.`);
  if (['read_only','cancelled','overdue'].includes(customer.subscription_status)) throw new Error('Kundens aftale tillader ikke oprettelse af nye tavler lige nu.');

  const name = clean(input.name, 150);
  const workplace = clean(input.workplace || customer.display_name, 200);
  const municipality = clean(input.municipality || customer.municipality, 150);
  const recoveryEmail = clean(input.recovery_email, 200).toLowerCase();
  if (!name || !workplace || !municipality || !/^\S+@\S+\.\S+$/.test(recoveryEmail)) throw new Error('Udfyld tavlenavn og en gyldig ansvarlig arbejdsmail.');
  const requested = clean(input.slug, 120);
  const slug = requested ? slugify(requested) : await uniqueSlug(`${customer.url_slug || customer.display_name}-${name}`, secret);
  if (!(await slugAvailable(slug, secret))) throw new Error('Den ønskede tavleadresse er allerede i brug. Lad URL-feltet stå tomt for automatisk valg.');

  let editor = null;
  let viewer = null;
  let teamCreated = false;
  try {
    editor = await service('/auth/v1/admin/users', secret, { method:'POST', body:JSON.stringify({
      email:`${slug}-editor@visuplanner.invalid`, password:randomPassword(), email_confirm:true,
      user_metadata:{ role:'editor', team_slug:slug }
    }) });
    viewer = await service('/auth/v1/admin/users', secret, { method:'POST', body:JSON.stringify({
      email:`${slug}-viewer@visuplanner.invalid`, password:randomPassword(), email_confirm:true,
      user_metadata:{ role:'viewer', team_slug:slug }
    }) });
    const rows = await service('/rest/v1/teams_registry?select=*', secret, {
      method:'POST', headers:{ Prefer:'return=representation' }, body:JSON.stringify({
        slug, name, workplace, municipality, recovery_email:recoveryEmail,
        editor_user_id:editor.id, viewer_user_id:viewer.id,
        onboarding_status:'invited', customer_id:customer.id
      })
    });
    teamCreated = true;
    const team = rows?.[0];
    const invitation = await createTeamInvitation(team, customer, secret, host);
    await audit(context, 'board_created', slug, 'team', secret);
    return {
      team:{
        slug:team.slug, name:team.name, workplace:team.workplace,
        municipality:team.municipality, recovery_email:team.recovery_email,
        onboarding_status:team.onboarding_status
      },
      ...invitation
    };
  } catch (error) {
    if (teamCreated) await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}`, secret, { method:'DELETE', headers:{ Prefer:'return=minimal' } }).catch(() => {});
    if (viewer?.id) await service(`/auth/v1/admin/users/${viewer.id}`, secret, { method:'DELETE' }).catch(() => {});
    if (editor?.id) await service(`/auth/v1/admin/users/${editor.id}`, secret, { method:'DELETE' }).catch(() => {});
    throw error;
  }
}

async function scopedTeam(slug, customerId, secret) {
  const rows = await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&customer_id=eq.${encodeURIComponent(customerId)}&archived_at=is.null&select=*`, secret);
  return rows?.[0] || null;
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.query?.flow === 'access') return customerAdminAccess(request, response);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return response.status(503).json({ error:'Kundeadministrationen er ikke klar.' });
  const context = await customerAdminContext(request.headers.authorization || '', secret).catch(() => null);
  if (!context) return response.status(403).json({ error:'Du har ikke adgang som kundeadministrator.' });

  try {
    if (request.method === 'GET') {
      const [teams, admins, logs, offers] = await Promise.all([
        service(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(context.customer.id)}&archived_at=is.null&select=slug,name,workplace,municipality,recovery_email,onboarding_status,created_at,activated_at&order=name.asc`, secret),
        service(`/rest/v1/customer_admins?customer_id=eq.${encodeURIComponent(context.customer.id)}&active=eq.true&select=name,email,activated_at&order=name.asc`, secret),
        service(`/rest/v1/customer_admin_audit_log?customer_id=eq.${encodeURIComponent(context.customer.id)}&select=admin_name,admin_email,team_slug,action,target_kind,created_at&order=created_at.desc&limit=50`, secret),
        service(`/rest/v1/shared_offers?customer_id=eq.${encodeURIComponent(context.customer.id)}&archived_at=is.null&select=id,name,slug,customer_slug,own_board_enabled&order=name.asc`, secret)
      ]);
      const teamSlugs = (teams || []).map(team => team.slug).filter(Boolean);
      const credentials = teamSlugs.length
        ? await service(`/rest/v1/team_credentials?team_slug=in.(${teamSlugs.join(',')})&select=team_slug,editor_code_ciphertext,viewer_code_ciphertext,editor_changed_at,viewer_changed_at`, secret)
        : [];
      const credentialMap = new Map((credentials || []).map(item => [item.team_slug, item]));
      const boardLimit = context.customer.subscription_status === 'trial' ? 1 : Number(context.customer.board_limit || 1);
      await service(`/rest/v1/customer_admins?id=eq.${encodeURIComponent(context.admin.id)}`, secret, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ last_login_at:new Date().toISOString() }) }).catch(() => {});
      return response.status(200).json({
        customer:{ id:context.customer.id, name:context.customer.display_name, municipality:context.customer.municipality, plan_code:context.customer.plan_code, subscription_status:context.customer.subscription_status, board_limit:boardLimit },
        currentAdmin:{ name:context.admin.name, email:context.admin.email },
        teams:(teams || []).map(team => {
          const stored = credentialMap.get(team.slug) || {};
          return { ...team, has_editor_code:Boolean(stored.editor_code_ciphertext), has_viewer_code:Boolean(stored.viewer_code_ciphertext), editor_changed_at:stored.editor_changed_at || null, viewer_changed_at:stored.viewer_changed_at || null };
        }),
        remainingBoards:Math.max(0, boardLimit - (teams || []).length),
        canCreateBoards:!['read_only','cancelled','overdue'].includes(context.customer.subscription_status) && (teams || []).length < boardLimit,
        admins:admins || [], logs:logs || [], offers:offers || []
      });
    }
    if (request.method !== 'POST') return response.status(405).json({ error:'Kun GET og POST er tilladt.' });
    const body = request.body || {};
    const action = clean(body.action, 80);

    if (action === 'create-board') {
      const result = await createBoard(body, context, secret, request.headers.host);
      return response.status(200).json({ ok:true, ...result, boardUrl:`/${result.team.slug}` });
    }

    const team = await scopedTeam(clean(body.team_slug, 120), context.customer.id, secret);
    if (!team) return response.status(404).json({ error:'Tavlen blev ikke fundet hos denne kunde.' });

    if (action === 'reveal-code') {
      const kind = body.kind === 'viewer' ? 'viewer' : 'editor';
      const rows = await service(`/rest/v1/team_credentials?team_slug=eq.${encodeURIComponent(team.slug)}&select=*`, secret);
      const encrypted = rows?.[0]?.[`${kind}_code_ciphertext`];
      if (!encrypted) return response.status(404).json({ error:'Koden er oprettet før kundeadministrationen. Vælg en ny kode for at gøre den synlig.' });
      const value = decryptCredential(encrypted);
      await audit(context, 'code_revealed', team.slug, kind, secret);
      return response.status(200).json({ ok:true, value });
    }

    if (action === 'reset-code') {
      const kind = body.kind === 'viewer' ? 'viewer' : 'editor';
      const value = String(body.value || '');
      const minimum = kind === 'viewer' ? 6 : 8;
      if (value.length < minimum) return response.status(400).json({ error:`Koden skal have mindst ${minimum} tegn.` });
      encryptCredential(value);
      const otherKind = kind === 'viewer' ? 'editor' : 'viewer';
      const credentialRows = await service(`/rest/v1/team_credentials?team_slug=eq.${encodeURIComponent(team.slug)}&select=*`, secret);
      const otherEncrypted = credentialRows?.[0]?.[`${otherKind}_code_ciphertext`];
      if (otherEncrypted && decryptCredential(otherEncrypted) === value) return response.status(400).json({ error:'Tavle- og personalekoden skal være forskellige.' });
      const userId = team[`${kind}_user_id`];
      if (!userId) return response.status(400).json({ error:'Tavlens loginbruger mangler.' });
      await service(`/auth/v1/admin/users/${userId}`, secret, { method:'PUT', body:JSON.stringify({ password:value }) });
      await saveTeamCredential(team.slug, kind, value, secret);
      await audit(context, 'code_changed', team.slug, kind, secret);
      return response.status(200).json({ ok:true });
    }

    if (action === 'save-team') {
      const update = {
        name:clean(body.name, 150), workplace:clean(body.workplace, 200),
        municipality:clean(body.municipality, 150), recovery_email:clean(body.recovery_email, 200).toLowerCase(),
        updated_at:new Date().toISOString()
      };
      if (!update.name || !update.workplace || !update.municipality || !/^\S+@\S+\.\S+$/.test(update.recovery_email)) return response.status(400).json({ error:'Udfyld gyldige tavleoplysninger.' });
      await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(team.slug)}&customer_id=eq.${encodeURIComponent(context.customer.id)}`, secret, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(update) });
      await audit(context, 'team_updated', team.slug, 'team', secret);
      return response.status(200).json({ ok:true });
    }

    if (action === 'send-invite' || action === 'send-editor-reset') {
      const purpose = action === 'send-editor-reset' ? 'password_reset' : 'activation';
      if (purpose === 'activation' && team.onboarding_status === 'active') return response.status(400).json({ error:'Tavlen er allerede aktiveret. Send i stedet et nulstillingslink.' });
      const result = await createTeamInvitation(team, context.customer, secret, request.headers.host, purpose);
      await audit(context, purpose === 'activation' ? 'activation_sent' : 'password_reset_sent', team.slug, 'editor', secret);
      return response.status(200).json({ ok:true, ...result });
    }

    return response.status(400).json({ error:'Ukendt handling.' });
  } catch (error) {
    console.error(error);
    const message = /pakken|prøveperioden|udfyld|adgang|kode|tavleadresse|aftale|krypter/i.test(String(error.message)) ? error.message : 'Handlingen kunne ikke gennemføres.';
    const status = error.code === 'MISSING_ENCRYPTION_KEY' ? 503 : message === error.message ? 400 : 500;
    return response.status(status).json({ error:message });
  }
};
