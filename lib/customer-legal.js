// Fælles versioneret aftalegrundlag. Ingen eksisterende kunder er undtaget.
const { service } = require('./customer-admin-security');
const AGREEMENT_VERSION = '2026-08-16-v1.2+dpa1.1';
const TERMS_VERSION = '1.2';
const DPA_VERSION = '1.1';
const TERMS_PATH = '/betingelser-v1.2';
const DPA_PATH = '/databehandleraftale-v1.1';

async function customerAgreement(customerId, secret) {
  const rows = await service(
    `/rest/v1/customer_acceptances?customer_id=eq.${encodeURIComponent(customerId)}&terms_version=eq.${encodeURIComponent(AGREEMENT_VERSION)}&select=customer_id,terms_version,accepted_by_name,accepted_at&order=accepted_at.desc&limit=1`,
    secret
  );
  return rows?.[0] || null;
}

function agreementPayload(context) {
  return {
    version: AGREEMENT_VERSION,
    terms_version: TERMS_VERSION,
    dpa_version: DPA_VERSION,
    terms_url: TERMS_PATH,
    dpa_url: DPA_PATH,
    legal_party: context.customer.legal_name || context.customer.display_name,
    customer_name: context.customer.display_name,
    municipality: context.customer.municipality,
    admin_name: context.admin.name,
    admin_email: context.admin.email
  };
}

async function acceptAgreement(context, body, secret) {
  if (body?.version !== AGREEMENT_VERSION || body?.accept_terms !== true ||
      body?.accept_dpa !== true || body?.authorized !== true) {
    const error = new Error('Alle aftaler og bemyndigelsen skal godkendes.');
    error.status = 400;
    throw error;
  }
  const previous = await customerAgreement(context.customer.id, secret);
  if (previous) return previous;
  const now = new Date().toISOString();
  await service('/rest/v1/customer_acceptances', secret, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      customer_id: context.customer.id,
      terms_version: AGREEMENT_VERSION,
      accepted_by_name: context.admin.name,
      accepted_at: now
    })
  });
  return { customer_id: context.customer.id, terms_version: AGREEMENT_VERSION,
    accepted_by_name: context.admin.name, accepted_at: now };
}

module.exports = { AGREEMENT_VERSION, TERMS_VERSION, DPA_VERSION,
  TERMS_PATH, DPA_PATH, customerAgreement, agreementPayload, acceptAgreement };
