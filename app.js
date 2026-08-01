const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
const STAFF_LOGIN_EMAIL = 'team2@visuplanner.invalid';
const SESSION_KEY = 'visuplanner-session';

const DAYS = [
  { key: 'monday', short: 'Man', name: 'MANDAG', color: '#eab308' },
  { key: 'tuesday', short: 'Tir', name: 'TIRSDAG', color: '#ef4444' },
  { key: 'wednesday', short: 'Ons', name: 'ONSDAG', color: '#22c55e' },
  { key: 'thursday', short: 'Tor', name: 'TORSDAG', color: '#f97316' },
  { key: 'friday', short: 'Fre', name: 'FREDAG', color: '#3b82f6' },
  { key: 'saturday', short: 'Lør', name: 'LØRDAG', color: '#a855f7' },
  { key: 'sunday', short: 'Søn', name: 'SØNDAG', color: '#ec4899' }
];

const emptyDay = () => ({ morning: ['', ''], evening: ['', ''], night: ['', ''], dinner: '', dinnerPhotoUrl: '', activities: [] });
const state = {
  staff: [],
  week: Object.fromEntries(DAYS.map(day => [day.key, emptyDay()])),
  session: null
};

let selectedIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
let editingActivities = [];
let pendingDinnerPhoto = null;
let refreshTimer = null;

const el = id => document.getElementById(id);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

function mondayOfCurrentWeek() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  monday.setHours(12, 0, 0, 0);
  return monday;
}

function dateForIndex(index) {
  const date = mondayOfCurrentWeek();
  date.setDate(date.getDate() + index);
  return date;
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekDates() {
  return DAYS.map((_, index) => isoDate(dateForIndex(index)));
}

function formatDate(date) {
  return new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long' }).format(date);
}

function currentDayData() {
  return state.week[DAYS[selectedIndex].key];
}

function apiHeaders(authenticated = false, extra = {}) {
  const headers = { apikey: SUPABASE_KEY, ...extra };
  if (authenticated && state.session?.access_token) headers.Authorization = `Bearer ${state.session.access_token}`;
  return headers;
}

async function apiFetch(path, options = {}, authenticated = false) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: apiHeaders(authenticated, options.headers || {})
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `HTTP ${response.status}`);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function saveSession(session) {
  state.session = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  renderLoginState();
}

function clearSession() {
  state.session = null;
  localStorage.removeItem(SESSION_KEY);
  renderLoginState();
}

async function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!saved?.refresh_token) return;
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: apiHeaders(false, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ refresh_token: saved.refresh_token })
    });
    if (!response.ok) throw new Error('Sessionen er udløbet');
    saveSession(await response.json());
  } catch {
    clearSession();
  }
}

async function signIn(password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: apiHeaders(false, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email: STAFF_LOGIN_EMAIL, password })
  });
  if (!response.ok) throw new Error('Forkert personalekode.');
  saveSession(await response.json());
}

async function signOut() {
  try {
    if (state.session?.access_token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: apiHeaders(true) });
    }
  } finally {
    clearSession();
    el('adminDialog').close();
  }
}

