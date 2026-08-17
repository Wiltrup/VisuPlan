const DEMO_DAYS=[['Man','MANDAG','#eab308'],['Tir','TIRSDAG','#ef4444'],['Ons','ONSDAG','#22c55e'],['Tor','TORSDAG','#f97316'],['Fre','FREDAG','#3b82f6'],['Lør','LØRDAG','#a855f7'],['Søn','SØNDAG','#ec4899']];
const DEMO_STAFF=[['Anna','00'],['Jonas','01'],['Lene','02'],['Mikkel','03'],['Henrik','04'],['Sofie','05'],['Fatima','06'],['Noah','07']].map(([name,id])=>({name,photo:`/assets/demo-staff/person-${id}.webp`}));
const KEY='visuplanner-demo-session-v5';
const $=id=>document.getElementById(id);
const esc=value=>String(value||'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const blankDay=()=>({morning:['',''],evening:['',''],night:['',''],breakfast:'',breakfastPhoto:'',lunch:'',lunchPhoto:'',dinner:'',dinnerPhoto:'',activities:[]});
const defaultState=()=>({week:[
  {morning:['Anna','Jonas'],evening:['Lene','Mikkel'],night:['Henrik'],breakfast:'',breakfastPhoto:'',lunch:'',lunchPhoto:'',dinner:'Kylling i karry med ris',dinnerPhoto:'',activities:[{time:'10:00',name:'Gåtur i nærområdet',photo:''},{time:'14:30',name:'Fælles kaffe',photo:''}]},
  {morning:['Fatima','Noah'],evening:['Anna','Sofie'],night:['Jonas'],breakfast:'',breakfastPhoto:'',lunch:'',lunchPhoto:'',dinner:'Frikadeller med kartofler',dinnerPhoto:'',activities:[{time:'09:30',name:'Kreativt værksted',photo:''},{time:'15:00',name:'Musik i fællesrummet',photo:''}]},
  {morning:['Anna','Jonas'],evening:['Fatima','Mikkel'],night:['Lene'],breakfast:'',breakfastPhoto:'',lunch:'',lunchPhoto:'',dinner:'Lasagne',dinnerPhoto:'/assets/demo/lasagne.webp',activities:[{time:'10:00',name:'Indkøbstur',photo:''},{time:'13:30',name:'Banko i fællesrummet',photo:''}]},
  {morning:['Sofie','Henrik'],evening:['Noah','Lene'],night:['Mikkel'],breakfast:'',breakfastPhoto:'',lunch:'',lunchPhoto:'',dinner:'Fiskefrikadeller med rugbrød',dinnerPhoto:'',activities:[{time:'11:00',name:'Tur på biblioteket',photo:''}]},
  {morning:['Jonas','Fatima'],evening:['Anna','Henrik'],night:['Sofie'],breakfast:'',breakfastPhoto:'',lunch:'',lunchPhoto:'',dinner:'Tacos',dinnerPhoto:'',activities:[{time:'10:30',name:'Svømmehal',photo:''},{time:'19:00',name:'Filmaften',photo:''}]},
  {morning:['Mikkel','Lene'],evening:['Noah','Fatima'],night:['Henrik'],breakfast:'',breakfastPhoto:'',lunch:'',lunchPhoto:'',dinner:'Hjemmelavet pizza',dinnerPhoto:'',activities:[{time:'11:00',name:'Tur til stranden',photo:''},{time:'15:30',name:'Eftermiddagskaffe',photo:''}]},
  {morning:['Anna','Sofie'],evening:['Jonas','Mikkel'],night:['Noah'],breakfast:'',breakfastPhoto:'',lunch:'',lunchPhoto:'',dinner:'Boller i karry',dinnerPhoto:'',activities:[{time:'10:00',name:'Rolig formiddag',photo:''},{time:'14:00',name:'Besøg af pårørende',photo:''}]}
],settings:{morning:2,evening:2,night:1,showDates:true,shiftMode:3,nightEnabled:true,showBreakfast:false,showLunch:false}});
let demoState=loadState(),selected=2,editActivities=[],editShifts={morning:[],evening:[],night:[]},editMealPhotos={breakfast:'',lunch:'',dinner:''},demoEditorBaseline='';

function loadState(){try{const saved=JSON.parse(sessionStorage.getItem(KEY)||'null');return saved?.week&&saved?.settings?saved:defaultState()}catch{return defaultState()}}
function saveState(){try{sessionStorage.setItem(KEY,JSON.stringify(demoState));return true}catch{status('Billedet er for stort til demosessionen. Prøv et mindre billede.');return false}}
function monday(){const date=new Date(),day=date.getDay()||7;date.setDate(date.getDate()-day+1);date.setHours(12,0,0,0);return date}
function dateAt(index){const date=monday();date.setDate(date.getDate()+index);return date}
function formatDate(date){return new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'long'}).format(date)}
function status(text){$('demoStatus').textContent=text;setTimeout(()=>$('demoStatus').textContent='',2200)}
function staffOptions(value=''){return '<option value="">Vælg medarbejder</option>'+DEMO_STAFF.map(person=>`<option ${person.name===value?'selected':''}>${esc(person.name)}</option>`).join('')}
function activeShifts(){const s=demoState.settings;if(s.shiftMode<3)return s.nightEnabled?['morning','night']:['morning'];return s.nightEnabled?['morning','evening','night']:['morning','evening']}
function demoShiftLabel(type){if(type==='morning'&&demoState.settings.shiftMode<3)return'Dagvagt';return{morning:'Morgen',evening:'Aften',night:'Nat'}[type]}

