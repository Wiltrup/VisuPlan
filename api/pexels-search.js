const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Kun GET er tilladt.' });
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return response.status(401).json({ error: 'Log ind som personale først.' });
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: authorization } });
  if (!authCheck.ok) return response.status(401).json({ error: 'Din session er udløbet. Log ind igen.' });
  const query = String(request.query.q || '').trim().slice(0, 80);
  if (query.length < 2) return response.status(400).json({ error: 'Skriv mindst to tegn.' });
  if (!process.env.PEXELS_API_KEY) return response.status(503).json({ error: 'Billedsøgningen er ikke konfigureret endnu.' });
  try {
    const pexelsResponse = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=12&locale=da-DK`, { headers: { Authorization: process.env.PEXELS_API_KEY } });
    if (!pexelsResponse.ok) throw new Error(`Pexels svarede ${pexelsResponse.status}`);
    const data = await pexelsResponse.json();
    const photos = (data.photos || []).map(photo => ({ id: photo.id, thumbnail: photo.src.medium, image: photo.src.large, alt: photo.alt || query, photographer: photo.photographer, photographerUrl: photo.photographer_url, pexelsUrl: photo.url }));
    response.setHeader('Cache-Control', 'private, max-age=300');
    return response.status(200).json({ photos });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: 'Billedsøgningen kunne ikke kontaktes. Du kan stadig vælge et billede fra telefonen.' });
  }
};