async function loadData({ quiet = false } = {}) {
  if (!quiet) setStatus('Henter ugeplan…');
  const dates = weekDates();
  const dateFilter = `(${dates.join(',')})`;
  try {
    const [staff, plans, shifts, activities] = await Promise.all([
      apiFetch('/rest/v1/staff?select=*&active=eq.true&order=sort_order.asc,name.asc'),
      apiFetch(`/rest/v1/day_plans?select=*&plan_date=in.${dateFilter}`),
      apiFetch(`/rest/v1/shifts?select=*&plan_date=in.${dateFilter}`),
      apiFetch(`/rest/v1/activities?select=*&plan_date=in.${dateFilter}&order=activity_time.asc,sort_order.asc`)
    ]);

    state.staff = staff || [];
    state.week = Object.fromEntries(DAYS.map(day => [day.key, emptyDay()]));
    const staffById = new Map(state.staff.map(person => [person.id, person]));

    dates.forEach((date, index) => {
      const data = state.week[DAYS[index].key];
      const plan = (plans || []).find(item => item.plan_date === date);
      if (plan) {
        data.dinner = plan.dinner_name || '';
        data.dinnerPhotoUrl = plan.dinner_photo_url || '';
      }
      (shifts || []).filter(item => item.plan_date === date).forEach(shift => {
        const target = { morning: 'morning', evening: 'evening', night: 'night' }[shift.shift_type];
        const person = staffById.get(shift.staff_id);
        if (target && person) data[target][shift.slot - 1] = person.name;
      });
      data.activities = (activities || []).filter(item => item.plan_date === date).map(item => ({
        id: item.id,
        time: item.activity_time ? item.activity_time.slice(0, 5) : '',
        name: item.name,
        photoUrl: item.photo_url || ''
      }));
    });

    render();
    setStatus('Opdateret', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Kunne ikke hente ugeplanen. Prøv igen.', 'error');
  }
}

function setStatus(message, type = '') {
  const target = el('syncStatus');
  target.textContent = message;
  target.className = `sync-status ${type}`;
  if (type === 'success') setTimeout(() => { target.textContent = ''; target.className = 'sync-status'; }, 1800);
}

function renderTabs() {
  el('dayTabs').innerHTML = DAYS.map((day, index) => `<button class="day-tab ${index === selectedIndex ? 'active' : ''}" data-index="${index}">${day.short}</button>`).join('');
  document.querySelectorAll('.day-tab').forEach(button => button.addEventListener('click', () => {
    selectedIndex = Number(button.dataset.index);
    render();
  }));
}

function staffByName(name) {
  return state.staff.find(person => person.name === name);
}

function renderPeople(target, names) {
  const people = names.filter(Boolean);
  el(target).innerHTML = people.length ? people.map(name => {
    const person = staffByName(name);
    return `<div class="person">${person?.photo_url ? `<img src="${escapeHtml(person.photo_url)}" alt="">` : '<span class="avatar-placeholder">👤</span>'}<span>${escapeHtml(name)}</span></div>`;
  }).join('') : '<p class="empty">Ikke udfyldt</p>';
}

function render() {
  const day = DAYS[selectedIndex];
  const data = currentDayData();
  document.documentElement.style.setProperty('--day-color', day.color);
  el('dayLabel').textContent = day.name;
  el('dateLabel').textContent = formatDate(dateForIndex(selectedIndex));
  renderPeople('morningStaff', data.morning);
  renderPeople('eveningStaff', data.evening);
  renderPeople('nightStaff', data.night);
  el('dinnerText').textContent = data.dinner || 'Ikke udfyldt';
  el('dinnerPhoto').innerHTML = data.dinnerPhotoUrl ? `<img src="${escapeHtml(data.dinnerPhotoUrl)}" alt="${escapeHtml(data.dinner || 'Aftensmad')}">` : '';
  el('activitiesList').innerHTML = data.activities.length ? data.activities.map(activity => `<div class="activity"><div class="activity-time">${escapeHtml(activity.time)}</div><div class="activity-name">${escapeHtml(activity.name)}</div></div>`).join('') : '<p class="empty">Ingen aktiviteter</p>';
  renderTabs();
}

function renderLoginState() {
  el('logoutButton').hidden = !state.session;
}

function fillStaffSelect(select, value) {
  select.innerHTML = '<option value="">Vælg medarbejder</option>' + state.staff.map(person => `<option ${person.name === value ? 'selected' : ''}>${escapeHtml(person.name)}</option>`).join('');
}

function openAdmin() {
  el('adminDaySelect').innerHTML = DAYS.map((day, index) => `<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${day.name}</option>`).join('');
  loadAdminDay();
  renderStaffManager();
  el('adminDialog').showModal();
}

function loadAdminDay() {
  const index = Number(el('adminDaySelect').value || selectedIndex);
  const data = state.week[DAYS[index].key];
  [['morning1', data.morning[0]], ['morning2', data.morning[1]], ['evening1', data.evening[0]], ['evening2', data.evening[1]], ['night1', data.night[0]], ['night2', data.night[1]]].forEach(([id, value]) => fillStaffSelect(el(id), value));
  el('dinnerInput').value = data.dinner || '';
  el('dinnerPhotoInput').value = '';
  el('dinnerPhotoName').textContent = data.dinnerPhotoUrl ? 'Der er allerede et billede. Vælg et nyt for at udskifte det.' : 'Intet billede valgt.';
  pendingDinnerPhoto = null;
  editingActivities = structuredClone(data.activities || []);
  renderActivityEditor();
}

function renderActivityEditor() {
  el('activityEditor').innerHTML = editingActivities.length ? editingActivities.map((activity, index) => `<div class="activity-edit-row"><input type="time" value="${escapeHtml(activity.time)}" data-index="${index}" data-field="time"><input value="${escapeHtml(activity.name)}" placeholder="Aktivitet" data-index="${index}" data-field="name"><button class="remove-row" data-remove="${index}" type="button">✕</button></div>`).join('') : '<p class="empty">Ingen aktiviteter endnu.</p>';
  document.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => {
    editingActivities[Number(input.dataset.index)][input.dataset.field] = input.value;
  }));
  document.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
    editingActivities.splice(Number(button.dataset.remove), 1);
    renderActivityEditor();
  }));
}

