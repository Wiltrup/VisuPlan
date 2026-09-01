const crypto = require('crypto');
const customerAdminAccess = require('../lib/customer-admin-access-handler');
const {
  clean, randomPassword, slugify, service, customerAdminContext,
  audit, sendMail, decryptCredential, encryptCredential, saveTeamCredential, saveOfferCredential
} = require('../lib/customer-admin-security');
const { isReservedBoardSlug, withNumericSuffix } = require('../lib/board-slugs');
const { safeRoutes, publicPath, uniquePublicSlug, createRoute, routeMaps } = require('../lib/board-routes');

async function slugAvailable(slug, secret) {
  if (!/^[a-z0-9-]{3,120}$/.test(slug)) return false;
  if (isReservedBoardSlug(slug)) return false;
  const rows = await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&select=slug`, secret);
  return !rows?.length;
}

async function uniqueSlug(base, secret) {
  const stem = slugify(base);
  let candidate = stem;
  let suffix = 2;
  while (!(await slugAvailable(candidate, secret))) candidate = withNumericSuffix(stem, suffix++);
  return candidate;
}

async function offerSlugAvailable(slug, secret) {
  const rows = await service(`/rest/v1/shared_offers?slug=eq.${encodeURIComponent(slug)}&select=slug`, secret);
  return !rows?.length;
}

async function uniqueOfferSlug(base, secret) {
  const stem = slugify(base);
  let candidate = stem;
  let suffix = 2;
  while (!(await offerSlugAvailable(candidate, secret))) candidate = withNumericSuffix(stem, suffix++);
  return candidate;
}

async function listStorageFiles(prefix, secret) {
  const items = await service('/storage/v1/object/list/visuplan-images', secret, {
    method:'POST', body:JSON.stringify({ prefix, limit:1000, offset:0, sortBy:{ column:'name', order:'asc' } })
  }) || [];
  const files = [];
  for (const item of items) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) files.push(path);
    else files.push(...await listStorageFiles(path, secret));
  }
  return files;
}

async function deleteStoragePrefix(prefix, secret) {
  const files = await listStorageFiles(prefix, secret);
  for (let index = 0; index < files.length; index += 100) {
    await service('/storage/v1/object/visuplan-images', secret, {
      method:'DELETE', body:JSON.stringify({ prefixes:files.slice(index, index + 100) })
    });
  }
}

async function deleteAuthUser(userId, secret) {
  if (!userId) return;
  await service(`/auth/v1/admin/users/${userId}`, secret, { method:'DELETE' }).catch(error => {
    console.warn('Tavlens tekniske login kunne ikke slettes eller var allerede slettet.', userId, error.message);
  });
}

async function deleteOfferCompletely(offer, secret) {
  await deleteStoragePrefix(`offers/${offer.id}`, secret);
  await service(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(offer.id)}&customer_id=eq.${encodeURIComponent(offer.customer_id)}`, secret, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
  await Promise.all([deleteAuthUser(offer.editor_user_id, secret), deleteAuthUser(offer.viewer_user_id, secret)]);
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

async function createClubInvitation(offer, customer, secret, host, purpose = 'activation') {
  await service(`/rest/v1/shared_offer_invitations?offer_id=eq.${encodeURIComponent(offer.id)}&purpose=eq.${purpose}&used_at=is.null`, secret, {
    method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ used_at:new Date().toISOString() })
  });
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = purpose === 'password_reset' ? 1 : 72;
  await service('/rest/v1/shared_offer_invitations', secret, { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({
    offer_id:offer.id, customer_id:customer.id, purpose, token_hash:hash(token), contact_email:offer.recovery_email,
    expires_at:new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
  }) });
  const inviteUrl = `https://${host || 'visuplanner.dk'}/aktiver?token=${encodeURIComponent(token)}`;
  const reset = purpose === 'password_reset';
  const subject = reset ? `Vælg en ny redigeringskode til ${offer.name}` : `Gør ${offer.name} klar i VisuPlanner`;
  const text = reset
    ? `Vælg en ny redigeringskode via dette engangslink:\n\n${inviteUrl}\n\nLinket udløber efter 1 time.`
    : `Jeres VisuPlanner-klubtavle er oprettet. Vælg redigerings- og tavlekode via dette engangslink:\n\n${inviteUrl}\n\nLinket udløber efter 72 timer.`;
  return { inviteUrl, mailSent:await sendMail(offer.recovery_email, subject, text) };
}

