const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
const STAFF_LOGIN_EMAIL = 'team2@visuplanner.invalid';
const VIEWER_LOGIN_EMAIL = 'team2-viewer@visuplanner.invalid';
const PLATFORM_ADMIN_EMAIL = 'wiltrup@wiltrup.com';
const SESSION_KEY = 'visuplanner-session';
const VIEWER_SESSION_KEY = 'visuplanner-viewer-session';

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
  activeWeekStart: null,
  staffingDefaults: { morning: 2, evening: 2, night: 2 },
  showDatesPublic: true,
  session: null
};

let selectedIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
let editingActivities = [];
let pendingDinnerPhoto = null;
let refreshTimer = null;
let editingWeekStart = null;
let editingWeek = Object.fromEntries(DAYS.map(day => [day.key, emptyDay()]));
let editingShifts = { morning: [], evening: [], night: [] };
let selectedPexelsPhoto = null;
const signedImageCache = new Map();

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

function dateFromIso(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function addDaysIso(value, days) {
  const date = dateFromIso(value);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function currentCalendarWeekStart() {
  return isoDate(mondayOfCurrentWeek());
}

function dateForIndex(index, weekStart = state.activeWeekStart || currentCalendarWeekStart()) {
  const date = dateFromIso(weekStart);
  date.setDate(date.getDate() + index);
  return date;
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekDates(weekStart = state.activeWeekStart || currentCalendarWeekStart()) {
  return DAYS.map((_, index) => isoDate(dateForIndex(index, weekStart)));
}

function formatDate(date) {
  return new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long' }).format(date);
}

function currentDayData() {
  return state.week[DAYS[selectedIndex].key];
}

function apiHeaders(authenticated = false, extra = {}) {
  const token = authenticated && state.session?.access_token ? state.session.access_token : SUPABASE_KEY;
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...extra };
  return headers;
}

function isStaffSession() { return [STAFF_LOGIN_EMAIL, PLATFORM_ADMIN_EMAIL].includes(state.session?.user?.email); }
function isViewerSession() { return state.session?.user?.email === VIEWER_LOGIN_EMAIL; }

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

function saveSession(session, rememberViewer = false) {
  state.session = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (rememberViewer || session?.user?.email === VIEWER_LOGIN_EMAIL) sessionStorage.setItem(VIEWER_SESSION_KEY, JSON.stringify(session));
  renderLoginState();
}

function clearSession() {
  state.session = null;
  sessionStorage.removeItem(SESSION_KEY);
  renderLoginState();
}

async function refreshSavedSession(storageKey) {
  const saved = JSON.parse(sessionStorage.getItem(storageKey));
  if (!saved?.refresh_token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: apiHeaders(false, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ refresh_token: saved.refresh_token })
  });
  if (!response.ok) throw new Error('Sessionen er udløbet');
  return response.json();
}

async function restoreSession() {
  try {
    const session = await refreshSavedSession(SESSION_KEY);
    if (session) saveSession(session, session.user?.email === VIEWER_LOGIN_EMAIL);
  } catch {
    clearSession();
  }
}

async function authenticate(email, password, errorMessage) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: apiHeaders(false, { 'Content-Type': 'application/json' }), body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(errorMessage);
  return response.json();
}

async function signInViewer(password) {
  saveSession(await authenticate(VIEWER_LOGIN_EMAIL, password, 'Forkert teamkode.'), true);
}

async function signIn(password) {
  saveSession(await authenticate(STAFF_LOGIN_EMAIL, password, 'Forkert personalekode.'));
}

async function signOut() {
  try {
    if (state.session?.access_token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: apiHeaders(true) });
    }
  } finally {
    clearSession();
    el('adminDialog').close();
    try {
      const viewerSession = await refreshSavedSession(VIEWER_SESSION_KEY);
      if (viewerSession) { saveSession(viewerSession, true); await loadData({ quiet: true }); return; }
    } catch { sessionStorage.removeItem(VIEWER_SESSION_KEY); }
    el('viewerLoginDialog').showModal();
  }
}

