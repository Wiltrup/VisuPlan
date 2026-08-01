const DAYS = [
  { key: 'monday', short: 'Man', name: 'MANDAG', color: '#eab308' },
  { key: 'tuesday', short: 'Tir', name: 'TIRSDAG', color: '#ef4444' },
  { key: 'wednesday', short: 'Ons', name: 'ONSDAG', color: '#22c55e' },
  { key: 'thursday', short: 'Tor', name: 'TORSDAG', color: '#f97316' },
  { key: 'friday', short: 'Fre', name: 'FREDAG', color: '#3b82f6' },
  { key: 'saturday', short: 'Lør', name: 'LØRDAG', color: '#a855f7' },
  { key: 'sunday', short: 'Søn', name: 'SØNDAG', color: '#ec4899' }
];

const defaultState = {
  pin: '2468',
  staff: ['Jakob', 'Eva', 'Ebru', 'Vibeke', 'Anja'],
  week: {
    monday: { morning:['Jakob','Eva'], evening:['Vibeke','Anja'], night:['Ebru','Jakob'], dinner:'Mad i TAK', activities:[{time:'10:00', name:'TAK-tur'}, {time:'14:00', name:'Musik'}] },
    tuesday: { morning:['Eva','Ebru'], evening:['Anja','Jakob'], night:['Vibeke','Eva'], dinner:'Frikadeller med kartofler', activities:[{time:'13:30', name:'Kreativ aktivitet'}] },
    wednesday: { morning:['Vibeke','Anja'], evening:['Jakob','Ebru'], night:['Eva','Vibeke'], dinner:'Pasta med kødsovs', activities:[{time:'10:30', name:'Mad i TAK'}] },
    thursday: { morning:['Jakob','Ebru'], evening:['Eva','Vibeke'], night:['Anja','Jakob'], dinner:'Fisk med grøntsager', activities:[{time:'11:00', name:'Gåtur'}] },
    friday: { morning:['Anja','Eva'], evening:['Ebru','Jakob'], night:['Vibeke','Anja'], dinner:'Pizza', activities:[{time:'17:00', name:'Fest i TAK'}] },
    saturday: { morning:['Ebru','Vibeke'], evening:['Jakob','Eva'], night:['Anja','Ebru'], dinner:'Kylling med ris', activities:[{time:'10:00', name:'TAK-tur'}] },
    sunday: { morning:['Jakob','Anja'], evening:['Eva','Vibeke'], night:['Ebru','Jakob'], dinner:'Mad i TAK', activities:[] }
  }
};

let state = loadState();
let selectedIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
let editingActivities = [];

const el = id => document.getElementById(id);
function loadState(){
  try { return JSON.parse(localStorage.getItem('visuplan-state')) || structuredClone(defaultState); }
  catch { return structuredClone(defaultState); }
}
function saveState(){ localStorage.setItem('visuplan-state', JSON.stringify(state)); }
function mondayOfCurrentWeek(){
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  monday.setHours(12,0,0,0);
  return monday;
}
function dateForIndex(index){ const d = mondayOfCurrentWeek(); d.setDate(d.getDate()+index); return d; }
function formatDate(date){ return new Intl.DateTimeFormat('da-DK', { day:'numeric', month:'long' }).format(date); }
function currentDayData(){ return state.week[DAYS[selectedIndex].key]; }