async function createBoard(input, context, secret, host) {
  const customer = context.customer;
  const existing = await service(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(customer.id)}&archived_at=is.null&select=slug`, secret);
  const boardLimit = Number(customer.board_limit || 1);
  if ((existing || []).length >= boardLimit) throw new Error(`Pakken tillader højst ${boardLimit} tavler.`);
  if (['read_only','cancelled','overdue'].includes(customer.subscription_status)) throw new Error('Kundens aftale tillader ikke oprettelse af nye tavler lige nu.');

  const name = clean(input.name, 150);
  const workplace = clean(input.workplace || customer.display_name, 200);
  const municipality = clean(customer.municipality, 150);
  const recoveryEmail = clean(input.recovery_email, 200).toLowerCase();
  if (!name || !workplace || !municipality || !/^\S+@\S+\.\S+$/.test(recoveryEmail)) throw new Error('Udfyld tavlenavn og en gyldig ansvarlig arbejdsmail.');
  const requested = clean(input.slug, 120);
  const requestedSlug = requested ? slugify(requested) : '';
  const boardSlug = await uniquePublicSlug(service, secret, customer, requestedSlug || name, slugify);
  const slug = await uniqueSlug(`${customer.url_slug || customer.display_name}-${boardSlug}`, secret);
  const slugAdjusted = Boolean(requestedSlug && boardSlug !== requestedSlug);

  let editor = null;
  let viewer = null;
  let teamCreated = false;
  const technicalId = crypto.randomBytes(8).toString('hex');
  try {
    editor = await service('/auth/v1/admin/users', secret, { method:'POST', body:JSON.stringify({
      email:`${slug}-${technicalId}-editor@visuplanner.invalid`, password:randomPassword(), email_confirm:true,
      user_metadata:{ role:'editor', team_slug:slug }
    }) });
    viewer = await service('/auth/v1/admin/users', secret, { method:'POST', body:JSON.stringify({
      email:`${slug}-${technicalId}-viewer@visuplanner.invalid`, password:randomPassword(), email_confirm:true,
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
    const route = await createRoute(service, secret, {
      customer_id:customer.id, customer_slug:customer.url_slug || slugify(customer.display_name),
      board_slug:boardSlug, board_kind:'team', team_slug:team.slug
    });
    const invitation = await createTeamInvitation(team, customer, secret, host);
    await audit(context, 'board_created', slug, 'team', secret);
    return {
      team:{
        slug:team.slug, name:team.name, workplace:team.workplace,
        municipality:team.municipality, recovery_email:team.recovery_email,
        onboarding_status:team.onboarding_status
      },
      requestedSlug,
      boardSlug,
      slugAdjusted,
      publicPath:publicPath(route) || `/${team.slug}`,
      ...invitation
    };
  } catch (error) {
    if (teamCreated) await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}`, secret, { method:'DELETE', headers:{ Prefer:'return=minimal' } }).catch(() => {});
    if (viewer?.id) await service(`/auth/v1/admin/users/${viewer.id}`, secret, { method:'DELETE' }).catch(() => {});
    if (editor?.id) await service(`/auth/v1/admin/users/${editor.id}`, secret, { method:'DELETE' }).catch(() => {});
    throw error;
  }
}