function renderStaffManager() {
  el('staffManager').innerHTML = state.staff.map(person => `<div class="staff-manage-row">
    ${person.photo_url ? `<img src="${escapeHtml(person.photo_url)}" alt="">` : '<span class="avatar-placeholder">👤</span>'}
    <strong>${escapeHtml(person.name)}</strong>
    <label class="upload-button">${person.photo_url ? 'Skift billede' : 'Tilføj billede'}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-staff-photo="${person.id}"></label>
  </div>`).join('');
  document.querySelectorAll('[data-staff-photo]').forEach(input => input.addEventListener('change', async () => {
    if (!input.files?.[0]) return;
    await uploadStaffPhoto(input.dataset.staffPhoto, input.files[0]);
  }));
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Vælg en billedfil.');
  const bitmap = await createImageBitmap(file);
  const maxSize = 1200;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Billedet kunne ikke behandles.')), 'image/jpeg', 0.82));
}

async function uploadImage(file, path) {
  const image = await compressImage(file);
  await apiFetch(`/storage/v1/object/visuplan-images/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: image
  }, true);
  return `${SUPABASE_URL}/storage/v1/object/public/visuplan-images/${path}`;
}

async function uploadStaffPhoto(staffId, file) {
  try {
    setStatus('Uploader personalebillede…');
    const photoUrl = await uploadImage(file, `staff/${staffId}-${Date.now()}.jpg`);
    await apiFetch(`/rest/v1/staff?id=eq.${encodeURIComponent(staffId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ photo_url: photoUrl })
    }, true);
    await loadData({ quiet: true });
    renderStaffManager();
    loadAdminDay();
    setStatus('Billedet er gemt', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Billedet kunne ikke gemmes.', 'error');
  }
}

async function addStaff() {
  const name = el('newStaffName').value.trim();
  if (!name) return;
  if (state.staff.some(person => person.name.toLowerCase() === name.toLowerCase())) {
    setStatus('Medarbejderen findes allerede.', 'error');
    return;
  }
  try {
    await apiFetch('/rest/v1/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ name, sort_order: state.staff.length + 1 })
    }, true);
    el('newStaffName').value = '';
    await loadData({ quiet: true });
    renderStaffManager();
    loadAdminDay();
    setStatus('Medarbejderen er tilføjet', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Medarbejderen kunne ikke tilføjes.', 'error');
  }
}