function renderPeople(target,names){
  $(target).innerHTML=names.filter(Boolean).length?names.filter(Boolean).map(name=>{const person=DEMO_STAFF.find(item=>item.name===name);return `<div class="person demo-person" data-demo-image="${esc(person?.photo)}" data-demo-caption="${esc(name)}"><img src="${esc(person?.photo)}" alt=""><span>${esc(name)}</span></div>`}).join(''):'<p class="empty">Ikke udfyldt</p>';
}

function render(){
  const day=demoState.week[selected];
  document.documentElement.style.setProperty('--day-color',DEMO_DAYS[selected][2]);
  $('demoDay').textContent=DEMO_DAYS[selected][1];
  $('demoDate').textContent=formatDate(dateAt(selected));
  ['morning','evening','night'].forEach(type=>{const active=activeShifts().includes(type),cap=type[0].toUpperCase()+type.slice(1);$(`demo${cap}Panel`).hidden=!active;$(`demo${cap}Panel`).querySelector('h3').textContent=`${{morning:'☀️',evening:'🌙',night:'🌑'}[type]} ${demoShiftLabel(type)}`;if(active)renderPeople(`demo${cap}`,day[type])});
  ['breakfast','lunch','dinner'].forEach(type=>{const cap=type[0].toUpperCase()+type.slice(1),visible=type==='dinner'||demoState.settings[`show${cap}`];$(`demo${cap}Panel`).hidden=!visible;if(!visible)return;$(`demo${cap}`).textContent=day[type]||'Ikke udfyldt';$(`demo${cap}Photo`).innerHTML=day[`${type}Photo`]?`<img src="${day[`${type}Photo`]}" alt="${esc(day[type]||type)}" data-demo-image="${day[`${type}Photo`]}" data-demo-caption="${esc(day[type]||type)}">`:''});
  $('demoActivities').innerHTML=day.activities.length?day.activities.map(activity=>`<div class="activity demo-activity ${activity.photo?'has-photo':''}" ${activity.photo?`data-demo-image="${activity.photo}" data-demo-caption="${esc(activity.name)}"`:''}>${activity.photo?`<img src="${activity.photo}" alt="">`:''}<div class="activity-time">${esc(activity.time)}</div><div class="activity-name">${esc(activity.name)}</div></div>`).join(''):'<p class="empty">Ingen aktiviteter</p>';
  $('demoDayTabs').innerHTML=DEMO_DAYS.map((dayInfo,index)=>`<button class="day-tab ${index===selected?'active':''}" data-day="${index}"><span>${dayInfo[0]}</span>${demoState.settings.showDates?`<small>${dateAt(index).getDate()}.${dateAt(index).getMonth()+1}</small>`:''}</button>`).join('');
  document.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{selected=Number(button.dataset.day);render()});
  bindImageButtons();
}

function bindImageButtons(){document.querySelectorAll('[data-demo-image]').forEach(target=>target.onclick=()=>{if(!target.dataset.demoImage)return;$('demoLargeImage').src=target.dataset.demoImage;$('demoLargeCaption').textContent=target.dataset.demoCaption||'';$('demoImageDialog').showModal()})}

function ensureShiftDefaults(day){['morning','evening','night'].forEach(type=>{const count=demoState.settings[type];while(day[type].length<count)day[type].push('')})}
function loadEditor(){
  const day=demoState.week[selected];ensureShiftDefaults(day);$('demoEditDay').value=selected;
  editShifts={morning:[...day.morning],evening:[...day.evening],night:[...day.night]};
  ['breakfast','lunch','dinner'].forEach(type=>{const cap=type[0].toUpperCase()+type.slice(1),visible=type==='dinner'||demoState.settings[`show${cap}`];if(type!=='dinner')$(`demo${cap}Editor`).hidden=!visible;$(`demo${cap}Input`).value=day[type]||'';editMealPhotos[type]=day[`${type}Photo`]||''});
  $('demoDinnerPhotoNote').textContent=editMealPhotos.dinner?'Der er valgt et billede. Vælg et nyt for at udskifte det.':'Billedet behandles kun på denne enhed.';
  editActivities=structuredClone(day.activities);renderShiftEditors();renderActivityEditor();renderStaffManager();
}

