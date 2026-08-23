const { isReservedBoardSlug, withNumericSuffix } = require('./board-slugs');

const routeTableMissing = error => /board_routes|PGRST205|schema cache|relation .* does not exist/i.test(String(error?.message || error || ''));

async function safeRoutes(fetcher, secret, query = '') {
  try {
    return await fetcher(`/rest/v1/board_routes?${query}`, secret) || [];
  } catch (error) {
    if (routeTableMissing(error)) return [];
    throw error;
  }
}

const publicPath = route => route?.customer_slug && route?.board_slug
  ? `/${route.customer_slug}/${route.board_slug}`
  : '';

async function publicSlugAvailable(fetcher, secret, customer, boardSlug) {
  if (!customer?.id || !/^[a-z0-9-]{2,80}$/.test(boardSlug) || isReservedBoardSlug(boardSlug)) return false;
  const routes = await safeRoutes(fetcher, secret, `customer_id=eq.${encodeURIComponent(customer.id)}&board_slug=eq.${encodeURIComponent(boardSlug)}&select=id&limit=1`);
  if (routes.length) return false;

  // Fallback while the additive migration has not yet been run.
  const [teams, offers] = await Promise.all([
    fetcher(`/rest/v1/teams_registry?customer_id=eq.${encodeURIComponent(customer.id)}&select=slug`, secret),
    fetcher(`/rest/v1/shared_offers?customer_id=eq.${encodeURIComponent(customer.id)}&select=slug`, secret)
  ]);
  const customerSlug = customer.url_slug || '';
  const localSlug = value => value?.startsWith(`${customerSlug}-`) ? value.slice(customerSlug.length + 1) : value;
  return ![...(teams || []), ...(offers || [])].some(item => localSlug(item.slug) === boardSlug);
}

async function uniquePublicSlug(fetcher, secret, customer, base, slugify) {
  const stem = slugify(base).slice(0, 80) || 'tavle';
  let candidate = stem;
  let suffix = 2;
  while (!(await publicSlugAvailable(fetcher, secret, customer, candidate))) candidate = withNumericSuffix(stem, suffix++);
  return candidate;
}

async function createRoute(fetcher, secret, route) {
  try {
    const rows = await fetcher('/rest/v1/board_routes?select=*', secret, {
      method:'POST', headers:{ Prefer:'return=representation' }, body:JSON.stringify(route)
    });
    return rows?.[0] || route;
  } catch (error) {
    if (routeTableMissing(error)) return null;
    throw error;
  }
}

function routeMaps(routes = []) {
  return {
    byTeam:new Map(routes.filter(route => route.team_slug).map(route => [route.team_slug, route])),
    byOffer:new Map(routes.filter(route => route.offer_id).map(route => [route.offer_id, route]))
  };
}

module.exports = {
  routeTableMissing, safeRoutes, publicPath, publicSlugAvailable,
  uniquePublicSlug, createRoute, routeMaps
};