function renderTabs(){
  el('dayTabs').innerHTML = DAYS.map((d,i)=>`<button class="day-tab ${i===selectedIndex?'active':''}" data-index="${i}">${d.short}</button>`).join('');
  document.querySelectorAll('.day-tab').forEach(btn=>btn.addEventListener('click',()=>{ selectedIndex=Number(btn.dataset.index); render(); }));
}
function renderPeople(target, names){
  el(target).innerHTML = names.filter(Boolean).length ? names.filter(Boolean).map(n=>`<div class="person">${escapeHtml(n)}</div>`).join('') : '<p class="empty">Ikke udfyldt</p>';
}
function render(){
  const day = DAYS[selectedIndex];
  const data = currentDayData();
  document.documentElement.style.setProperty('--day-color', day.color);
  el('dayLabel').textContent = day.name;
  el('dateLabel').textContent = formatDate(dateForIndex(selectedIndex));
  renderPeople('morningStaff', data.morning);
  renderPeople('eveningStaff', data.evening);
  renderPeople('nightStaff', data.night);
  el('dinnerText').textContent = data.dinner || 'Ikke udfyldt';
  el('activitiesList').innerHTML = data.activities.length ? data.activities.map(a=>`<div class="activity"><div class="activity-time">${escapeHtml(a.time)}</div><div class="activity-name">${escapeHtml(a.name)}</div></div>`).join('') : '<p class="empty">Ingen aktiviteter</p>';
  renderTabs();
}
function escapeHtml(value=''){ return value.replace(/[&<>'"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }

el('prevDay').addEventListener('click',()=>{ selectedIndex=(selectedIndex+6)%7; render(); });
el('nextDay').addEventListener('click',()=>{ selectedIndex=(selectedIndex+1)%7; render(); });
el('adminButton').addEventListener('click',()=>{ el('pinInput').value=''; el('loginError').textContent=''; el('loginDialog').showModal(); });
el('loginSubmit').addEventListener('click',e=>{
  e.preventDefault();
  if(el('pinInput').value===state.pin){ el('loginDialog').close(); openAdmin(); }
  else el('loginError').textContent='Forkert PIN.';
});
el('closeAdmin').addEventListener('click',()=>el('adminDialog').close());

function fillStaffSelect(select, value){
  select.innerHTML = '<option value="">Vælg medarbejder</option>' + state.staff.map(n=>`<option ${n===value?'selected':''}>${escapeHtml(n)}</option>`).join('');
}
function openAdmin(){
  el('adminDaySelect').innerHTML = DAYS.map((d,i)=>`<option value="${i}" ${i===selectedIndex?'selected':''}>${d.name}</option>`).join('');
  loadAdminDay();
  renderStaffChips();
  el('adminDialog').showModal();
}
function loadAdminDay(){
  const index = Number(el('adminDaySelect').value || selectedIndex);
  const data = state.week[DAYS[index].key];
  [['morning1',data.morning[0]],['morning2',data.morning[1]],['evening1',data.evening[0]],['evening2',data.evening[1]],['night1',data.night[0]],['night2',data.night[1]]].forEach(([id,val])=>fillStaffSelect(el(id),val));
  el('dinnerInput').value=data.dinner||'';
  editingActivities=structuredClone(data.activities||[]);
  renderActivityEditor();
}
el('adminDaySelect').addEventListener('change',loadAdminDay);
function renderActivityEditor(){
  el('activityEditor').innerHTML = editingActivities.length ? editingActivities.map((a,i)=>`<div class="activity-edit-row"><input type="time" value="${escapeHtml(a.time)}" data-index="${i}" data-field="time"><input value="${escapeHtml(a.name)}" placeholder="Aktivitet" data-index="${i}" data-field="name"><button class="remove-row" data-remove="${i}" type="button">✕</button></div>`).join('') : '<p class="empty">Ingen aktiviteter endnu.</p>';
  document.querySelectorAll('[data-field]').forEach(input=>input.addEventListener('input',()=>{ editingActivities[Number(input.dataset.index)][input.dataset.field]=input.value; }));
  document.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click',()=>{ editingActivities.splice(Number(btn.dataset.remove),1); renderActivityEditor(); }));
}
el('addActivityRow').addEventListener('click',()=>{ editingActivities.push({time:'10:00',name:''}); renderActivityEditor(); });
el('saveDayButton').addEventListener('click',()=>{
  const index=Number(el('adminDaySelect').value);
  state.week[DAYS[index].key]={
    morning:[el('morning1').value,el('morning2').value], evening:[el('evening1').value,el('evening2').value], night:[el('night1').value,el('night2').value], dinner:el('dinnerInput').value.trim(), activities:editingActivities.filter(a=>a.name.trim()).map(a=>({time:a.time||'',name:a.name.trim()}))
  };
  saveState(); selectedIndex=index; render();
  el('saveDayButton').textContent='Gemt ✓'; setTimeout(()=>el('saveDayButton').textContent='Gem dagen',1200);
});
el('addStaffButton').addEventListener('click',()=>{
  const name=el('newStaffName').value.trim();
  if(name && !state.staff.some(n=>n.toLowerCase()===name.toLowerCase())){ state.staff.push(name); saveState(); el('newStaffName').value=''; renderStaffChips(); loadAdminDay(); }
});
function renderStaffChips(){ el('staffChips').innerHTML=state.staff.map(n=>`<span class="chip">${escapeHtml(n)}</span>`).join(''); }
el('resetButton').addEventListener('click',()=>{ if(confirm('Vil du nulstille hele demoen?')){ state=structuredClone(defaultState); saveState(); loadAdminDay(); renderStaffChips(); render(); } });

if('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js');
render();