function captureDemoDay(){
  const day=demoState.week[selected];
  activeShifts().forEach(type=>day[type]=[...editShifts[type]]);
  ['breakfast','lunch','dinner'].forEach(type=>{const cap=type[0].toUpperCase()+type.slice(1);day[type]=$(`demo${cap}Input`).value;day[`${type}Photo`]=editMealPhotos[type]});
  day.activities=editActivities.map(activity=>({...activity}));
}
function demoHasUnsavedChanges(){if(!$('demoEditorDialog').open||!demoEditorBaseline)return false;captureDemoDay();return JSON.stringify(demoState.week)!==demoEditorBaseline}
function closeDemoEditor(){if(demoHasUnsavedChanges()&&!confirm('Dine ændringer til ugeplanen er ikke gemt.\n\nVil du lukke redigeringen uden at gemme?'))return;demoEditorBaseline='';$('demoEditorDialog').close()}

function renderShiftEditors(){
  ['morning','evening','night'].forEach(type=>{
    const cap=type[0].toUpperCase()+type.slice(1);$(`demo${cap}Group`).hidden=!activeShifts().includes(type);$(`demo${cap}Group`).querySelector('h4').textContent=`${{morning:'☀️',evening:'🌙',night:'🌑'}[type]} ${demoShiftLabel(type)}`;if(!activeShifts().includes(type))return;
    const target=$(`demo${type[0].toUpperCase()+type.slice(1)}Editors`);
    target.innerHTML=editShifts[type].map((value,index)=>`<div class="shift-edit-row"><select data-demo-shift="${type}" data-demo-slot="${index}">${staffOptions(value)}</select><button class="remove-row" type="button" data-demo-remove-shift="${type}" data-demo-remove-slot="${index}" aria-label="Fjern felt">✕</button></div>`).join('');
  });
  document.querySelectorAll('[data-demo-shift]').forEach(select=>select.onchange=()=>editShifts[select.dataset.demoShift][Number(select.dataset.demoSlot)]=select.value);
  document.querySelectorAll('[data-demo-remove-shift]').forEach(button=>button.onclick=()=>{const type=button.dataset.demoRemoveShift;if(editShifts[type].length>1){editShifts[type].splice(Number(button.dataset.demoRemoveSlot),1);renderShiftEditors()}});
}

function renderActivityEditor(){
  $('demoActivityEditor').innerHTML=editActivities.length?editActivities.map((activity,index)=>`<div class="demo-activity-edit"><input type="time" value="${esc(activity.time)}" data-demo-index="${index}" data-demo-field="time"><input value="${esc(activity.name)}" placeholder="Aktivitet" data-demo-index="${index}" data-demo-field="name"><label class="demo-photo-button">${activity.photo?'Skift billede':'Billede'}<input type="file" accept="image/jpeg,image/png,image/webp" data-demo-activity-photo="${index}"></label><button type="button" data-demo-remove="${index}">✕</button></div>`).join(''):'<p class="empty">Ingen aktiviteter endnu.</p>';
  document.querySelectorAll('[data-demo-field]').forEach(input=>input.oninput=()=>editActivities[Number(input.dataset.demoIndex)][input.dataset.demoField]=input.value);
  document.querySelectorAll('[data-demo-remove]').forEach(button=>button.onclick=()=>{editActivities.splice(Number(button.dataset.demoRemove),1);renderActivityEditor()});
  document.querySelectorAll('[data-demo-activity-photo]').forEach(input=>input.onchange=async()=>{if(!input.files?.[0])return;status('Behandler billedet lokalt…');editActivities[Number(input.dataset.demoActivityPhoto)].photo=await compressImage(input.files[0]);renderActivityEditor();status('Billedet er klar')});
}

function renderStaffManager(){
  $('demoStaffManager').innerHTML=DEMO_STAFF.map(person=>`<div class="staff-manage-row"><img src="${person.photo}" alt=""><strong>${esc(person.name)}</strong><button class="upload-button" type="button" disabled>Skift billede</button><button class="remove-staff-button" type="button" disabled>Slet</button></div>`).join('');
}

