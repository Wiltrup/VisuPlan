const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Kun GET er tilladt.' });
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return response.status(401).json({ error: 'Log ind som personale først.' });
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: authorization } });
  if (!authCheck.ok) return response.status(401).json({ error: 'Din session er udløbet.' });
  const id = String(request.query.id || '');
  if (!/^\d+$/.test(id)) return response.status(400).json({ error: 'Ugyldigt billednummer.' });
  if (!process.env.PEXELS_API_KEY) return response.status(503).json({ error: 'Billedsøgningen er ikke konfigureret.' });
  try {
    const photoResponse = await fetch(`https://api.pexels.com/v1/photos/${id}`, { headers: { Authorization: process.env.PEXELS_API_KEY } });
    if (!photoResponse.ok) throw new Error(`Pexels svarede ${photoResponse.status}`);
    const photo = await photoResponse.json();
    const imageResponse = await fetch(photo.src.large);
    if (!imageResponse.ok) throw new Error('Billedfilen kunne ikke hentes.');
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    response.setHeader('Content-Type', imageResponse.headers.get('content-type') || 'image/jpeg');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    return response.status(200).send(bytes);
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: 'Billedet kunne ikke hentes.' });
  }
};