async function saveDay() {
  const button = el('saveDayButton');
  button.disabled = true;
  button.textContent = 'Gemmer…';
  const index = Number(el('adminDaySelect').value);
  const planDate = weekDates()[index];
  const existing = state.week[DAYS[index].key];

  try {
    let dinnerPhotoUrl = existing.dinnerPhotoUrl || '';
    if (pendingDinnerPhoto) dinnerPhotoUrl = await uploadImage(pendingDinnerPhoto, `dinners/${planDate}-${Date.now()}.jpg`);

    await apiFetch('/rest/v1/day_plans?on_conflict=plan_date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ plan_date: planDate, dinner_name: el('dinnerInput').value.trim(), dinner_photo_url: dinnerPhotoUrl, updated_at: new Date().toISOString() })
    }, true);

    await apiFetch(`/rest/v1/shifts?plan_date=eq.${planDate}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, true);
    const shiftInputs = [
      ['morning', 1, 'morning1'], ['morning', 2, 'morning2'],
      ['evening', 1, 'evening1'], ['evening', 2, 'evening2'],
      ['night', 1, 'night1'], ['night', 2, 'night2']
    ];
    const shifts = shiftInputs.map(([shiftType, slot, inputId]) => {
      const person = staffByName(el(inputId).value);
      return person ? { plan_date: planDate, shift_type: shiftType, slot, staff_id: person.id } : null;
    }).filter(Boolean);
    if (shifts.length) {
      await apiFetch('/rest/v1/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(shifts)
      }, true);
    }

    await apiFetch(`/rest/v1/activities?plan_date=eq.${planDate}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, true);
    const activities = editingActivities.filter(activity => activity.name.trim()).map((activity, order) => ({
      plan_date: planDate,
      activity_time: activity.time || null,
      name: activity.name.trim(),
      sort_order: order
    }));
    if (activities.length) {
      await apiFetch('/rest/v1/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(activities)
      }, true);
    }

    selectedIndex = index;
    await loadData({ quiet: true });
    loadAdminDay();
    button.textContent = 'Gemt ✓';
    setStatus('Dagen er gemt på alle enheder', 'success');
  } catch (error) {
    console.error(error);
    button.textContent = 'Prøv igen';
    setStatus('Dagen kunne ikke gemmes.', 'error');
  } finally {
    button.disabled = false;
    setTimeout(() => { button.textContent = 'Gem dagen'; }, 1600);
  }
}

el('prevDay').addEventListener('click', () => { selectedIndex = (selectedIndex + 6) % 7; render(); });
el('nextDay').addEventListener('click', () => { selectedIndex = (selectedIndex + 1) % 7; render(); });
el('adminButton').addEventListener('click', () => {
  if (state.session) return openAdmin();
  el('pinInput').value = '';
  el('loginError').textContent = '';
  el('loginDialog').showModal();
});
el('loginSubmit').addEventListener('click', async event => {
  event.preventDefault();
  const button = el('loginSubmit');
  button.disabled = true;
  button.textContent = 'Logger ind…';
  try {
    await signIn(el('pinInput').value);
    el('loginDialog').close();
    await loadData({ quiet: true });
    openAdmin();
  } catch (error) {
    el('loginError').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Log ind';
  }
});
el('closeAdmin').addEventListener('click', () => el('adminDialog').close());
el('logoutButton').addEventListener('click', signOut);
el('adminDaySelect').addEventListener('change', loadAdminDay);
el('addActivityRow').addEventListener('click', () => { editingActivities.push({ time: '10:00', name: '' }); renderActivityEditor(); });
el('saveDayButton').addEventListener('click', saveDay);
el('addStaffButton').addEventListener('click', addStaff);
el('dinnerPhotoInput').addEventListener('change', event => {
  pendingDinnerPhoto = event.target.files?.[0] || null;
  el('dinnerPhotoName').textContent = pendingDinnerPhoto ? pendingDinnerPhoto.name : 'Intet billede valgt.';
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadData({ quiet: true }); });

async function init() {
  render();
  renderLoginState();
  await restoreSession();
  await loadData();
  refreshTimer = setInterval(() => loadData({ quiet: true }), 30000);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js');
init();