async function compressImage(file){
  if(!file.type.startsWith('image/'))throw new Error('Vælg en billedfil.');
  const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
  const image=await new Promise((resolve,reject)=>{const item=new Image();item.onload=()=>resolve(item);item.onerror=reject;item.src=source});
  const max=760,scale=Math.min(1,max/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',.68);
}

$('demoPrev').onclick=()=>{selected=(selected+6)%7;render()};
$('demoNext').onclick=()=>{selected=(selected+1)%7;render()};
$('demoAdminButton').onclick=()=>{$('demoPin').value='';$('demoLoginError').textContent='';$('demoLoginDialog').showModal()};
$('demoLoginClose').onclick=()=>$('demoLoginDialog').close();
$('demoLoginForm').onsubmit=event=>{event.preventDefault();if($('demoPin').value!=='1234')return $('demoLoginError').textContent='Forkert kode. Demokoden er 1234.';$('demoPin').value='';$('demoLoginDialog').close();loadEditor();$('demoEditorDialog').showModal();demoEditorBaseline=JSON.stringify(demoState.week)};
$('demoEditorClose').onclick=closeDemoEditor;
$('demoEditorDialog').addEventListener('cancel',event=>{event.preventDefault();closeDemoEditor()});
$('demoEditDay').innerHTML=DEMO_DAYS.map((day,index)=>`<option value="${index}">${day[1]} ${formatDate(dateAt(index))}</option>`).join('');
$('demoEditDay').onchange=()=>{captureDemoDay();selected=Number($('demoEditDay').value);loadEditor();render()};
document.querySelectorAll('[data-demo-add-shift]').forEach(button=>button.onclick=()=>{const type=button.dataset.demoAddShift;if(editShifts[type].length<10){editShifts[type].push('');renderShiftEditors()}});
$('demoAddActivity').onclick=()=>{editActivities.push({time:'10:00',name:'',photo:''});renderActivityEditor()};
$('demoImageSearch').onclick=()=>alert('Billedsøgning er tilgængelig på en oprettet VisuPlanner-tavle. I demoen kan du uploade dit eget billede.');
['breakfast','lunch','dinner'].forEach(type=>{const cap=type[0].toUpperCase()+type.slice(1);$(`demo${cap}PhotoInput`).onchange=async event=>{if(!event.target.files?.[0])return;status('Behandler billedet lokalt…');editMealPhotos[type]=await compressImage(event.target.files[0]);if(type==='dinner')$('demoDinnerPhotoNote').textContent='Billedet er klar og gemmes kun i denne demosession.';status('Billedet er klar')}});
$('demoSave').onclick=()=>{captureDemoDay();demoState.week.forEach(day=>{['breakfast','lunch','dinner'].forEach(type=>day[type]=String(day[type]||'').trim());day.activities=day.activities.filter(activity=>activity.name.trim()).map(activity=>({...activity,name:activity.name.trim()}))});if(!saveState())return;demoEditorBaseline=JSON.stringify(demoState.week);render();$('demoEditorDialog').close();status('Alle ændringer er gemt i denne browserfane')};
$('demoReset').onclick=()=>{if(!confirm('Vil du nulstille hele demoen? Tekst og uploadede billeder slettes.'))return;demoState=defaultState();sessionStorage.removeItem(KEY);render();loadEditor();demoEditorBaseline=JSON.stringify(demoState.week);status('Demoen er nulstillet')};
$('demoOpenSettings').onclick=()=>{if(demoHasUnsavedChanges())return status('Gem ændringerne, før du åbner Grundindstillinger.');$('demoMorningDefault').value=demoState.settings.morning;$('demoEveningDefault').value=demoState.settings.evening;$('demoNightDefault').value=demoState.settings.night;$('demoShowDates').checked=demoState.settings.showDates;$('demoShiftMode').value=demoState.settings.shiftMode;$('demoNightEnabled').checked=demoState.settings.nightEnabled;$('demoShowBreakfast').checked=demoState.settings.showBreakfast;$('demoShowLunch').checked=demoState.settings.showLunch;$('demoSettingsDialog').showModal()};
$('demoSettingsClose').onclick=()=>$('demoSettingsDialog').close();
$('demoSettingsSave').onclick=()=>{demoState.settings={morning:Math.min(10,Math.max(1,Number($('demoMorningDefault').value)||1)),evening:Math.min(10,Math.max(1,Number($('demoEveningDefault').value)||1)),night:Math.min(10,Math.max(1,Number($('demoNightDefault').value)||1)),showDates:$('demoShowDates').checked,shiftMode:Number($('demoShiftMode').value),nightEnabled:$('demoNightEnabled').checked,showBreakfast:$('demoShowBreakfast').checked,showLunch:$('demoShowLunch').checked};demoState.week.forEach(ensureShiftDefaults);saveState();render();loadEditor();demoEditorBaseline=JSON.stringify(demoState.week);$('demoSettingsDialog').close();status('Grundindstillingerne er gemt')};
$('demoOpenStaff').onclick=()=>{$('demoStaffDialog').showModal()};$('demoStaffClose').onclick=()=>$('demoStaffDialog').close();
$('demoImageClose').onclick=()=>$('demoImageDialog').close();
$('demoImageDialog').onclick=event=>{if(event.target===$('demoImageDialog'))$('demoImageDialog').close()};
render();