async function createClub(input, context, secret) {
  const customer = context.customer;
  if (!customer.club_module_enabled) throw new Error('Klubmodulet er ikke aktiveret på kundens aftale.');
  const existingClubs = await service(`/rest/v1/shared_offers?customer_id=eq.${encodeURIComponent(customer.id)}&archived_at=is.null&select=id&limit=1`, secret);
  if (existingClubs?.length) throw new Error('Klubmodulet omfatter én klubtavle. Slet den eksisterende klubtavle, før I opretter en ny.');
  const name = clean(input.name, 150);
  const recoveryEmail = clean(input.recovery_email || customer.contact_email, 200).toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(recoveryEmail)) throw new Error('Klubbens navn og en gyldig ansvarlig arbejdsmail skal udfyldes.');
  const requestedSlug = input.slug ? slugify(input.slug) : '';
  const boardSlug = await uniquePublicSlug(service, secret, customer, requestedSlug || name, slugify);
  const slug = await uniqueOfferSlug(`${customer.url_slug || customer.display_name}-${boardSlug}`, secret);
  const slugAdjusted = Boolean(requestedSlug && boardSlug !== requestedSlug);
  const technicalId = crypto.randomBytes(8).toString('hex');
  let editor = null;
  let viewer = null;
  let offer = null;
  try {
    editor = await service('/auth/v1/admin/users', secret, { method:'POST', body:JSON.stringify({ email:`${slug}-${technicalId}-offer-editor@visuplanner.invalid`, password:randomPassword(), email_confirm:true, user_metadata:{ role:'offer_editor', offer_slug:slug } }) });
    viewer = await service('/auth/v1/admin/users', secret, { method:'POST', body:JSON.stringify({ email:`${slug}-${technicalId}-offer-viewer@visuplanner.invalid`, password:randomPassword(), email_confirm:true, user_metadata:{ role:'offer_viewer', offer_slug:slug } }) });
    const rows = await service('/rest/v1/shared_offers?select=*', secret, { method:'POST', headers:{ Prefer:'return=representation' }, body:JSON.stringify({
      customer_id:customer.id, slug, customer_slug:customer.url_slug || slugify(customer.display_name), name,
      workplace:clean(input.workplace || customer.display_name, 200), municipality:customer.municipality,
      recovery_email:recoveryEmail, editor_user_id:editor.id, viewer_user_id:viewer.id,
      own_board_enabled:true, registration_module_enabled:true, onboarding_status:'invited'
    }) });
    offer = rows?.[0];
    const route = await createRoute(service, secret, { customer_id:customer.id, customer_slug:customer.url_slug || slugify(customer.display_name), board_slug:boardSlug, board_kind:'offer', offer_id:offer.id });
    const teams = await service(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(customer.id)}&archived_at=is.null&select=slug`, secret);
    const allowed = new Set((teams || []).map(team => team.slug));
    const selected = (Array.isArray(input.team_slugs) ? input.team_slugs : []).filter(teamSlug => allowed.has(teamSlug));
    if (selected.length) await service('/rest/v1/shared_offer_team_links', secret, { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify(selected.map(team_slug => ({ offer_id:offer.id, team_slug, visible_on_team:true }))) });
    await audit(context, 'club_created', null, `club:${slug}`, secret);
    const invitation = await createClubInvitation(offer, customer, secret, input.host);
    return { offer, requestedSlug, boardSlug, slugAdjusted, publicPath:publicPath(route) || `/${offer.customer_slug}/${offer.slug}`, ...invitation };
  } catch (error) {
    console.error('Klubtavlen kunne ikke oprettes.', error);
    if (offer?.id) await service(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(offer.id)}`, secret, { method:'DELETE', headers:{ Prefer:'return=minimal' } }).catch(() => {});
    if (viewer?.id) await service(`/auth/v1/admin/users/${viewer.id}`, secret, { method:'DELETE' }).catch(() => {});
    if (editor?.id) await service(`/auth/v1/admin/users/${editor.id}`, secret, { method:'DELETE' }).catch(() => {});
    throw new Error('Klubtavlen kunne ikke oprettes. Der er ikke sendt et gyldigt aktiveringslink. Prøv igen eller kontakt Techus Nord.');
  }
}

async function scopedTeam(slug, customerId, secret) {
  const rows = await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&customer_id=eq.${encodeURIComponent(customerId)}&archived_at=is.null&select=*`, secret);
  return rows?.[0] || null;
}

async function scopedOffer(id, customerId, secret) {
  const rows = await service(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(id)}&customer_id=eq.${encodeURIComponent(customerId)}&archived_at=is.null&select=*`, secret);
  return rows?.[0] || null;
}

