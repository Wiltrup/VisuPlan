const municipality=document.getElementById('municipality'),workplace=document.getElementById('workplace'),team=document.getElementById('team'),button=document.getElementById('openTeam'),message=document.getElementById('finderMessage');
let directory=[];
const unique=items=>[...new Set(items)].sort((a,b)=>a.localeCompare(b,'da'));
async function loadDirectory(){try{const response=await fetch('/api/team-login'),data=await response.json();if(!response.ok)throw new Error();directory=data;municipality.innerHTML='<option value="">Vælg kommune</option>'+unique(data.map(x=>x.municipality)).map(x=>`<option>${x}</option>`).join('');municipality.disabled=false}catch{message.textContent='Listen kunne ikke hentes. Prøv igen senere.'}}
municipality.addEventListener('change',()=>{const choices=unique(directory.filter(x=>x.municipality===municipality.value).map(x=>x.workplace));workplace.innerHTML='<option value="">Vælg arbejdsplads</option>'+choices.map(x=>`<option>${x}</option>`).join('');workplace.disabled=!municipality.value;team.innerHTML='<option value="">Vælg team</option>';team.disabled=true;button.disabled=true;message.textContent=''});
workplace.addEventListener('change',()=>{const choices=directory.filter(x=>x.municipality===municipality.value&&x.workplace===workplace.value);team.innerHTML='<option value="">Vælg team</option>'+choices.map(x=>`<option value="${x.slug}">${x.name}</option>`).join('');team.disabled=!workplace.value;button.disabled=true;message.textContent=''});
team.addEventListener('change',()=>{button.disabled=!team.value});
document.getElementById('teamFinder').addEventListener('submit',event=>{event.preventDefault();if(team.value)location.href=`/${team.value}`});
loadDirectory();