async function leaveBoard() {
  try {
    if (state.session?.access_token) await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: apiHeaders(true) });
  } finally {
    state.session = null;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(VIEWER_SESSION_KEY);
    renderLoginState();
    el('viewerPinInput').value = '';
    el('viewerLoginDialog').showModal();
  }
}

async function resolvePhotoUrl(url) {
  if (!url) return '';
  const marker = '/storage/v1/object/public/visuplan-images/';
  const path = url.includes(marker) ? url.split(marker)[1] : '';
  if (!path) return url;
  if (signedImageCache.has(path)) return signedImageCache.get(path);
  try {
    const result = await apiFetch(`/storage/v1/object/sign/visuplan-images/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 })
    }, true);
    const signed = result?.signedURL ? `${SUPABASE_URL}${result.signedURL}` : url;
    signedImageCache.set(path, signed);
    return signed;
  } catch { return url; }
}

function stablePhotoUrl(url) {
  if (!url) return '';
  const signedMarker = '/storage/v1/object/sign/visuplan-images/';
  if (!url.includes(signedMarker)) return url;
  const path = url.split(signedMarker)[1].split('?')[0];
  return `${SUPABASE_URL}/storage/v1/object/public/visuplan-images/${path}`;
}

async function fetchWeek(weekStart) {
  const dates = weekDates(weekStart);
  const dateFilter = `(${dates.join(',')})`;
  const [plans, shifts, activities] = await Promise.all([
    apiFetch(`/rest/v1/day_plans?select=*&plan_date=in.${dateFilter}`, {}, true),
    apiFetch(`/rest/v1/shifts?select=*&plan_date=in.${dateFilter}`, {}, true),
    apiFetch(`/rest/v1/activities?select=*&plan_date=in.${dateFilter}&order=activity_time.asc,sort_order.asc`, {}, true)
  ]);
  const securePlans = await Promise.all((plans || []).map(async item => ({ ...item, dinner_photo_url: await resolvePhotoUrl(item.dinner_photo_url || '') })));
  const secureActivities = await Promise.all((activities || []).map(async item => ({ ...item, photo_url: await resolvePhotoUrl(item.photo_url || '') })));
  const week = Object.fromEntries(DAYS.map(day => [day.key, emptyDay()]));
  const staffById = new Map(state.staff.map(person => [person.id, person]));

  dates.forEach((date, index) => {
      const data = week[DAYS[index].key];
      const plan = securePlans.find(item => item.plan_date === date);
      if (plan) {
        data.dinner = plan.dinner_name || '';
        data.dinnerPhotoUrl = plan.dinner_photo_url || '';
      }
      (shifts || []).filter(item => item.plan_date === date).forEach(shift => {
        const target = { morning: 'morning', evening: 'evening', night: 'night' }[shift.shift_type];
        const person = staffById.get(shift.staff_id);
        if (target && person) data[target][shift.slot - 1] = person.name;
      });
      data.activities = secureActivities.filter(item => item.plan_date === date).map(item => ({
        id: item.id,
        time: item.activity_time ? item.activity_time.slice(0, 5) : '',
        name: item.name,
        photoUrl: item.photo_url || ''
      }));
  });
  return week;
}

async function loadData({ quiet = false } = {}) {
  if (!quiet) setStatus('Henter ugeplan…');
  try {
    const [staff, settings] = await Promise.all([
      apiFetch('/rest/v1/staff?select=*&order=sort_order.asc,name.asc', {}, true),
      apiFetch('/rest/v1/team_settings?select=active_week_start,morning_staff_count,evening_staff_count,night_staff_count,show_dates_public&id=eq.team2', {}, true)
    ]);
    state.staff = await Promise.all((staff || []).map(async person => ({ ...person, photo_url: await resolvePhotoUrl(person.photo_url || '') })));
    const savedWeekStart = settings?.[0]?.active_week_start || currentCalendarWeekStart();
    const calendarWeekStart = currentCalendarWeekStart();
    // En fremtidig uge kan vises allerede søndag. En gammel uge må aldrig
    // blive hængende, når kalenderen skifter til en ny mandag.
    state.activeWeekStart = savedWeekStart < calendarWeekStart ? calendarWeekStart : savedWeekStart;
    state.staffingDefaults = {
      morning: settings?.[0]?.morning_staff_count || 2,
      evening: settings?.[0]?.evening_staff_count || 2,
      night: settings?.[0]?.night_staff_count || 2
    };
    state.showDatesPublic = settings?.[0]?.show_dates_public ?? true;
    if (state.activeWeekStart !== currentCalendarWeekStart()) selectedIndex = 0;
    state.week = await fetchWeek(state.activeWeekStart);
    render();
    setStatus('Opdateret', 'success');
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Kunne ikke hente ugeplanen. Prøv igen.', 'error');
    return false;
  }
}

function setStatus(message, type = '') {
  const target = el('syncStatus');
  target.textContent = message;
  target.className = `sync-status ${type}`;
  if (type === 'success') setTimeout(() => { target.textContent = ''; target.className = 'sync-status'; }, 1800);
}

function renderTabs() {
  el('dayTabs').innerHTML = DAYS.map((day, index) => `<button class="day-tab ${index === selectedIndex ? 'active' : ''}" data-index="${index}"><span>${day.short}</span>${state.showDatesPublic ? `<small>${new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'numeric' }).format(dateForIndex(index, state.activeWeekStart))}</small>` : ''}</button>`).join('');
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
    const imageAttributes = person?.photo_url ? `data-enlarge-image="${escapeHtml(person.photo_url)}" data-image-caption="${escapeHtml(name)}" role="button" tabindex="0" aria-label="Vis stort billede af ${escapeHtml(name)}"` : '';
    return `<div class="person ${person?.photo_url ? 'has-photo' : ''}" ${imageAttributes}>${person?.photo_url ? `<img src="${escapeHtml(person.photo_url)}" alt="">` : '<span class="avatar-placeholder">👤</span>'}<span>${escapeHtml(name)}</span></div>`;
  }).join('') : '<p class="empty">Ikke udfyldt</p>';
}

function render() {
  const day = DAYS[selectedIndex];
  const data = currentDayData();
  document.documentElement.style.setProperty('--day-color', day.color);
  el('dayLabel').textContent = day.name;
  el('dateLabel').textContent = formatDate(dateForIndex(selectedIndex, state.activeWeekStart));
  renderPeople('morningStaff', data.morning);
  renderPeople('eveningStaff', data.evening);
  renderPeople('nightStaff', data.night);
  el('dinnerText').textContent = data.dinner || 'Ikke udfyldt';
  el('dinnerPhoto').innerHTML = data.dinnerPhotoUrl ? `<button class="image-button" data-enlarge-image="${escapeHtml(data.dinnerPhotoUrl)}" data-image-caption="${escapeHtml(data.dinner || 'Aftensmad')}" aria-label="Vis stort billede af aftensmaden"><img src="${escapeHtml(data.dinnerPhotoUrl)}" alt="${escapeHtml(data.dinner || 'Aftensmad')}"></button>` : '';
  el('activitiesList').innerHTML = data.activities.length ? data.activities.map(activity => `<div class="activity">
    ${activity.photoUrl ? `<button class="activity-photo image-button" data-enlarge-image="${escapeHtml(activity.photoUrl)}" data-image-caption="${escapeHtml(activity.name)}" aria-label="Vis stort billede af ${escapeHtml(activity.name)}"><img src="${escapeHtml(activity.photoUrl)}" alt=""></button>` : ''}
    <div class="activity-time">${escapeHtml(activity.time)}</div><div class="activity-name">${escapeHtml(activity.name)}</div>
  </div>`).join('') : '<p class="empty">Ingen aktiviteter</p>';
  renderTabs();
  bindImageEnlargement();
}

function openLargeImage(url, caption) {
  el('largeImage').src = url;
  el('largeImage').alt = caption || 'Forstørret billede';
  el('largeImageCaption').textContent = caption || '';
  el('imageDialog').showModal();
}

function bindImageEnlargement() {
  document.querySelectorAll('[data-enlarge-image]').forEach(target => {
    target.addEventListener('click', () => openLargeImage(target.dataset.enlargeImage, target.dataset.imageCaption));
    target.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLargeImage(target.dataset.enlargeImage, target.dataset.imageCaption);
      }
    });
  });
}

function renderLoginState() {
  el('logoutButton').hidden = !isStaffSession();
}

function fillStaffSelect(select, value) {
  select.innerHTML = '<option value="">Vælg medarbejder</option>' + state.staff.map(person => `<option ${person.name === value ? 'selected' : ''}>${escapeHtml(person.name)}</option>`).join('');
}

function staffOptions(value) {
  return '<option value="">Vælg medarbejder</option>' + state.staff.filter(person => person.active || person.name === value).map(person => `<option ${person.name === value ? 'selected' : ''}>${escapeHtml(person.name)}</option>`).join('');
}

function formatWeekRange(weekStart) {
  const start = dateFromIso(weekStart);
  const end = dateForIndex(6, weekStart);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function defaultEditingWeekStart() {
  const calendarWeek = currentCalendarWeekStart();
  if (new Date().getDay() === 0 && state.activeWeekStart === calendarWeek) return addDaysIso(calendarWeek, 7);
  return state.activeWeekStart;
}

async function setEditingWeek(weekStart, preferredDay = 0) {
  setStatus('Henter ugen…');
  editingWeekStart = weekStart;
  editingWeek = await fetchWeek(editingWeekStart);
  el('adminWeekLabel').textContent = formatWeekRange(editingWeekStart);
  el('adminDaySelect').innerHTML = DAYS.map((day, index) => `<option value="${index}" ${index === preferredDay ? 'selected' : ''}>${day.name} ${formatDate(dateForIndex(index, editingWeekStart))}</option>`).join('');
  loadAdminDay();
  setStatus('Ugen er hentet', 'success');
}

async function openAdmin() {
  const start = defaultEditingWeekStart();
  const preferredDay = start === state.activeWeekStart ? selectedIndex : 0;
  renderStaffManager();
  el('adminDialog').showModal();
  try {
    await setEditingWeek(start, preferredDay);
  } catch (error) {
    console.error(error);
    setStatus('Ugen kunne ikke hentes.', 'error');
  }
}

function loadAdminDay() {
  const index = Number(el('adminDaySelect').value || selectedIndex);
  const data = editingWeek[DAYS[index].key];
  editingShifts = {};
  ['morning', 'evening', 'night'].forEach(type => {
    editingShifts[type] = (data[type] || []).filter(Boolean);
    while (editingShifts[type].length < state.staffingDefaults[type]) editingShifts[type].push('');
  });
  renderShiftEditors();
  el('dinnerInput').value = data.dinner || '';
  el('dinnerPhotoInput').value = '';
  el('dinnerPhotoName').textContent = data.dinnerPhotoUrl ? 'Der er allerede et billede. Vælg et nyt for at udskifte det.' : 'Intet billede valgt.';
  pendingDinnerPhoto = null;
  selectedPexelsPhoto = null;
  editingActivities = structuredClone(data.activities || []);
  renderActivityEditor();
}

async function searchPexels(query) {
  if (!state.session?.access_token) throw new Error('Log ind som personale først.');
  const response = await fetch(`/api/pexels-search?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${state.session.access_token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Billedsøgningen fejlede.');
  return data.photos || [];
}

function renderPexelsResults(photos) {
  const target = el('imageSearchResults');
  if (!photos.length) {
    target.innerHTML = '<p class="image-search-message">Ingen billeder fundet. Prøv et andet eller mere enkelt søgeord.</p>';
    return;
  }
  target.innerHTML = photos.map((photo, index) => `<button type="button" class="image-search-result" data-pexels-index="${index}"><img src="${escapeHtml(photo.thumbnail)}" alt="${escapeHtml(photo.alt)}" loading="lazy"><span>Foto: ${escapeHtml(photo.photographer)}</span></button>`).join('');
  document.querySelectorAll('[data-pexels-index]').forEach(button => button.addEventListener('click', async () => {
    const photo = photos[Number(button.dataset.pexelsIndex)];
    button.disabled = true;
    setStatus('Henter billedet…');
    try {
      const imageResponse = await fetch(`/api/pexels-image?id=${encodeURIComponent(photo.id)}`, { headers: { Authorization: `Bearer ${state.session.access_token}` } });
      if (!imageResponse.ok) throw new Error('Billedet kunne ikke hentes.');
      const blob = await imageResponse.blob();
      selectedPexelsPhoto = photo;
      pendingDinnerPhoto = new File([blob], `pexels-${photo.id}.jpg`, { type: blob.type || 'image/jpeg' });
      el('dinnerPhotoInput').value = '';
      el('dinnerPhotoName').textContent = `Billede valgt fra Pexels · Foto: ${photo.photographer}`;
      el('imageSearchDialog').close();
      setStatus('Billedet er valgt – husk Gem dagen', 'success');
    } catch (error) {
      console.error(error);
      setStatus('Billedet kunne ikke hentes. Prøv et andet.', 'error');
      button.disabled = false;
    }
  }));
}

function renderShiftEditors() {
  const labels = { morning: 'Morgen', evening: 'Aften', night: 'Nat' };
  ['morning', 'evening', 'night'].forEach(type => {
    const values = editingShifts[type];
    el(`${type}Editors`).innerHTML = values.map((value, index) => `<div class="shift-person-row">
      <select data-shift-type="${type}" data-shift-index="${index}" aria-label="${labels[type]} medarbejder ${index + 1}">${staffOptions(value)}</select>
      ${index >= state.staffingDefaults[type] ? `<button type="button" class="remove-shift-person" data-remove-shift="${type}" data-remove-index="${index}" aria-label="Fjern medarbejderfelt">✕</button>` : ''}
    </div>`).join('');
  });
  document.querySelectorAll('[data-shift-type]').forEach(select => select.addEventListener('change', () => {
    editingShifts[select.dataset.shiftType][Number(select.dataset.shiftIndex)] = select.value;
  }));
  document.querySelectorAll('[data-remove-shift]').forEach(button => button.addEventListener('click', () => {
    editingShifts[button.dataset.removeShift].splice(Number(button.dataset.removeIndex), 1);
    renderShiftEditors();
  }));
  document.querySelectorAll('[data-add-shift]').forEach(button => {
    button.disabled = editingShifts[button.dataset.addShift].length >= 10;
  });
}

function renderActivityEditor() {
  el('activityEditor').innerHTML = editingActivities.length ? editingActivities.map((activity, index) => `<div class="activity-edit-row">
    <input type="time" value="${escapeHtml(activity.time)}" data-index="${index}" data-field="time">
    <input value="${escapeHtml(activity.name)}" placeholder="Aktivitet" data-index="${index}" data-field="name">
    <button class="remove-row" data-remove="${index}" type="button">✕</button>
    <label class="activity-upload-button">${activity.photoFile ? 'Nyt billede valgt ✓' : activity.photoUrl ? 'Skift aktivitetsbillede' : '+ Billede til aktiviteten'}<input type="file" accept="image/jpeg,image/png,image/webp" data-activity-photo="${index}"></label>
  </div>`).join('') : '<p class="empty">Ingen aktiviteter endnu.</p>';
  document.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => {
    editingActivities[Number(input.dataset.index)][input.dataset.field] = input.value;
  }));
  document.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
    editingActivities.splice(Number(button.dataset.remove), 1);
    renderActivityEditor();
  }));
  document.querySelectorAll('[data-activity-photo]').forEach(input => input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    editingActivities[Number(input.dataset.activityPhoto)].photoFile = file;
    renderActivityEditor();
  }));
}

