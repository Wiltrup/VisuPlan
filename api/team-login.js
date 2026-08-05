const SUPABASE_URL='https://fzrtvogirhmnbicdaffc.supabase.co',SUPABASE_KEY='sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
async function data(response){const text=await response.text();return text?JSON.parse(text):null}
async function service(path,secret,options={}){const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...(options.headers||{})}});if(!r.ok)throw new Error(await r.text());return data(r)}
module.exports=async function handler(request,response){
  if(!['GET','POST'].includes(request.method))return response.status(405).json({error:'Metoden er ikke tilladt.'});
  const secret=process.env.SUPABASE_SECRET_KEY;if(!secret)return response.status(503).json({error:'Loginfunktionen er ikke klar.'});
  try{
    const input=request.method==='GET'?request.query:(request.body||{}),{slug,action,password,email}=input;
    if(request.method==='GET'&&!slug){const directory=await service('/rest/v1/teams_registry?onboarding_status=eq.active&select=slug,name,municipality,workplace&order=municipality.asc,workplace.asc,name.asc',secret);return response.status(200).json(directory||[])}
    if(!/^[a-z0-9-]{3,120}$/.test(String(slug||'')))return response.status(404).json({error:'Teamet blev ikke fundet.'});
    const teams=await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(slug)}&select=*`,secret),team=teams?.[0];
    if(!team||team.onboarding_status!=='active')return response.status(404).json({error:'Teamet blev ikke fundet eller er endnu ikke aktiveret.'});
    if(request.method==='GET')return response.status(200).json({slug:team.slug,name:team.name,workplace:team.workplace,municipality:team.municipality});
    if(!team.editor_user_id||!team.viewer_user_id)return response.status(400).json({error:'Teamets login er ikke koblet korrekt.'});
    const userId=action==='viewer-login'?team.viewer_user_id:team.editor_user_id,user=await service(`/auth/v1/admin/users/${userId}`,secret);
    if(action==='login'||action==='viewer-login'){
      const login=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:String(password||'')})}),result=await data(login);
      if(!login.ok)return response.status(401).json({error:action==='viewer-login'?'Forkert tavlekode.':'Forkert personalekode.'});
      return response.status(200).json(result);
    }
    if(action==='recover'){
      if(String(email||'').trim().toLowerCase()!==String(team.recovery_email||'').toLowerCase())return response.status(200).json({ok:true});
      const recover=await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`https://visuplanner.dk/${team.slug}`)}`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({email:user.email})});
      if(!recover.ok)throw new Error(await recover.text());return response.status(200).json({ok:true});
    }
    return response.status(400).json({error:'Ukendt handling.'});
  }catch(error){console.error(error);return response.status(500).json({error:'Loginhandlingen mislykkedes.'})}
};