async function clubCredentialRows(offerId, secret) {
  try {
    return await service(`/rest/v1/shared_offer_credentials?offer_id=eq.${encodeURIComponent(offerId)}&select=*`, secret);
  } catch {
    throw new Error('Klubbens sikre kodevisning er ikke gjort klar endnu. Kontakt Techus Nord.');
  }
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
      const [teams, admins, logs, offers, routes] = await Promise.all([
        service(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(context.customer.id)}&archived_at=is.null&select=slug,name,workplace,municipality,recovery_email,onboarding_status,created_at,activated_at&order=name.asc`, secret),
        service(`/rest/v1/customer_admins?customer_id=eq.${encodeURIComponent(context.customer.id)}&active=eq.true&select=name,email,activated_at&order=name.asc`, secret),
        service(`/rest/v1/customer_admin_audit_log?customer_id=eq.${encodeURIComponent(context.customer.id)}&select=admin_name,admin_email,team_slug,action,target_kind,created_at&order=created_at.desc&limit=50`, secret),
        service(`/rest/v1/shared_offers?customer_id=eq.${encodeURIComponent(context.customer.id)}&archived_at=is.null&select=*&order=name.asc`, secret),
        safeRoutes(service, secret, `customer_id=eq.${encodeURIComponent(context.customer.id)}&select=*`)
      ]);
      const maps = routeMaps(routes);
      const teamSlugs = (teams || []).map(team => team.slug).filter(Boolean);
      const credentials = teamSlugs.length
        ? await service(`/rest/v1/team_credentials?team_slug=in.(${teamSlugs.join(',')})&select=team_slug,editor_code_ciphertext,viewer_code_ciphertext,editor_changed_at,viewer_changed_at`, secret)
        : [];
      const credentialMap = new Map((credentials || []).map(item => [item.team_slug, item]));
      const offerIds = (offers || []).map(offer => offer.id).filter(Boolean);
      const offerCredentials = offerIds.length
        ? await service(`/rest/v1/shared_offer_credentials?offer_id=in.(${offerIds.map(encodeURIComponent).join(',')})&select=offer_id,editor_code_ciphertext,viewer_code_ciphertext,editor_changed_at,viewer_changed_at`, secret).catch(() => [])
        : [];
      const offerLinks = offerIds.length
        ? await service(`/rest/v1/shared_offer_team_links?offer_id=in.(${offerIds.map(encodeURIComponent).join(',')})&select=offer_id,team_slug,visible_on_team`, secret).catch(() => [])
        : [];
      const offerCredentialMap = new Map((offerCredentials || []).map(item => [item.offer_id, item]));
      const boardLimit = Number(context.customer.board_limit || 1);
      await service(`/rest/v1/customer_admins?id=eq.${encodeURIComponent(context.admin.id)}`, secret, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ last_login_at:new Date().toISOString() }) }).catch(() => {});
      return response.status(200).json({
        customer:{ id:context.customer.id, name:context.customer.display_name, municipality:context.customer.municipality, url_slug:context.customer.url_slug, plan_code:context.customer.plan_code, subscription_status:context.customer.subscription_status, board_limit:boardLimit, club_module_enabled:context.customer.club_module_enabled === true },
        currentAdmin:{ name:context.admin.name, email:context.admin.email },
        teams:(teams || []).map(team => {
          const stored = credentialMap.get(team.slug) || {};
          return { ...team, public_path:publicPath(maps.byTeam.get(team.slug)) || `/${team.slug}`, has_editor_code:Boolean(stored.editor_code_ciphertext), has_viewer_code:Boolean(stored.viewer_code_ciphertext), editor_changed_at:stored.editor_changed_at || null, viewer_changed_at:stored.viewer_changed_at || null };
        }),
        remainingBoards:Math.max(0, boardLimit - (teams || []).length),
        canCreateBoards:!['read_only','cancelled','overdue'].includes(context.customer.subscription_status) && (teams || []).length < boardLimit,
        admins:admins || [], logs:logs || [], offers:(offers || []).map(offer => {
          const stored = offerCredentialMap.get(offer.id) || {};
          return { ...offer, public_path:publicPath(maps.byOffer.get(offer.id)) || `/${offer.customer_slug || context.customer.url_slug}/${offer.slug}`, team_links:offerLinks.filter(link => link.offer_id === offer.id), has_editor_code:Boolean(stored.editor_code_ciphertext), has_viewer_code:Boolean(stored.viewer_code_ciphertext), editor_changed_at:stored.editor_changed_at || null, viewer_changed_at:stored.viewer_changed_at || null };
        })
      });
    }
    if (request.method !== 'POST') return response.status(405).json({ error:'Kun GET og POST er tilladt.' });
    const body = request.body || {};
    const action = clean(body.action, 80);

    if (action === 'create-board') {
      const result = await createBoard(body, context, secret, request.headers.host);
      return response.status(200).json({ ok:true, ...result, boardUrl:result.publicPath });
    }

    if (action === 'check-slug') {
      const requestedSlug = slugify(body.value || body.slug);
      const slug = await uniquePublicSlug(service, secret, context.customer, requestedSlug, slugify);
      const available = slug === requestedSlug;
      return response.status(200).json({ ok:true, slug, available, adjusted:!available, requestedSlug });
    }

    if (action === 'create-shared-offer') {
      const result = await createClub({ ...body, host:request.headers.host }, context, secret);
      return response.status(200).json({ ok:true, ...result, boardUrl:result.publicPath });
    }

    if (['send-club-invite','send-club-reset','reveal-club-code','reset-club-code','save-club','delete-club'].includes(action)) {
      const offer = await scopedOffer(clean(body.offer_id, 80), context.customer.id, secret);
      if (!offer) return response.status(404).json({ error:'Klubtavlen blev ikke fundet hos denne kunde.' });
      if (action === 'delete-club') {
        if (String(body.confirmation || '') !== 'SLET KLUBTAVLE') return response.status(400).json({ error:'Sletningen blev ikke bekræftet korrekt.' });
        await audit(context, 'club_deleted', null, `club:${offer.slug}`, secret);
        await deleteOfferCompletely(offer, secret);
        return response.status(200).json({ ok:true });
      }
      if (action === 'save-club') {
        const update = {
          name:clean(body.name, 150), workplace:clean(body.workplace, 200),
          recovery_email:clean(body.recovery_email, 200).toLowerCase(), updated_at:new Date().toISOString()
        };
        if (!update.name || !update.workplace || !/^\S+@\S+\.\S+$/.test(update.recovery_email)) return response.status(400).json({ error:'Udfyld gyldige kluboplysninger.' });
        await service(`/rest/v1/shared_offers?id=eq.${encodeURIComponent(offer.id)}&customer_id=eq.${encodeURIComponent(context.customer.id)}`, secret, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(update) });
        const customerTeams = await service(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(context.customer.id)}&archived_at=is.null&select=slug`, secret);
        const allowed = new Set((customerTeams || []).map(team => team.slug));
        const selected = new Set((Array.isArray(body.team_slugs) ? body.team_slugs : []).filter(teamSlug => allowed.has(teamSlug)));
        const existingLinks = await service(`/rest/v1/shared_offer_team_links?offer_id=eq.${encodeURIComponent(offer.id)}&select=team_slug`, secret);
        const existing = new Set((existingLinks || []).map(link => link.team_slug));
        const removed = [...existing].filter(teamSlug => !selected.has(teamSlug));
        const added = [...selected].filter(teamSlug => !existing.has(teamSlug));
        if (removed.length) await service(`/rest/v1/shared_offer_team_links?offer_id=eq.${encodeURIComponent(offer.id)}&team_slug=in.(${removed.map(encodeURIComponent).join(',')})`, secret, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
        if (added.length) await service('/rest/v1/shared_offer_team_links', secret, { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(added.map(team_slug => ({ offer_id:offer.id, team_slug, visible_on_team:true }))) });
        await audit(context, 'club_updated', null, `club:${offer.slug}`, secret);
        return response.status(200).json({ ok:true });
      }
      if (action === 'send-club-invite' || action === 'send-club-reset') {
        const purpose = action === 'send-club-reset' ? 'password_reset' : 'activation';
        const invitation = await createClubInvitation(offer, context.customer, secret, request.headers.host, purpose);
        await audit(context, purpose === 'activation' ? 'club_activation_sent' : 'club_password_reset_sent', null, `club:${offer.slug}`, secret);
        return response.status(200).json({ ok:true, ...invitation });
      }
      const kind = body.kind === 'viewer' ? 'viewer' : 'editor';
      if (action === 'reveal-club-code') {
        const rows = await clubCredentialRows(offer.id, secret);
        const encrypted = rows?.[0]?.[`${kind}_code_ciphertext`];
        if (!encrypted) return response.status(404).json({ error:'Koden er ikke gemt endnu. Vælg en ny kode én gang for at gøre den synlig.' });
        const value = decryptCredential(encrypted);
        await audit(context, 'club_code_revealed', null, `club:${offer.slug}:${kind}`, secret);
        return response.status(200).json({ ok:true, value });
      }
      const value = String(body.value || '');
      const minimum = kind === 'viewer' ? 6 : 8;
      if (value.length < minimum) return response.status(400).json({ error:`Koden skal have mindst ${minimum} tegn.` });
      encryptCredential(value);
      const otherKind = kind === 'viewer' ? 'editor' : 'viewer';
      const credentialRows = await clubCredentialRows(offer.id, secret);
      const otherEncrypted = credentialRows?.[0]?.[`${otherKind}_code_ciphertext`];
      if (otherEncrypted && decryptCredential(otherEncrypted) === value) return response.status(400).json({ error:'Tavle- og redigeringskoden skal være forskellige.' });
      await service(`/auth/v1/admin/users/${offer[`${kind}_user_id`]}`, secret, { method:'PUT', body:JSON.stringify({ password:value }) });
      await saveOfferCredential(offer.id, kind, value, secret);
      await audit(context, 'club_code_changed', null, `club:${offer.slug}:${kind}`, secret);
      return response.status(200).json({ ok:true });
    }

    const team = await scopedTeam(clean(body.team_slug, 120), context.customer.id, secret);
    if (!team) return response.status(404).json({ error:'Tavlen blev ikke fundet hos denne kunde.' });

    if (action === 'delete-board') {
      if (String(body.confirmation || '') !== 'SLET TAVLE') return response.status(400).json({ error:'Sletningen blev ikke bekræftet korrekt.' });
      await audit(context, 'board_deleted', team.slug, `deleted_team:${team.slug}`, secret);
      await deleteStoragePrefix(team.slug, secret);
      await service(`/rest/v1/access_help_requests?team_slug=eq.${encodeURIComponent(team.slug)}`, secret, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
      await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(team.slug)}&customer_id=eq.${encodeURIComponent(context.customer.id)}`, secret, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
      await Promise.all([deleteAuthUser(team.editor_user_id, secret), deleteAuthUser(team.viewer_user_id, secret)]);
      return response.status(200).json({ ok:true });
    }

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
        recovery_email:clean(body.recovery_email, 200).toLowerCase(),
        updated_at:new Date().toISOString()
      };
      if (!update.name || !update.workplace || !/^\S+@\S+\.\S+$/.test(update.recovery_email)) return response.status(400).json({ error:'Udfyld gyldige tavleoplysninger.' });
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
    const message = /pakken|prøveperioden|udfyld|adgang|kode|tavleadresse|aftale|krypter|klub|arbejdsmail/i.test(String(error.message)) ? error.message : 'Handlingen kunne ikke gennemføres.';
    const status = error.code === 'MISSING_ENCRYPTION_KEY' ? 503 : message === error.message ? 400 : 500;
    return response.status(status).json({ error:message });
  }
};