function renderStaffManager() {
  el('staffManager').innerHTML = state.staff.filter(person => person.active).map(person => `<div class="staff-manage-row">
    ${person.photo_url ? `<img src="${escapeHtml(person.photo_url)}" alt="">` : '<span class="avatar-placeholder">👤</span>'}
    <strong>${escapeHtml(person.name)}</strong>
    <label class="upload-button">${person.photo_url ? 'Skift billede' : 'Tilføj billede'}<input type="file" accept="image/jpeg,image/png,image/webp" data-staff-photo="${person.id}"></label>
    <button class="edit-staff-button" type="button" data-edit-staff="${person.id}" data-staff-name="${escapeHtml(person.name)}">Rediger navn</button>
    <button class="remove-staff-button" type="button" data-deactivate-staff="${person.id}" data-staff-name="${escapeHtml(person.name)}">Fjern</button>
  </div>`).join('');
  document.querySelectorAll('[data-staff-photo]').forEach(input => input.addEventListener('change', async () => {
    if (!input.files?.[0]) return;
    await uploadStaffPhoto(input.dataset.staffPhoto, input.files[0]);
  }));
  document.querySelectorAll('[data-edit-staff]').forEach(button => button.addEventListener('click', () => renameStaff(button.dataset.editStaff, button.dataset.staffName)));
  document.querySelectorAll('[data-deactivate-staff]').forEach(button => button.addEventListener('click', () => deactivateStaff(button.dataset.deactivateStaff, button.dataset.staffName)));
}

