// Temporary read-only verification probe. Remove after B05 audit.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(200).json({ check: 'missing_api_key' });
  try {
    const upstream = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) {
      return res.status(200).json({ check: 'provider_rejected', provider_http_status: upstream.status });
    }
    const payload = await upstream.json();
    if (!Array.isArray(payload.data)) return res.status(200).json({ check: 'unexpected_response' });
    const matched = payload.data.find(item => String(item.name || '').toLowerCase() === 'techusnord.dk');
    return res.status(200).json({
      check: 'resend_domain_listing',
      registered: Boolean(matched),
      status: matched ? String(matched.status || 'unknown') : 'not_listed'
    });
  } catch {
    return res.status(200).json({ check: 'provider_unreachable' });
  }
};
