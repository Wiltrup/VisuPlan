const SUPABASE_URL='https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY='sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
module.exports=async function handler(request,response){
  if(request.method!=='GET')return response.status(405).json({error:'Kun GET er tilladt.'});
  const slug=String(request.query.slug||'');
  const requestedPath=String(request.query.path||'');
  if(!/^[a-z0-9-]{3,120}$/.test(slug))return response.status(404).json({error:'Tilbuddet blev ikke fundet.'});
  try{
    const key=process.env.SUPABASE_SECRET_KEY||SUPABASE_KEY;
    const result=await fetch(`${SUPABASE_URL}/rest/v1/shared_offers?slug=eq.${encodeURIComponent(slug)}&archived_at=is.null&own_board_enabled=eq.true&select=*`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
    const offer=(await result.json())?.[0];
    if(!offer)return response.status(404).json({error:'Tilbuddet blev ikke fundet.'});
    response.setHeader('Content-Type','application/manifest+json');response.setHeader('Cache-Control','public, max-age=300');
    const fallbackPath=`/${offer.customer_slug||'tilbud'}/${slug}`;
    const boardPath=/^\/[a-z0-9-]+\/[a-z0-9-]+$/.test(requestedPath)?requestedPath:fallbackPath;
    return response.status(200).send(JSON.stringify({id:boardPath,name:`VisuPlanner – ${offer.name}`,short_name:offer.name.slice(0,30),start_url:boardPath,scope:'/',display:'standalone',background_color:'#eef2f7',theme_color:'#2563eb',lang:'da-DK',description:`Mad og aktiviteter fra ${offer.workplace||offer.name}`}));
  }catch(error){console.error(error);return response.status(500).json({error:'Manifestet kunne ikke hentes.'})}
};