async function renameStaff(staffId, currentName) {
  const answer = prompt('Ret medarbejderens navn:', currentName);
  if (answer === null) return;
  const name = answer.trim();
  if (!name || name === currentName) return;
  if (state.staff.some(person => person.id !== staffId && person.name.toLowerCase() === name.toLowerCase())) {
    setStatus('Der findes allerede en medarbejder med dette navn.', 'error');
    return;
  }
  try {
    await apiFetch(`/rest/v1/staff?id=eq.${encodeURIComponent(staffId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ name })
    }, true);
    await loadData({ quiet: true });
    editingWeek = await fetchWeek(editingWeekStart);
    renderStaffManager();
    loadAdminDay();
    setStatus('Navnet er ændret', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Navnet kunne ikke ændres.', 'error');
  }
}

async function deactivateStaff(staffId, name) {
  if (!confirm(`Vil du fjerne ${name} fra listen over tilgængelige medarbejdere? Personen bevares på allerede gemte planer.`)) return;
  try {
    await apiFetch(`/rest/v1/staff?id=eq.${encodeURIComponent(staffId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: false })
    }, true);
    await loadData({ quiet: true });
    editingWeek = await fetchWeek(editingWeekStart);
    renderStaffManager();
    loadAdminDay();
    setStatus(`${name} er fjernet fra valglisterne`, 'success');
  } catch (error) {
    console.error(error);
    setStatus('Medarbejderen kunne ikke fjernes.', 'error');
  }
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
    editingWeek = await fetchWeek(editingWeekStart);
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
  const existing = state.staff.find(person => person.name.toLowerCase() === name.toLowerCase());
  if (existing?.active) {
    setStatus('Medarbejderen findes allerede.', 'error');
    return;
  }
  try {
    if (existing) {
      await apiFetch(`/rest/v1/staff?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ active: true })
      }, true);
    } else {
      await apiFetch('/rest/v1/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ name, sort_order: state.staff.length + 1 })
      }, true);
    }
    el('newStaffName').value = '';
    await loadData({ quiet: true });
    editingWeek = await fetchWeek(editingWeekStart);
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
  const planDate = weekDates(editingWeekStart)[index];
  const existing = editingWeek[DAYS[index].key];

  try {
    let dinnerPhotoUrl = stablePhotoUrl(existing.dinnerPhotoUrl || '');
    if (pendingDinnerPhoto) dinnerPhotoUrl = await uploadImage(pendingDinnerPhoto, `dinners/${planDate}-${Date.now()}.jpg`);

    await apiFetch('/rest/v1/day_plans?on_conflict=plan_date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ plan_date: planDate, dinner_name: el('dinnerInput').value.trim(), dinner_photo_url: dinnerPhotoUrl, updated_at: new Date().toISOString() })
    }, true);

    await apiFetch(`/rest/v1/shifts?plan_date=eq.${planDate}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, true);
    const shifts = ['morning', 'evening', 'night'].flatMap(shiftType => editingShifts[shiftType].map((name, index) => {
      const person = staffByName(name);
      return person ? { plan_date: planDate, shift_type: shiftType, slot: index + 1, staff_id: person.id } : null;
    })).filter(Boolean);
    if (shifts.length) {
      await apiFetch('/rest/v1/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(shifts)
      }, true);
    }

    await apiFetch(`/rest/v1/activities?plan_date=eq.${planDate}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, true);
    const validActivities = editingActivities.filter(activity => activity.name.trim());
    const activities = await Promise.all(validActivities.map(async (activity, order) => {
      let photoUrl = stablePhotoUrl(activity.photoUrl || '');
      if (activity.photoFile) photoUrl = await uploadImage(activity.photoFile, `activities/${planDate}-${order}-${Date.now()}.jpg`);
      return {
        plan_date: planDate,
        activity_time: activity.time || null,
        name: activity.name.trim(),
        photo_url: photoUrl || null,
        sort_order: order
      };
    }));
    if (activities.length) {
      await apiFetch('/rest/v1/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(activities)
      }, true);
    }

    editingWeek = await fetchWeek(editingWeekStart);
    if (editingWeekStart === state.activeWeekStart) {
      state.week = editingWeek;
      selectedIndex = index;
      render();
    }
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

async function publishEditingWeek() {
  const confirmed = confirm('Du er ved at vise den valgte uge på tavlen. Tavlen går automatisk frem til den aktuelle kalenderuge hver mandag. Vil du fortsætte?');
  if (!confirmed) return;
  const button = el('publishWeekButton');
  button.disabled = true;
  button.textContent = 'Udgiver…';
  try {
    await apiFetch('/rest/v1/team_settings?on_conflict=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: 'team2', active_week_start: editingWeekStart, updated_at: new Date().toISOString() })
    }, true);
    state.activeWeekStart = editingWeekStart;
    state.week = editingWeek;
    selectedIndex = 0;
    render();
    button.textContent = 'Ugen vises nu ✓';
    setStatus('Tavlen viser nu den valgte uge', 'success');
  } catch (error) {
    console.error(error);
    button.textContent = 'Prøv igen';
    setStatus('Ugen kunne ikke udgives.', 'error');
  } finally {
    button.disabled = false;
    setTimeout(() => { button.textContent = 'Vis valgte uge på tavlen'; }, 1800);
  }
}

function openSettings() {
  el('morningDefault').value = state.staffingDefaults.morning;
  el('eveningDefault').value = state.staffingDefaults.evening;
  el('nightDefault').value = state.staffingDefaults.night;
  el('showDatesPublic').checked = state.showDatesPublic;
  el('settingsDialog').showModal();
}

async function saveSettings() {
  const button = el('saveSettingsButton');
  const defaults = {
    morning: Math.min(10, Math.max(1, Number(el('morningDefault').value) || 1)),
    evening: Math.min(10, Math.max(1, Number(el('eveningDefault').value) || 1)),
    night: Math.min(10, Math.max(1, Number(el('nightDefault').value) || 1))
  };
  button.disabled = true;
  button.textContent = 'Gemmer…';
  try {
    await apiFetch('/rest/v1/team_settings?id=eq.team2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        morning_staff_count: defaults.morning,
        evening_staff_count: defaults.evening,
        night_staff_count: defaults.night,
        show_dates_public: el('showDatesPublic').checked,
        updated_at: new Date().toISOString()
      })
    }, true);
    state.staffingDefaults = defaults;
    state.showDatesPublic = el('showDatesPublic').checked;
    render();
    el('settingsDialog').close();
    loadAdminDay();
    setStatus('Grundindstillingerne er gemt', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Indstillingerne kunne ikke gemmes.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Gem indstillinger';
  }
}

el('prevDay').addEventListener('click', () => { selectedIndex = (selectedIndex + 6) % 7; render(); });
el('nextDay').addEventListener('click', () => { selectedIndex = (selectedIndex + 1) % 7; render(); });
el('adminButton').addEventListener('click', () => {
  if (isStaffSession()) return openAdmin();
  el('pinInput').value = '';
  el('loginError').textContent = '';
  el('loginDialog').showModal();
});
el('viewerLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = el('viewerLoginSubmit');
  button.disabled = true; button.textContent = 'Åbner…'; el('viewerLoginError').textContent = '';
  try {
    await signInViewer(el('viewerPinInput').value);
    el('viewerLoginDialog').close();
    await loadData();
  } catch (error) { el('viewerLoginError').textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Åbn tavlen'; }
});
el('loginForm').addEventListener('submit', async event => {
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
el('closeLoginButton').addEventListener('click', () => el('loginDialog').close());
el('closeAdmin').addEventListener('click', () => el('adminDialog').close());
el('closeImageDialog').addEventListener('click', () => el('imageDialog').close());
el('imageDialog').addEventListener('click', event => { if (event.target === el('imageDialog')) el('imageDialog').close(); });
el('logoutButton').addEventListener('click', signOut);
el('viewerLogoutButton').addEventListener('click', leaveBoard);
el('adminDaySelect').addEventListener('change', loadAdminDay);
el('previousEditWeek').addEventListener('click', () => setEditingWeek(addDaysIso(editingWeekStart, -7), 0));
el('nextEditWeek').addEventListener('click', () => setEditingWeek(addDaysIso(editingWeekStart, 7), 0));
el('publishWeekButton').addEventListener('click', publishEditingWeek);
document.querySelectorAll('[data-add-shift]').forEach(button => button.addEventListener('click', () => {
  const type = button.dataset.addShift;
  if (editingShifts[type].length < 10) editingShifts[type].push('');
  renderShiftEditors();
}));
el('openSettingsButton').addEventListener('click', openSettings);
el('closeSettingsButton').addEventListener('click', () => el('settingsDialog').close());
el('saveSettingsButton').addEventListener('click', saveSettings);
el('addActivityRow').addEventListener('click', () => { editingActivities.push({ time: '10:00', name: '' }); renderActivityEditor(); });
el('saveDayButton').addEventListener('click', saveDay);
el('addStaffButton').addEventListener('click', addStaff);
el('dinnerPhotoInput').addEventListener('change', event => {
  pendingDinnerPhoto = event.target.files?.[0] || null;
  selectedPexelsPhoto = null;
  el('dinnerPhotoName').textContent = pendingDinnerPhoto ? pendingDinnerPhoto.name : 'Intet billede valgt.';
});
el('openDinnerImageSearch').addEventListener('click', () => {
  el('imageSearchInput').value = el('dinnerInput').value.trim();
  el('imageSearchResults').innerHTML = '<p class="image-search-message">Skriv fx “lasagne”, “frikadeller” eller “kylling med ris”.</p>';
  el('imageSearchDialog').showModal();
  el('imageSearchInput').focus();
});
el('closeImageSearch').addEventListener('click', () => el('imageSearchDialog').close());
el('imageSearchForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = el('imageSearchSubmit');
  button.disabled = true;
  button.textContent = 'Søger…';
  el('imageSearchResults').innerHTML = '<p class="image-search-message">Finder billeder…</p>';
  try { renderPexelsResults(await searchPexels(el('imageSearchInput').value.trim())); }
  catch (error) { el('imageSearchResults').innerHTML = `<p class="image-search-message error">${escapeHtml(error.message)}</p>`; }
  finally { button.disabled = false; button.textContent = 'Søg'; }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadData({ quiet: true }); });
window.addEventListener('pageshow', () => loadData({ quiet: true }));

async function init() {
  renderLoginState();
  await restoreSession();
  if (!state.session || (!isStaffSession() && !isViewerSession())) {
    clearSession();
    el('viewerLoginDialog').showModal();
    return;
  }
  const loaded = await loadData();
  if (!loaded) setTimeout(() => loadData({ quiet: true }), 700);
  setTimeout(() => loadData({ quiet: true }), 1500);
  refreshTimer = setInterval(() => loadData({ quiet: true }), 30000);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js');
init();
