const crypto=require('crypto');
const SUPABASE_URL='https://fzrtvogirhmnbicdaffc.supabase.co';
const hash=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
async function data(r){const t=await r.text();return t?JSON.parse(t):null}
async function service(path,secret,options={}){const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...(options.headers||{})}});if(!r.ok)throw new Error(await r.text());return data(r)}
module.exports=async function handler(req,res){const secret=process.env.SUPABASE_SECRET_KEY;if(!secret)return res.status(503).json({error:'Aktiveringen er ikke klar.'});if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Metoden er ikke tilladt.'});try{
  const token=String(req.method==='GET'?req.query?.token:req.body?.token||'');
  if(token.length<30)return res.status(400).json({error:'Linket er ugyldigt.'});
  const rows=await service(`/rest/v1/team_invitations?token_hash=eq.${hash(token)}&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*,teams_registry(name,slug)&limit=1`,secret),invite=rows?.[0];
  if(!invite)return res.status(410).json({error:'Linket er brugt eller udløbet. Bed om et nyt invitationslink.'});
  if(req.method==='GET')return res.status(200).json({teamName:invite.teams_registry?.name||invite.team_slug});
  const editor=String(req.body?.editorPassword||''),viewer=String(req.body?.viewerPassword||'');
  if(editor.length<8)return res.status(400).json({error:'Personalekoden skal have mindst 8 tegn.'});
  if(viewer.length<6)return res.status(400).json({error:'Tavlekoden skal have mindst 6 tegn.'});
  if(editor===viewer)return res.status(400).json({error:'De to koder skal være forskellige.'});
  const teams=await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(invite.team_slug)}&select=*`,secret),team=teams?.[0];
  if(!team)return res.status(404).json({error:'Teamet blev ikke fundet.'});
  await service(`/auth/v1/admin/users/${team.editor_user_id}`,secret,{method:'PUT',body:JSON.stringify({password:editor})});
  await service(`/auth/v1/admin/users/${team.viewer_user_id}`,secret,{method:'PUT',body:JSON.stringify({password:viewer})});
  const now=new Date().toISOString();
  await service(`/rest/v1/team_invitations?id=eq.${invite.id}`,secret,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({used_at:now})});
  await service(`/rest/v1/teams_registry?slug=eq.${encodeURIComponent(team.slug)}`,secret,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({onboarding_status:'active',activated_at:now,updated_at:now})});
  await service(`/rest/v1/onboarding_requests?contact_email=eq.${encodeURIComponent(invite.contact_email)}&team_name=eq.${encodeURIComponent(team.name)}&status=eq.invited`,secret,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'activated'})});
  return res.status(200).json({ok:true,slug:team.slug});
}catch(error){console.error(error);return res.status(500).json({error:'Aktiveringen kunne ikke gennemføres. Ingen koder blev vist eller sendt.'})}}
