const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';

async function parse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function service(path, secret, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers:{ apikey:secret, Authorization:`Bearer ${secret}`, 'Content-Type':'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(await response.text());
  return parse(response);
}

async function sendReminder(customer, days) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY mangler.');
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      from:'VisuPlanner <notifikation@visuplanner.dk>',
      to:['wiltrup@wiltrup.com'],
      subject:`Årsfornyelse nærmer sig: ${customer.display_name}`,
      text:[
        `Kunde: ${customer.display_name}`,
        `Fornyelsesdato: ${new Intl.DateTimeFormat('da-DK', { dateStyle:'long' }).format(new Date(customer.subscription_renews_at))}`,
        `Dage tilbage: ${days}`,
        `Pakke: ${customer.plan_code}`,
        `Årspris: ${customer.renewal_price_dkk ?? 'Ikke fastsat'} kr. ekskl. moms`,
        `Fakturamail: ${customer.billing_email || customer.contact_email}`,
        `EAN: ${customer.ean || 'Ikke angivet'}`,
        '',
        'Åbn VisuPlanner-administrationen og klargør årsopkrævningen.'
      ].join('\n')
    })
  });
  if (!response.ok) throw new Error(await response.text());
}

async function sendTrialReminder(customer) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY mangler.');
  const recipient = customer.contact_email || customer.billing_email;
  if (!recipient) throw new Error(`Kontaktmail mangler for ${customer.display_name}.`);
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      from:'VisuPlanner <notifikation@visuplanner.dk>',
      to:[recipient],
      subject:'Jeres prøveperiode udløber snart',
      text:[
        `Hej${customer.contact_name ? ` ${customer.contact_name}` : ''}`,
        '',
        'Jeres prøveperiode på VisuPlanner nærmer sig udløbsdatoen.',
        '',
        'Ønsker I at fortsætte? Log ind i kundeadministrationen på VisuPlanner. Her kan I se prøveperiodens udløbsdato og vælge “Aktiver”. Techus Nord behandler derefter anmodningen.',
        '',
        'Venlig hilsen',
        'Techus Nord'
      ].join('\n')
    })
  });
  if (!response.ok) throw new Error(await response.text());
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error:'Kun GET er tilladt.' });
  const cronSecret = process.env.CRON_SECRET;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!cronSecret || !secret) return response.status(503).json({ error:'CRON_SECRET eller SUPABASE_SECRET_KEY mangler.' });
  if (request.headers.authorization !== `Bearer ${cronSecret}`) return response.status(401).json({ error:'Ikke autoriseret.' });
  try {
    const now = new Date();
    const limit = new Date(now.getTime() + 31 * 86400000);
    const rows = await service(`/rest/v1/customers?archived_at=is.null&subscription_status=in.(contracted,invoice_sent,active,overdue)&subscription_renews_at=gte.${encodeURIComponent(now.toISOString())}&subscription_renews_at=lte.${encodeURIComponent(limit.toISOString())}&select=*&order=subscription_renews_at.asc`, secret);
    let renewalSent = 0;
    for (const customer of rows || []) {
      const periodDate = String(customer.subscription_renews_at).slice(0, 10);
      const existing = await service(`/rest/v1/customer_notifications?customer_id=eq.${encodeURIComponent(customer.id)}&notification_type=eq.renewal_30&period_date=eq.${periodDate}&select=id&limit=1`, secret);
      if (existing?.length) continue;
      const days = Math.max(0, Math.ceil((new Date(customer.subscription_renews_at) - now) / 86400000));
      await sendReminder(customer, days);
      await service('/rest/v1/customer_notifications', secret, {
        method:'POST', headers:{ Prefer:'return=minimal' },
        body:JSON.stringify({ customer_id:customer.id, notification_type:'renewal_30', period_date:periodDate })
      });
      renewalSent += 1;
    }

    const dayTenThreshold = new Date(now.getTime() - 9 * 86400000);
    const trials = await service(`/rest/v1/customers?archived_at=is.null&subscription_status=eq.trial&subscription_interest_at=is.null&trial_started_at=not.is.null&trial_started_at=lte.${encodeURIComponent(dayTenThreshold.toISOString())}&trial_ends_at=gt.${encodeURIComponent(now.toISOString())}&select=*&order=trial_ends_at.asc`, secret);
    let trialSent = 0;
    for (const customer of trials || []) {
      const existing = await service(`/rest/v1/customer_notifications?customer_id=eq.${encodeURIComponent(customer.id)}&notification_type=eq.trial_day_10&select=id&limit=1`, secret);
      if (existing?.length) continue;
      await sendTrialReminder(customer);
      const periodDate = String(customer.trial_started_at).slice(0, 10);
      await service('/rest/v1/customer_notifications', secret, {
        method:'POST', headers:{ Prefer:'return=minimal' },
        body:JSON.stringify({ customer_id:customer.id, notification_type:'trial_day_10', period_date:periodDate })
      });
      trialSent += 1;
    }
    let registrationsPurged = 0;
    try {
      const result = await service('/rest/v1/rpc/purge_expired_shared_offer_registrations', secret, { method:'POST', body:'{}' });
      registrationsPurged = Number(result || 0);
    } catch (error) {
      console.warn('Gamle klubtilmeldinger kunne ikke ryddes endnu.', error.message);
    }
    return response.status(200).json({ ok:true, renewalChecked:(rows || []).length, renewalSent, trialChecked:(trials || []).length, trialSent, registrationsPurged });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error:'Fornyelseskontrollen mislykkedes.' });
  }
};
