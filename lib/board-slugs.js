const RESERVED_BOARD_SLUGS = new Set([
  'admin', 'administration', 'api', 'assets', 'aktiver', 'app',
  'betingelser', 'databehandleraftale', 'demo', 'faq', 'finder',
  'index', 'kundeadmin', 'kundeadmin-aktiver', 'lib', 'login',
  'manifest', 'manifest-webmanifest', 'ofte-spurgte-spoergsmaal',
  'opret', 'priser', 'privatliv', 'robots', 'saadan-virker-det',
  'service-worker', 'shared-offer', 'sitemap', 'tilbud',
  'underdatabehandlere', 'vercel'
]);

const isReservedBoardSlug = slug => RESERVED_BOARD_SLUGS.has(String(slug || '').toLowerCase());

function withNumericSuffix(stem, suffix) {
  const ending = `-${suffix}`;
  const base = String(stem || 'tavle').slice(0, 80 - ending.length).replace(/-+$/g, '') || 'tavle';
  return `${base}${ending}`;
}

module.exports = { RESERVED_BOARD_SLUGS, isReservedBoardSlug, withNumericSuffix };
