const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
const TEAM_SLUG = location.pathname.split('/').filter(Boolean)[0] || 'trekloeveret-team-2';
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

const emptyDay = () => ({ morning: ['', ''], evening: ['', ''], night: ['', ''], breakfast: '', breakfastPhotoUrl: '', breakfastAudioUrl: '', lunch: '', lunchPhotoUrl: '', lunchAudioUrl: '', dinner: '', dinnerPhotoUrl: '', dinnerAudioUrl: '', activities: [] });
const state = {
  team: { slug: TEAM_SLUG, name: 'Team', workplace: '', subscription: { status: 'legacy', can_edit: true } },
  staff: [],
  week: Object.fromEntries(DAYS.map(day => [day.key, emptyDay()])),
  activeWeekStart: null,
  staffingDefaults: { morning: 2, evening: 2, night: 2 },
  shiftMode: 3,
  nightEnabled: true,
  meals: { breakfast: false, lunch: false, dinner: true },
  showDatesPublic: true,
  tasksEnabled: false,
  speakEnabled: false,
  residents: [],
  teamTasks: [],
  sharedOffers: [],
  session: null
};
let activeModule='board';
let taskDraftResidents=[],taskDraftTasks=[];

let selectedIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
let editingActivities = [];
let pendingDinnerPhoto = null;
let pendingMealPhotos = { breakfast: null, lunch: null, dinner: null };
let pendingMealAudio = { breakfast: null, lunch: null, dinner: null };
let refreshTimer = null;
let editingWeekStart = null;
let editingWeek = Object.fromEntries(DAYS.map(day => [day.key, emptyDay()]));
let editingShifts = { morning: [], evening: [], night: [] };
let editingWeekBaseline = '';
let editingDayIndex = 0;
let selectedPexelsPhoto = null;
let mealSearchTarget = 'dinner';
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

function sessionRole() { return state.session?.user?.user_metadata?.role || ''; }
function isStaffSession() { return sessionRole() === 'editor' && state.session?.user?.user_metadata?.team_slug === TEAM_SLUG; }
function isViewerSession() { return sessionRole() === 'viewer' && state.session?.user?.user_metadata?.team_slug === TEAM_SLUG; }
function subscriptionCanEdit() { return state.team?.subscription?.can_edit !== false; }

function daysRemaining(value) {
  return Math.max(1, Math.ceil((new Date(value) - new Date()) / 86400000));
}

function requireEditable() {
  if (subscriptionCanEdit()) return true;
  setStatus('Prøveperioden er udløbet. Tavlen kan stadig ses, men redigering er låst.', 'error');
  return false;
}

function renderSubscriptionBanner() {
  const banner = el('subscriptionBanner');
  const settingsSection = el('settingsSubscriptionSection');
  const subscription = state.team?.subscription || { status: 'legacy', can_edit: true };
  const canRequest = isStaffSession() && ['trial', 'read_only'].includes(subscription.status);
  if (!canRequest) {
    banner.hidden = true;
    settingsSection.hidden = true;
    return;
  }
  banner.hidden = false;
  settingsSection.hidden = false;
  banner.classList.toggle('expired', !subscription.can_edit);
  const requested = Boolean(subscription.subscription_interest_at);
  const bannerButton = el('requestSubscriptionButton');
  const settingsButton = el('requestSubscriptionSettingsButton');
  bannerButton.hidden = false;
  bannerButton.disabled = requested;
  bannerButton.textContent = requested ? 'Anmodning sendt ✓' : 'Aktiver';
  settingsButton.disabled = requested;
  settingsButton.textContent = requested ? 'Anmodning sendt ✓' : 'Aktiver';
  if (subscription.status === 'trial' && subscription.can_edit && requested && subscription.activation_grace_ends_at) {
    const days = daysRemaining(subscription.activation_grace_ends_at);
    el('subscriptionTitle').textContent = `Aktivering anmodet · ${days} ${days === 1 ? 'dag' : 'dage'} tilbage`;
    el('subscriptionText').textContent = 'Vi behandler jeres anmodning hurtigst muligt.';
    el('settingsSubscriptionText').textContent = 'Vi behandler jeres anmodning hurtigst muligt.';
  } else if (subscription.status === 'trial' && subscription.can_edit && subscription.trial_ends_at) {
    const days = daysRemaining(subscription.trial_ends_at);
    el('subscriptionTitle').textContent = `Gratis prøveperiode · ${days} ${days === 1 ? 'dag' : 'dage'} tilbage`;
    el('subscriptionText').textContent = 'Ønsker I at fortsætte? Vælg “Aktiver”.';
    el('settingsSubscriptionText').textContent = `I har ${days} ${days === 1 ? 'dag' : 'dage'} tilbage af prøveperioden. Ønsker I at fortsætte? Vælg “Aktiver”.`;
  } else {
    el('subscriptionTitle').textContent = 'Redigering er låst';
    el('subscriptionText').textContent = requested ? 'Aktiveringsfristen er udløbet. Techus Nord behandler jeres anmodning hurtigst muligt.' : 'Tavlen kan fortsat ses. Ønsker I at fortsætte? Vælg “Aktiver”.';
    el('settingsSubscriptionText').textContent = requested
      ? 'Aktiveringsfristen er udløbet. Vi behandler jeres anmodning hurtigst muligt.'
      : 'Prøveperioden er udløbet. Ønsker I at fortsætte? Vælg “Aktiver”.';
  }
}

function setEditorLockedState() {
  const locked = !subscriptionCanEdit();
  const allowed = new Set(['closeAdmin', 'logoutButton', 'previousEditWeek', 'nextEditWeek', 'adminDaySelect', 'requestSubscriptionButton', 'openSettingsButton']);
  el('adminDialog').querySelectorAll('input, textarea, select, button').forEach(control => {
    if (!allowed.has(control.id)) control.disabled = locked;
  });
  el('adminDialog').classList.toggle('editor-locked', locked);
}

function setSettingsLockedState() {
  const locked = !subscriptionCanEdit();
  const allowed = new Set(['closeSettingsButton', 'requestSubscriptionSettingsButton']);
  el('settingsDialog').querySelectorAll('input, textarea, select, button').forEach(control => {
    if (!allowed.has(control.id)) control.disabled = locked;
  });
}

function activeShiftTypes() {
  if (state.shiftMode === 2) return ['morning'];
  if (state.shiftMode === 1) return state.nightEnabled ? ['morning', 'night'] : ['morning'];
  return state.nightEnabled ? ['morning', 'evening', 'night'] : ['morning', 'evening'];
}

function shiftLabel(type) {
  if (type === 'morning' && state.shiftMode === 1) return 'Heldagsvagt';
  if (type === 'morning' && state.shiftMode === 2) return 'Døgnvagt';
  return { morning: 'Morgen', evening: 'Aften', night: 'Nat' }[type];
}

const FIXED_AUDIO = {
  monday: '/assets/audio/mandag.mp3', tuesday: '/assets/audio/tirsdag.mp3', wednesday: '/assets/audio/onsdag.mp3',
  thursday: '/assets/audio/torsdag.mp3', friday: '/assets/audio/fredag.mp3', saturday: '/assets/audio/loerdag.mp3', sunday: '/assets/audio/soendag.mp3',
  morning: '/assets/audio/morgenvagt.mp3', evening: '/assets/audio/aftenvagt.mp3', night: '/assets/audio/nattevagt.mp3',
  allday: '/assets/audio/heldagsvagt.mp3', overnight: '/assets/audio/doegnvagt.mp3',
  breakfast: '/assets/audio/morgenmad.mp3', lunch: '/assets/audio/frokost.mp3', dinner: '/assets/audio/aftensmad.mp3', activity: '/assets/audio/aktivitet.mp3'
};

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

function teamSettingsPayload(overrides = {}) {
  return {
    id: TEAM_SLUG,
    team_slug: TEAM_SLUG,
    active_week_start: state.activeWeekStart || currentCalendarWeekStart(),
    morning_staff_count: state.staffingDefaults.morning,
    evening_staff_count: state.staffingDefaults.evening,
    night_staff_count: state.staffingDefaults.night,
    show_dates_public: state.showDatesPublic,
    shift_mode: state.shiftMode,
    night_enabled: state.nightEnabled,
    show_breakfast: state.meals.breakfast,
    show_lunch: state.meals.lunch,
    tasks_enabled: state.tasksEnabled,
    speak_enabled: state.speakEnabled,
    task_rotation_start: state.taskRotationStart || currentCalendarWeekStart(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

async function upsertTeamSettings(overrides = {}, returnColumns = '') {
  const select = returnColumns ? `&select=${encodeURIComponent(returnColumns)}` : '';
  return apiFetch(`/rest/v1/team_settings?on_conflict=team_slug${select}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: `resolution=merge-duplicates,return=${returnColumns ? 'representation' : 'minimal'}`
    },
    body: JSON.stringify(teamSettingsPayload(overrides))
  }, true);
}

function saveSession(session, rememberViewer = false) {
  state.session = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (rememberViewer || session?.user?.user_metadata?.role === 'viewer') sessionStorage.setItem(VIEWER_SESSION_KEY, JSON.stringify(session));
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
    if (session) saveSession(session, session.user?.user_metadata?.role === 'viewer');
  } catch {
    clearSession();
  }
}

async function signInViewer(password) {
  const response=await fetch('/api/team-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:TEAM_SLUG,action:'viewer-login',password})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Forkert tavlekode.');
  saveSession(data,true);
}

async function signIn(password) {
  const response=await fetch('/api/team-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:TEAM_SLUG,action:'login',password})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Forkert personalekode.');
  saveSession(data);
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
  const markers = [
    '/storage/v1/object/public/visuplan-images/',
    '/storage/v1/object/sign/visuplan-images/',
    '/storage/v1/object/authenticated/visuplan-images/'
  ];
  const marker = markers.find(item => url.includes(item));
  const path = marker ? url.split(marker)[1].split('?')[0] : '';
  if (!path) return url;
  const cached = signedImageCache.get(path);
  if (cached?.expiresAt > Date.now()) return cached.url;
  try {
    const result = await apiFetch(`/storage/v1/object/sign/visuplan-images/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 })
    }, true);
    const raw = result?.signedURL || result?.signedUrl || result?.signed_url || '';
    let signed = '';
    if (/^https?:\/\//i.test(raw)) signed = raw;
    else if (raw.startsWith('/storage/v1/')) signed = `${SUPABASE_URL}${raw}`;
    else if (raw.startsWith('/object/')) signed = `${SUPABASE_URL}/storage/v1${raw}`;
    else if (raw) signed = `${SUPABASE_URL}/storage/v1/object/sign/visuplan-images/${path}?token=${encodeURIComponent(raw)}`;
    if (!signed && result?.token) signed = `${SUPABASE_URL}/storage/v1/object/sign/visuplan-images/${path}?token=${encodeURIComponent(result.token)}`;
    if (!signed) throw new Error('Supabase returnerede ikke et billedlink.');
    signedImageCache.set(path, { url: signed, expiresAt: Date.now() + 50 * 60 * 1000 });
    return signed;
  } catch (error) {
    console.error('Kunne ikke oprette privat billedlink', error);
    return '';
  }
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
    apiFetch(`/rest/v1/day_plans?select=*&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&plan_date=in.${dateFilter}`, {}, true),
    apiFetch(`/rest/v1/shifts?select=*&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&plan_date=in.${dateFilter}`, {}, true),
    apiFetch(`/rest/v1/activities?select=*&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&plan_date=in.${dateFilter}&order=activity_time.asc,sort_order.asc`, {}, true)
  ]);
  const securePlans = await Promise.all((plans || []).map(async item => ({ ...item,
    breakfast_photo_url: await resolvePhotoUrl(item.breakfast_photo_url || ''),
    lunch_photo_url: await resolvePhotoUrl(item.lunch_photo_url || ''),
    dinner_photo_url: await resolvePhotoUrl(item.dinner_photo_url || ''),
    breakfast_audio_url: await resolvePhotoUrl(item.breakfast_audio_url || ''),
    lunch_audio_url: await resolvePhotoUrl(item.lunch_audio_url || ''),
    dinner_audio_url: await resolvePhotoUrl(item.dinner_audio_url || '')
  })));
  const secureActivities = await Promise.all((activities || []).map(async item => ({ ...item, photo_url: await resolvePhotoUrl(item.photo_url || ''), audio_url: await resolvePhotoUrl(item.audio_url || '') })));
  const week = Object.fromEntries(DAYS.map(day => [day.key, emptyDay()]));
  const staffById = new Map(state.staff.map(person => [person.id, person]));

  dates.forEach((date, index) => {
      const data = week[DAYS[index].key];
      const plan = securePlans.find(item => item.plan_date === date);
      if (plan) {
        data.breakfast = plan.breakfast_name || '';
        data.breakfastPhotoUrl = plan.breakfast_photo_url || '';
        data.lunch = plan.lunch_name || '';
        data.lunchPhotoUrl = plan.lunch_photo_url || '';
        data.dinner = plan.dinner_name || '';
        data.dinnerPhotoUrl = plan.dinner_photo_url || '';
        data.breakfastAudioUrl = plan.breakfast_audio_url || '';
        data.lunchAudioUrl = plan.lunch_audio_url || '';
        data.dinnerAudioUrl = plan.dinner_audio_url || '';
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
        photoUrl: item.photo_url || '',
        audioUrl: item.audio_url || ''
      }));
  });
  return week;
}

async function loadSharedOffers(weekStart) {
  const links = await apiFetch(`/rest/v1/shared_offer_team_links?team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&select=offer_id,team_slug,visible_on_team`, {}, true) || [];
  if (!links.length) { state.sharedOffers = []; return; }
  const ids = links.map(link => link.offer_id);
  const idFilter = `(${ids.join(',')})`;
  const dates = weekDates(weekStart);
  const dateFilter = `(${dates.join(',')})`;
  const [offers, dayRows, activityRows] = await Promise.all([
    apiFetch(`/rest/v1/shared_offers?id=in.${idFilter}&archived_at=is.null&select=id,name,slug,own_board_enabled`, {}, true),
    apiFetch(`/rest/v1/shared_offer_days?offer_id=in.${idFilter}&plan_date=in.${dateFilter}&select=*`, {}, true),
    apiFetch(`/rest/v1/shared_offer_activities?offer_id=in.${idFilter}&plan_date=in.${dateFilter}&select=*&order=activity_time.asc,sort_order.asc`, {}, true)
  ]);
  const secureDays = await Promise.all((dayRows || []).map(async row => ({ ...row, meal_photo_url: await resolvePhotoUrl(row.meal_photo_url || '') })));
  state.sharedOffers = (offers || []).map(offer => ({
    ...offer,
    link: links.find(link => link.offer_id === offer.id),
    days: Object.fromEntries(dates.map(date => [date, {
      ...(secureDays.find(row => row.offer_id === offer.id && row.plan_date === date) || {}),
      activities: (activityRows || []).filter(row => row.offer_id === offer.id && row.plan_date === date)
    }]))
  }));
}

async function loadData({ quiet = false } = {}) {
  if (!quiet) setStatus('Henter ugeplan…');
  try {
    const [staff, settings, residents, teamTasks, teamStatus] = await Promise.all([
      apiFetch(`/rest/v1/staff?select=*&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&order=sort_order.asc,name.asc`, {}, true),
      apiFetch(`/rest/v1/team_settings?select=active_week_start,morning_staff_count,evening_staff_count,night_staff_count,show_dates_public,shift_mode,night_enabled,show_breakfast,show_lunch,tasks_enabled,speak_enabled,task_rotation_start&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}`, {}, true),
      apiFetch(`/rest/v1/team_residents?select=*&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&active=eq.true&order=sort_order.asc`,{},true),
      apiFetch(`/rest/v1/team_tasks?select=*&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&active=eq.true&order=sort_order.asc`,{},true),
      fetch(`/api/team-login?slug=${encodeURIComponent(TEAM_SLUG)}`).then(async response => response.ok ? response.json() : null).catch(() => null)
    ]);
    if (teamStatus?.subscription) {
      state.team = { ...state.team, ...teamStatus };
      if (el('adminDialog').open || el('settingsDialog').open) {
        renderSubscriptionBanner();
        setEditorLockedState();
        setSettingsLockedState();
      }
    }
    state.staff = await Promise.all((staff || []).map(async person => ({ ...person, photo_url: await resolvePhotoUrl(person.photo_url || ''), audio_url: await resolvePhotoUrl(person.audio_url || '') })));
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
    state.shiftMode = [1,2,3].includes(Number(settings?.[0]?.shift_mode)) ? Number(settings[0].shift_mode) : 3;
    state.nightEnabled = settings?.[0]?.night_enabled ?? true;
    state.meals = { breakfast: settings?.[0]?.show_breakfast ?? false, lunch: settings?.[0]?.show_lunch ?? false, dinner: true };
    state.tasksEnabled=settings?.[0]?.tasks_enabled??false;
    state.speakEnabled=settings?.[0]?.speak_enabled??false;
    state.taskRotationStart=settings?.[0]?.task_rotation_start||currentCalendarWeekStart();
    state.residents=residents||[];state.teamTasks=teamTasks||[];
    if (state.activeWeekStart !== currentCalendarWeekStart()) selectedIndex = 0;
    state.week = await fetchWeek(state.activeWeekStart);
    await loadSharedOffers(state.activeWeekStart);
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
  // Et almindeligt fixed-element ligger bag et åbent <dialog>, fordi dialogen
  // vises i browserens top layer. Flyt derfor beskeden ind i den øverste åbne
  // dialog, så fejl og bekræftelser altid kan ses dér, hvor brugeren arbejder.
  const openDialogs = [...document.querySelectorAll('dialog[open]')];
  const statusHost = openDialogs.at(-1) || document.body;
  if (target.parentElement !== statusHost) statusHost.appendChild(target);
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
      return `<div class="person ${person?.photo_url ? 'has-photo' : ''}" ${imageAttributes}>${person?.photo_url ? `<img src="${escapeHtml(person.photo_url)}" alt="">` : '<span class="avatar-placeholder">👤</span>'}<span>${escapeHtml(name)}</span>${state.speakEnabled&&person?.audio_url?`<button class="speak-button person-speak" data-audio-url="${escapeHtml(person.audio_url)}" type="button" aria-label="Læs ${escapeHtml(name)} op">👂</button>`:''}</div>`;
  }).join('') : '<p class="empty">Ikke udfyldt</p>';
}

function render() {
  const day = DAYS[selectedIndex];
  const data = currentDayData();
  document.documentElement.style.setProperty('--day-color', day.color);
  el('dayLabel').textContent = day.name;
  el('dateLabel').textContent = formatDate(dateForIndex(selectedIndex, state.activeWeekStart));
  el('speakBrand').hidden=!state.speakEnabled;el('speakDayButton').hidden=!state.speakEnabled;
  document.querySelectorAll('.shift-speak').forEach(button=>button.hidden=!state.speakEnabled);
  el('moduleTabs').hidden=!state.tasksEnabled;
  ['morning','evening','night'].forEach(type => {
    const active = activeShiftTypes().includes(type);
    el(`${type}Panel`).hidden = !active;
    el(`${type}Panel`).querySelector('h3').textContent = `${{morning:'☀️',evening:'🌙',night:'🌑'}[type]} ${shiftLabel(type)}`;
    if (active) renderPeople(`${type}Staff`, data[type]);
  });
  ['breakfast','lunch','dinner'].forEach(type => {
    const visible = state.meals[type];
    el(`${type}Panel`).hidden = !visible;
    if (!visible) return;
    el(`${type}Text`).textContent = data[type] || 'Ikke udfyldt';
    const heading=el(`${type}Panel`).querySelector('h3');
    heading.classList.toggle('speak-heading',state.speakEnabled);
    heading.innerHTML=`<span>${{breakfast:'🥐 Morgenmad',lunch:'🥪 Frokost',dinner:'🍽️ Aftensmad'}[type]}</span>${state.speakEnabled?`<button class="speak-button inline-speak" data-fixed-audio="${type}" type="button" aria-label="Afspil ${type}">👂</button>`:''}`;
    const photo = data[`${type}PhotoUrl`];
    const label = {breakfast:'morgenmaden',lunch:'frokosten',dinner:'aftensmaden'}[type];
    el(`${type}Photo`).innerHTML = photo ? `<button class="image-button" data-enlarge-image="${escapeHtml(photo)}" data-image-caption="${escapeHtml(data[type] || label)}" aria-label="Vis stort billede af ${label}"><img src="${escapeHtml(photo)}" alt="${escapeHtml(data[type] || label)}"></button>` : '';
    const text=el(`${type}Text`);const existing=text.parentElement.querySelector('.meal-name-speak');if(existing)existing.remove();
    if(state.speakEnabled&&data[`${type}AudioUrl`]) text.insertAdjacentHTML('afterend',`<button class="speak-button meal-name-speak" data-audio-url="${escapeHtml(data[`${type}AudioUrl`])}" type="button" aria-label="Afspil ${escapeHtml(data[type]||label)}">👂</button>`);
  });
  const activityHeading=el('activitiesList').closest('.activities-panel').querySelector('h3');
  activityHeading.classList.toggle('speak-heading',state.speakEnabled);activityHeading.innerHTML=`<span>🎯 Aktiviteter</span>${state.speakEnabled?'<button class="speak-button inline-speak" data-fixed-audio="activity" type="button" aria-label="Afspil aktivitet">👂</button>':''}`;
  el('activitiesList').innerHTML = data.activities.length ? data.activities.map(activity => `<div class="activity">
    ${activity.photoUrl ? `<button class="activity-photo image-button" data-enlarge-image="${escapeHtml(activity.photoUrl)}" data-image-caption="${escapeHtml(activity.name)}" aria-label="Vis stort billede af ${escapeHtml(activity.name)}"><img src="${escapeHtml(activity.photoUrl)}" alt=""></button>` : ''}
    <div class="activity-time">${escapeHtml(activity.time)}</div><div class="activity-name">${escapeHtml(activity.name)}</div>${state.speakEnabled&&activity.audioUrl?`<button class="speak-button inline-speak" data-audio-url="${escapeHtml(activity.audioUrl)}" type="button" aria-label="Afspil ${escapeHtml(activity.name)}">👂</button>`:''}
  </div>`).join('') : '<p class="empty">Ingen aktiviteter</p>';
  renderSharedOffers();
  renderTabs();
  renderTaskAssignments();
  bindSpeakButtons();
  bindImageEnlargement();
}

function renderSharedOffers() {
  const section = el('sharedOffersSection');
  const visible = state.sharedOffers.filter(offer => offer.link?.visible_on_team);
  section.hidden = !visible.length;
  if (!visible.length) { el('sharedOffersList').innerHTML = ''; return; }
  const date = isoDate(dateForIndex(selectedIndex, state.activeWeekStart));
  el('sharedOffersList').innerHTML = visible.map(offer => {
    const data = offer.days?.[date] || { activities: [] };
    const items = data.activities || [];
    return `<article class="shared-offer-panel"><div class="shared-offer-name"><h3>${escapeHtml(offer.name)}</h3>${offer.own_board_enabled ? `<a href="/tilbud/${escapeHtml(offer.slug)}">Åbn tilbuddets egen tavle</a>` : ''}</div><div class="shared-offer-content"><section><h4>🍽️ Mad</h4>${data.meal_photo_url ? `<button class="shared-offer-photo image-button" data-enlarge-image="${escapeHtml(data.meal_photo_url)}" data-image-caption="${escapeHtml(data.meal_name || 'Mad i klubben')}"><img src="${escapeHtml(data.meal_photo_url)}" alt=""></button>` : ''}<strong>${escapeHtml(data.meal_name || 'Ikke udfyldt')}</strong></section><section><h4>🎯 Aktiviteter</h4>${items.length ? items.map(item => `<div class="shared-offer-activity"><time>${escapeHtml((item.activity_time || '').slice(0,5))}</time><span>${escapeHtml(item.name)}</span></div>`).join('') : '<p class="empty">Ingen aktiviteter</p>'}</section></div>${data.message ? `<p class="shared-offer-message">💬 ${escapeHtml(data.message)}</p>` : ''}</article>`;
  }).join('');
}

function weeksSince(start,end){
  if(!start||!end)return 0;
  return Math.max(0,Math.floor((dateFromIso(end)-dateFromIso(start))/(7*86400000)));
}
function renderTaskAssignments(){if(!state.tasksEnabled)return;el('tasksWeekLabel').textContent=formatWeekRange(state.activeWeekStart);const offset=weeksSince(state.taskRotationStart,state.activeWeekStart);el('taskAssignments').innerHTML=state.residents.length&&state.teamTasks.length?state.residents.map((resident,index)=>{const task=state.teamTasks[(index+offset)%state.teamTasks.length];return `<article class="task-assignment"><span class="task-person">${escapeHtml(resident.name)}</span><span class="task-arrow">→</span><strong>${escapeHtml(task?.name||'Ingen opgave')}</strong></article>`}).join(''):'<p class="empty">Ugeopgaverne er ikke udfyldt endnu.</p>'}
function showModule(module){activeModule=module;el('boardView').hidden=module!=='board';el('dayTabs').hidden=module!=='board';el('tasksView').hidden=module!=='tasks';el('boardTab').classList.toggle('active',module==='board');el('tasksTab').classList.toggle('active',module==='tasks')}
function playAudio(url){if(!url)return;const audio=new Audio(url);audio.play().catch(()=>setStatus('Lyden kunne ikke afspilles.','error'))}
function shiftAudioKey(type){if(type==='morning'&&state.shiftMode===1)return'allday';if(type==='morning'&&state.shiftMode===2)return'overnight';return type}
function bindSpeakButtons(){el('speakDayButton').onclick=()=>playAudio(FIXED_AUDIO[DAYS[selectedIndex].key]);document.querySelectorAll('[data-speak-shift]').forEach(button=>button.onclick=()=>playAudio(FIXED_AUDIO[shiftAudioKey(button.dataset.speakShift)]));document.querySelectorAll('[data-fixed-audio]').forEach(button=>button.onclick=event=>{event.stopPropagation();playAudio(FIXED_AUDIO[button.dataset.fixedAudio])});document.querySelectorAll('[data-audio-url]').forEach(button=>button.onclick=event=>{event.stopPropagation();playAudio(button.dataset.audioUrl)})}

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
  const nextWeek = await fetchWeek(weekStart);
  editingWeekStart = weekStart;
  editingWeek = nextWeek;
  el('adminWeekLabel').textContent = formatWeekRange(editingWeekStart);
  el('adminDaySelect').innerHTML = DAYS.map((day, index) => `<option value="${index}" ${index === preferredDay ? 'selected' : ''}>${day.name} ${formatDate(dateForIndex(index, editingWeekStart))}</option>`).join('');
  loadAdminDay();
  markWeekEditorClean();
  setStatus('Ugen er hentet', 'success');
}

async function openAdmin() {
  const start = defaultEditingWeekStart();
  const preferredDay = start === state.activeWeekStart ? selectedIndex : 0;
  renderStaffManager();
  el('adminDialog').showModal();
  renderSubscriptionBanner();
  setEditorLockedState();
  try {
    await setEditingWeek(start, preferredDay);
  } catch (error) {
    console.error(error);
    setStatus('Ugen kunne ikke hentes.', 'error');
  }
}

function loadAdminDay() {
  const index = Number(el('adminDaySelect').value || selectedIndex);
  editingDayIndex = index;
  const data = editingWeek[DAYS[index].key];
  editingShifts = {};
  ['morning', 'evening', 'night'].forEach(type => {
    editingShifts[type] = (data[type] || []).filter(Boolean);
    while (editingShifts[type].length < state.staffingDefaults[type]) editingShifts[type].push('');
  });
  renderShiftEditors();
  ['breakfast','lunch','dinner'].forEach(type => {
    el(`${type}EditorSection`).hidden = !state.meals[type];
    el(`${type}Input`).value = data[type] || '';
    el(`${type}PhotoInput`).value = '';
    const pendingPhoto = data._pendingMealPhotos?.[type] || null;
    el(`${type}PhotoName`).textContent = pendingPhoto ? (pendingPhoto.name || 'Nyt billede valgt ✓') : data[`${type}PhotoUrl`] ? 'Der er allerede et billede. Vælg et nyt for at udskifte det.' : 'Intet billede valgt.';
    pendingMealPhotos[type] = pendingPhoto;
    pendingMealAudio[type] = data._pendingMealAudio?.[type]
      ? { ...data._pendingMealAudio[type] }
      : { url: data[`${type}AudioUrl`] || '', blob: null, blobUrl: '', deleted: false };
  });
  pendingDinnerPhoto = pendingMealPhotos.dinner;
  selectedPexelsPhoto = null;
  editingActivities = (data.activities || []).map(activity => ({ ...activity }));
  renderActivityEditor();
  renderMealAudioControls();
}

function draftFileFingerprint(file) {
  if (!file) return '';
  return [file.name || '', file.size || 0, file.type || '', file.lastModified || 0].join('|');
}

function captureAdminDay() {
  if (!editingWeekStart || !editingWeek?.[DAYS[editingDayIndex]?.key]) return;
  const data = editingWeek[DAYS[editingDayIndex].key];
  ['morning', 'evening', 'night'].forEach(type => { data[type] = [...(editingShifts[type] || [])]; });
  ['breakfast', 'lunch', 'dinner'].forEach(type => { data[type] = el(`${type}Input`)?.value || ''; });
  data._pendingMealPhotos = { ...pendingMealPhotos, dinner: pendingMealPhotos.dinner || pendingDinnerPhoto || null };
  data._pendingMealAudio = Object.fromEntries(['breakfast', 'lunch', 'dinner'].map(type => [type, { ...(pendingMealAudio[type] || {}) }]));
  data.activities = editingActivities.map(activity => ({ ...activity }));
}

function draftDayState(data) {
  const meals = Object.fromEntries(['breakfast', 'lunch', 'dinner'].map(type => {
    const audio = data._pendingMealAudio?.[type] || { url: data[`${type}AudioUrl`] || '' };
    const photo = data._pendingMealPhotos?.[type] || null;
    return [type, {
      name: data[type] || '',
      photoUrl: data[`${type}PhotoUrl`] || '',
      photo: draftFileFingerprint(photo),
      audioUrl: audio.url || '',
      audio: draftFileFingerprint(audio.blob),
      audioDeleted: Boolean(audio.deleted)
    }];
  }));
  const activities = (data.activities || []).map(activity => ({
    id: activity.id || '',
    time: activity.time || '',
    name: activity.name || '',
    photoUrl: activity.photoUrl || '',
    photo: draftFileFingerprint(activity.photoFile),
    audioUrl: activity.audioUrl || '',
    audio: draftFileFingerprint(activity.audioBlob),
    audioDeleted: Boolean(activity.audioDeleted)
  }));
  return {
    shifts: Object.fromEntries(['morning', 'evening', 'night'].map(type => [type, [...(data[type] || [])]])),
    meals,
    activities
  };
}

function weekEditorState() {
  return Object.fromEntries(DAYS.map(day => [day.key, draftDayState(editingWeek[day.key])]));
}

function markWeekEditorClean() {
  captureAdminDay();
  editingWeekBaseline = JSON.stringify(weekEditorState());
}

function hasUnsavedWeekChanges() {
  if (!el('adminDialog')?.open || !editingWeekBaseline) return false;
  captureAdminDay();
  return JSON.stringify(weekEditorState()) !== editingWeekBaseline;
}

function confirmDiscardWeekChanges(action = 'lukke redigeringen') {
  if (!hasUnsavedWeekChanges()) return true;
  return confirm(`Dine ændringer til ugeplanen er ikke gemt.\n\nVil du ${action} uden at gemme?`);
}

function closeAdminWithCheck() {
  if (!confirmDiscardWeekChanges()) return;
  editingWeekBaseline = '';
  el('adminDialog').close();
}

async function changeEditingWeek(days) {
  if (!confirmDiscardWeekChanges('skifte uge')) return;
  try {
    await setEditingWeek(addDaysIso(editingWeekStart, days), 0);
  } catch (error) {
    console.error(error);
    setStatus('Ugen kunne ikke hentes.', 'error');
  }
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
      const selectedFile = new File([blob], `pexels-${photo.id}.jpg`, { type: blob.type || 'image/jpeg' });
      pendingMealPhotos[mealSearchTarget] = selectedFile;
      if(mealSearchTarget==='dinner') pendingDinnerPhoto=selectedFile;
      el(`${mealSearchTarget}PhotoInput`).value = '';
      el(`${mealSearchTarget}PhotoName`).textContent = `Billede valgt fra Pexels · Foto: ${photo.photographer}`;
      el('imageSearchDialog').close();
      setStatus('Billedet er valgt – husk Gem ændringer', 'success');
    } catch (error) {
      console.error(error);
      setStatus('Billedet kunne ikke hentes. Prøv et andet.', 'error');
      button.disabled = false;
    }
  }));
}

function renderShiftEditors() {
  const labels = { morning: shiftLabel('morning'), evening: shiftLabel('evening'), night: shiftLabel('night') };
  ['morning', 'evening', 'night'].forEach(type => {
    const active = activeShiftTypes().includes(type);
    el(`${type}EditorGroup`).hidden = !active;
    el(`${type}EditorGroup`).querySelector('h4').textContent = `${{morning:'☀️',evening:'🌙',night:'🌑'}[type]} ${labels[type]}`;
    if (!active) return;
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
    ${state.speakEnabled?audioEditorControls('activity',index,activity.audioBlobUrl||activity.audioUrl):''}
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
  bindAudioEditorControls();
}

function audioEditorControls(kind,id,url){return `<div class="audio-edit-controls">${url?`<button class="play-audio-button" type="button" data-play-edit-audio="${escapeHtml(url)}">▶ Afspil</button><button class="record-audio-button" type="button" data-record-kind="${kind}" data-record-id="${id}">🎙️ Indtal igen</button><button class="delete-audio-button" type="button" data-delete-audio-kind="${kind}" data-delete-audio-id="${id}">🗑️ Slet</button>`:`<button class="record-audio-button" type="button" data-record-kind="${kind}" data-record-id="${id}">🎙️ Indtal</button>`}</div>`}
function renderMealAudioControls(){['breakfast','lunch','dinner'].forEach(type=>{const section=el(`${type}EditorSection`);section.querySelector('.audio-edit-controls')?.remove();if(!state.speakEnabled)return;const draft=pendingMealAudio[type];section.insertAdjacentHTML('beforeend',audioEditorControls('meal',type,draft?.blobUrl||draft?.url||''))});bindAudioEditorControls()}
function bindAudioEditorControls(){document.querySelectorAll('[data-play-edit-audio]').forEach(button=>button.onclick=()=>playAudio(button.dataset.playEditAudio));document.querySelectorAll('[data-record-kind]').forEach(button=>button.onclick=()=>startRecording(button.dataset.recordKind,button.dataset.recordId));document.querySelectorAll('[data-delete-audio-kind]').forEach(button=>button.onclick=()=>deleteDraftAudio(button.dataset.deleteAudioKind,button.dataset.deleteAudioId))}

let activeRecorder=null;
async function captureAudio(title){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Denne browser kan ikke optage lyd.');
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  const dialog=el('recordingDialog'),countdown=el('recordingCountdown'),hint=el('recordingHint');
  const stopStream=()=>stream.getTracks().forEach(track=>track.stop());
  el('recordingTitle').textContent=title;
  hint.textContent='Optagelsen starter efter nedtællingen.';
  dialog.showModal();
  let cancelled=false;
  el('cancelRecordingButton').onclick=()=>{
    cancelled=true;
    if(activeRecorder?.state==='recording')activeRecorder.stop();
    else{stopStream();dialog.close()}
  };
  for(const number of [3,2,1]){
    if(cancelled)throw new Error('Optagelsen blev annulleret.');
    countdown.className='recording-countdown';
    countdown.textContent=number;
    await new Promise(resolve=>setTimeout(resolve,700));
  }
  if(cancelled)throw new Error('Optagelsen blev annulleret.');
  const chunks=[],recorder=new MediaRecorder(stream);
  activeRecorder=recorder;
  countdown.className='recording-countdown is-recording';
  countdown.textContent='● Optager';
  hint.textContent='Indtal nu. Optagelsen stopper automatisk.';
  return new Promise((resolve,reject)=>{
    let stopTimer;
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
    recorder.onerror=()=>{clearTimeout(stopTimer);stopStream();activeRecorder=null;dialog.close();reject(new Error('Optagelsen mislykkedes.'))};
    recorder.onstop=()=>{
      clearTimeout(stopTimer);stopStream();activeRecorder=null;dialog.close();
      if(cancelled)return reject(new Error('Optagelsen blev annulleret.'));
      if(!chunks.length)return reject(new Error('Der blev ikke optaget nogen lyd. Prøv igen.'));
      resolve(new Blob(chunks,{type:recorder.mimeType||'audio/webm'}));
    };
    recorder.start();
    stopTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},3200);
  });
}
async function startRecording(kind,id){try{const label=kind==='staff'?'medarbejderens navn':kind==='meal'?'navnet på retten':'aktiviteten';const blob=await captureAudio(`Indtal ${label}`),blobUrl=URL.createObjectURL(blob);if(kind==='meal'){pendingMealAudio[id]={...(pendingMealAudio[id]||{}),blob,blobUrl,deleted:false};renderMealAudioControls()}else if(kind==='activity'){const item=editingActivities[Number(id)];item.audioBlob=blob;item.audioBlobUrl=blobUrl;item.audioDeleted=false;renderActivityEditor()}else await saveStaffAudio(id,blob);setStatus('Optagelsen er klar – prøv den gerne af','success')}catch(error){if(!error.message.includes('annulleret'))setStatus(error.message,'error')}}
function deleteDraftAudio(kind,id){if(!confirm('Vil du slette optagelsen?'))return;if(kind==='meal'){const draft=pendingMealAudio[id]||{};if(draft.blobUrl)URL.revokeObjectURL(draft.blobUrl);pendingMealAudio[id]={url:'',blob:null,blobUrl:'',deleted:true};renderMealAudioControls()}else if(kind==='activity'){const item=editingActivities[Number(id)];if(item.audioBlobUrl)URL.revokeObjectURL(item.audioBlobUrl);item.audioUrl='';item.audioBlob=null;item.audioBlobUrl='';item.audioDeleted=true;renderActivityEditor()}else deleteStaffAudio(id)}

function renderStaffManager() {
  el('staffManager').innerHTML = state.staff.filter(person => person.active).map(person => `<div class="staff-manage-row">
    ${person.photo_url ? `<img src="${escapeHtml(person.photo_url)}" alt="">` : '<span class="avatar-placeholder">👤</span>'}
    <strong>${escapeHtml(person.name)}</strong>
    <label class="upload-button">${person.photo_url ? 'Skift billede' : 'Tilføj billede'}<input type="file" accept="image/jpeg,image/png,image/webp" data-staff-photo="${person.id}"></label>
    ${state.speakEnabled?`${person.audio_url?`<button class="play-name-button" type="button" data-audio-url="${escapeHtml(person.audio_url)}">▶ Afspil</button>`:''}<button class="record-name-button" type="button" data-record-name="${person.id}">${person.audio_url?'🎙️ Indtal igen':'🎙️ Indtal navn'}</button>${person.audio_url?`<button class="delete-audio-button" type="button" data-delete-staff-audio="${person.id}">🗑️ Slet</button>`:''}`:''}
    <button class="edit-staff-button" type="button" data-edit-staff="${person.id}" data-staff-name="${escapeHtml(person.name)}">Rediger navn</button>
    <button class="remove-staff-button" type="button" data-deactivate-staff="${person.id}" data-staff-name="${escapeHtml(person.name)}">Fjern</button>
  </div>`).join('');
  document.querySelectorAll('[data-staff-photo]').forEach(input => input.addEventListener('change', async () => {
    if (!input.files?.[0]) return;
    await uploadStaffPhoto(input.dataset.staffPhoto, input.files[0]);
  }));
  document.querySelectorAll('[data-edit-staff]').forEach(button => button.addEventListener('click', () => renameStaff(button.dataset.editStaff, button.dataset.staffName)));
  document.querySelectorAll('[data-deactivate-staff]').forEach(button => button.addEventListener('click', () => deactivateStaff(button.dataset.deactivateStaff, button.dataset.staffName)));
  document.querySelectorAll('[data-record-name]').forEach(button=>button.addEventListener('click',()=>startRecording('staff',button.dataset.recordName)));
  document.querySelectorAll('[data-delete-staff-audio]').forEach(button=>button.addEventListener('click',()=>deleteDraftAudio('staff',button.dataset.deleteStaffAudio)));
  document.querySelectorAll('.play-name-button').forEach(button=>button.addEventListener('click',()=>new Audio(button.dataset.audioUrl).play()));
}

function normalizedAudioType(blob){const type=(blob?.type||'audio/webm').toLowerCase();if(type.includes('ogg'))return 'audio/ogg';if(type.includes('mp4')||type.includes('m4a'))return 'audio/mp4';if(type.includes('mpeg')||type.includes('mp3'))return 'audio/mpeg';return 'audio/webm'}
async function uploadAudio(blob,path){const mimeType=normalizedAudioType(blob);const ext=mimeType==='audio/ogg'?'ogg':mimeType==='audio/mp4'?'m4a':mimeType==='audio/mpeg'?'mp3':'webm';const fullPath=`${path}.${ext}`;await apiFetch(`/storage/v1/object/visuplan-images/${fullPath}`,{method:'POST',headers:{'Content-Type':mimeType,'x-upsert':'true'},body:blob},true);return `${SUPABASE_URL}/storage/v1/object/public/visuplan-images/${fullPath}`}
async function saveStaffAudio(staffId,blob){const audioUrl=await uploadAudio(blob,`${TEAM_SLUG}/audio/staff/${staffId}-${Date.now()}`);await apiFetch(`/rest/v1/staff?id=eq.${encodeURIComponent(staffId)}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({audio_url:audioUrl})},true);await loadData({quiet:true});renderStaffManager()}
async function deleteStaffAudio(staffId){await apiFetch(`/rest/v1/staff?id=eq.${encodeURIComponent(staffId)}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({audio_url:null})},true);await loadData({quiet:true});renderStaffManager();setStatus('Optagelsen er slettet','success')}

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
    markWeekEditorClean();
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
    markWeekEditorClean();
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
    const photoUrl = await uploadImage(file, `${TEAM_SLUG}/staff/${staffId}-${Date.now()}.jpg`);
    await apiFetch(`/rest/v1/staff?id=eq.${encodeURIComponent(staffId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ photo_url: photoUrl })
    }, true);
    await loadData({ quiet: true });
    editingWeek = await fetchWeek(editingWeekStart);
    renderStaffManager();
    loadAdminDay();
    markWeekEditorClean();
    setStatus('Billedet er gemt', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Billedet kunne ikke gemmes.', 'error');
  }
}

async function addStaff() {
  if (!requireEditable()) return;
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
        body: JSON.stringify({ team_slug: TEAM_SLUG, name, sort_order: state.staff.length + 1 })
      }, true);
    }
    el('newStaffName').value = '';
    await loadData({ quiet: true });
    editingWeek = await fetchWeek(editingWeekStart);
    renderStaffManager();
    loadAdminDay();
    markWeekEditorClean();
    setStatus('Medarbejderen er tilføjet', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Medarbejderen kunne ikke tilføjes.', 'error');
  }
}

async function saveEditingDay(index, draft) {
  const planDate = weekDates(editingWeekStart)[index];
  const mealValues = {};
  const savedMeals = {};
  for (const type of ['breakfast','lunch','dinner']) {
    let photoUrl = stablePhotoUrl(draft[`${type}PhotoUrl`] || '');
    const pending = draft._pendingMealPhotos?.[type] || null;
    if (pending) photoUrl = await uploadImage(pending, `${TEAM_SLUG}/meals/${type}-${planDate}-${Date.now()}.jpg`);
    const name = String(draft[type] || '').trim();
    const audioDraft = draft._pendingMealAudio?.[type] || {};
    let audioUrl = audioDraft.deleted ? '' : stablePhotoUrl(audioDraft.url || draft[`${type}AudioUrl`] || '');
    if (audioDraft.blob) audioUrl = await uploadAudio(audioDraft.blob, `${TEAM_SLUG}/audio/meals/${type}-${planDate}-${Date.now()}`);
    mealValues[`${type}_name`] = name;
    mealValues[`${type}_photo_url`] = photoUrl || null;
    mealValues[`${type}_audio_url`] = audioUrl || null;
    savedMeals[type] = { name, photoUrl, audioUrl };
  }

  await apiFetch('/rest/v1/day_plans?on_conflict=team_slug,plan_date', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ team_slug: TEAM_SLUG, plan_date: planDate, ...mealValues, updated_at: new Date().toISOString() })
  }, true);

  await apiFetch(`/rest/v1/shifts?team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&plan_date=eq.${planDate}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, true);
  const shifts = activeShiftTypes().flatMap(shiftType => (draft[shiftType] || []).map((name, slotIndex) => {
    const person = staffByName(name);
    return person ? { team_slug: TEAM_SLUG, plan_date: planDate, shift_type: shiftType, slot: slotIndex + 1, staff_id: person.id } : null;
  })).filter(Boolean);
  if (shifts.length) {
    await apiFetch('/rest/v1/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(shifts)
    }, true);
  }

  await apiFetch(`/rest/v1/activities?team_slug=eq.${encodeURIComponent(TEAM_SLUG)}&plan_date=eq.${planDate}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, true);
  const validActivities = (draft.activities || []).filter(activity => activity.name.trim());
  const savedActivities = await Promise.all(validActivities.map(async (activity, order) => {
    let photoUrl = stablePhotoUrl(activity.photoUrl || '');
    if (activity.photoFile) photoUrl = await uploadImage(activity.photoFile, `${TEAM_SLUG}/activities/${planDate}-${order}-${Date.now()}.jpg`);
    let audioUrl = activity.audioDeleted ? '' : stablePhotoUrl(activity.audioUrl || '');
    if (activity.audioBlob) audioUrl = await uploadAudio(activity.audioBlob, `${TEAM_SLUG}/audio/activities/${planDate}-${order}-${Date.now()}`);
    const name = activity.name.trim();
    return {
      api: {
        team_slug: TEAM_SLUG, plan_date: planDate,
        activity_time: activity.time || null,
        name,
        photo_url: photoUrl || null,
        audio_url: audioUrl || null,
        sort_order: order
      },
      draft: { ...activity, name, photoUrl, photoFile: null, audioUrl, audioBlob: null, audioBlobUrl: '', audioDeleted: false }
    };
  }));
  if (savedActivities.length) {
    await apiFetch('/rest/v1/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(savedActivities.map(activity => activity.api))
    }, true);
  }

  for (const type of ['breakfast','lunch','dinner']) {
    draft[type] = savedMeals[type].name;
    draft[`${type}PhotoUrl`] = savedMeals[type].photoUrl;
    draft[`${type}AudioUrl`] = savedMeals[type].audioUrl;
  }
  draft._pendingMealPhotos = { breakfast: null, lunch: null, dinner: null };
  draft._pendingMealAudio = Object.fromEntries(['breakfast','lunch','dinner'].map(type => [type, { url: savedMeals[type].audioUrl, blob: null, blobUrl: '', deleted: false }]));
  draft.activities = savedActivities.map(activity => activity.draft);
}

async function saveWeekChanges() {
  if (!requireEditable()) return;
  captureAdminDay();
  const button = el('saveDayButton');
  const baseline = JSON.parse(editingWeekBaseline || '{}');
  const current = weekEditorState();
  const changedIndexes = DAYS.map((day, index) => JSON.stringify(current[day.key]) !== JSON.stringify(baseline[day.key]) ? index : -1).filter(index => index >= 0);
  if (!changedIndexes.length) {
    setStatus('Der er ingen nye ændringer at gemme.', 'success');
    return;
  }
  button.disabled = true;
  button.textContent = 'Gemmer…';
  try {
    for (const index of changedIndexes) {
      const day = DAYS[index];
      await saveEditingDay(index, editingWeek[day.key]);
      if (index === editingDayIndex) loadAdminDay();
      baseline[day.key] = draftDayState(editingWeek[day.key]);
      editingWeekBaseline = JSON.stringify(baseline);
    }

    const selectedEditDay = editingDayIndex;
    editingWeek = await fetchWeek(editingWeekStart);
    if (editingWeekStart === state.activeWeekStart) {
      state.week = editingWeek;
      selectedIndex = selectedEditDay;
      render();
    }
    el('adminDaySelect').value = String(selectedEditDay);
    loadAdminDay();
    markWeekEditorClean();
    button.textContent = 'Gemt ✓';
    setStatus('Alle ændringer er gemt på alle enheder', 'success');
  } catch (error) {
    console.error(error);
    loadAdminDay();
    button.textContent = 'Prøv igen';
    setStatus('Nogle ændringer kunne ikke gemmes. Prøv igen.', 'error');
  } finally {
    button.disabled = false;
    setTimeout(() => { button.textContent = 'Gem ændringer'; }, 1600);
  }
}

async function publishEditingWeek() {
  if (!requireEditable()) return;
  if (hasUnsavedWeekChanges()) {
    setStatus('Gem ændringerne, før du viser ugen på tavlen.', 'error');
    return;
  }
  const confirmed = confirm('Du er ved at vise den valgte uge på tavlen. Tavlen går automatisk frem til den aktuelle kalenderuge hver mandag. Vil du fortsætte?');
  if (!confirmed) return;
  const button = el('publishWeekButton');
  button.disabled = true;
  button.textContent = 'Udgiver…';
  try {
    // Nye tavler har endnu ingen indstillingsrække. En fuld upsert opretter den
    // første gang og opdaterer kun det samme teams række fremover.
    const updatedSettings = await upsertTeamSettings(
      { active_week_start: editingWeekStart },
      'active_week_start'
    );
    if (updatedSettings?.[0]?.active_week_start !== editingWeekStart) {
      throw new Error('Teamets aktive uge blev ikke opdateret');
    }
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
  el('shiftMode').value = String(state.shiftMode);
  el('nightEnabled').checked = state.nightEnabled;
  el('showBreakfast').checked = state.meals.breakfast;
  el('showLunch').checked = state.meals.lunch;
  el('tasksEnabled').checked=state.tasksEnabled;
  el('speakEnabled').checked=state.speakEnabled;
  renderSharedOfferSettings();
  updateSettingsVisibility();
  renderSubscriptionBanner();
  setSettingsLockedState();
  el('settingsDialog').showModal();
}

function renderSharedOfferSettings() {
  const section = el('sharedOfferSettings');
  section.hidden = !state.sharedOffers.length;
  el('sharedOfferSettingsList').innerHTML = state.sharedOffers.map(offer => `<label class="toggle-setting"><input type="checkbox" data-shared-offer-toggle="${escapeHtml(offer.id)}" ${offer.link?.visible_on_team ? 'checked' : ''}><span><strong>Vis ${escapeHtml(offer.name)}</strong><small>Mad og aktiviteter vises nederst på den almindelige tavle.</small></span></label>`).join('');
}

async function requestSubscription(button) {
  button.disabled = true;
  button.textContent = 'Sender…';
  try {
    const result = await teamAccountAction('request-subscription');
    state.team.subscription.subscription_interest_at = result.requested_at || new Date().toISOString();
    state.team.subscription.activation_grace_ends_at = result.grace_ends_at || state.team.subscription.activation_grace_ends_at;
    state.team.subscription.can_edit = result.can_edit !== false;
    renderSubscriptionBanner();
    setEditorLockedState();
    setSettingsLockedState();
    setStatus('Tak. Vi behandler jeres anmodning hurtigst muligt.', 'success');
  } catch (error) {
    renderSubscriptionBanner();
    setStatus(error.message, 'error');
  }
}

function updateSettingsVisibility() {
  const mode = Number(el('shiftMode').value);
  el('eveningDefaultLabel').hidden = mode < 3;
  el('nightEnabledSetting').hidden = mode === 2;
  el('nightDefaultLabel').hidden = mode === 2 || !el('nightEnabled').checked;
  el('morningDefaultLabel').firstChild.textContent = mode === 1 ? 'Normal bemanding hele dagen' : mode === 2 ? 'Normal bemanding på døgnvagt' : 'Normal morgenbemanding';
  el('openTasksManagerButton').hidden=!el('tasksEnabled').checked;
}

async function saveSettings() {
  if (!requireEditable()) return;
  const button = el('saveSettingsButton');
  const defaults = {
    morning: Math.min(10, Math.max(1, Number(el('morningDefault').value) || 1)),
    evening: Math.min(10, Math.max(1, Number(el('eveningDefault').value) || 1)),
    night: Math.min(10, Math.max(1, Number(el('nightDefault').value) || 1))
  };
  button.disabled = true;
  button.textContent = 'Gemmer…';
  try {
    await upsertTeamSettings({
      morning_staff_count: defaults.morning,
      evening_staff_count: defaults.evening,
      night_staff_count: defaults.night,
      show_dates_public: el('showDatesPublic').checked,
      shift_mode: Number(el('shiftMode').value),
      night_enabled: el('nightEnabled').checked,
      show_breakfast: el('showBreakfast').checked,
      show_lunch: el('showLunch').checked,
      tasks_enabled:el('tasksEnabled').checked,
      speak_enabled:el('speakEnabled').checked
    });
    await Promise.all(state.sharedOffers.map(offer => {
      const toggle = document.querySelector(`[data-shared-offer-toggle="${offer.id}"]`);
      if (!toggle || toggle.checked === offer.link?.visible_on_team) return Promise.resolve();
      return apiFetch(`/rest/v1/shared_offer_team_links?offer_id=eq.${encodeURIComponent(offer.id)}&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}`, { method:'PATCH', headers:{'Content-Type':'application/json',Prefer:'return=minimal'}, body:JSON.stringify({ visible_on_team:toggle.checked, updated_at:new Date().toISOString() }) }, true).then(() => { offer.link.visible_on_team = toggle.checked; });
    }));
    state.staffingDefaults = defaults;
    state.showDatesPublic = el('showDatesPublic').checked;
    state.shiftMode = Number(el('shiftMode').value);
    state.nightEnabled = el('nightEnabled').checked;
    state.meals = { breakfast: el('showBreakfast').checked, lunch: el('showLunch').checked, dinner: true };
    state.tasksEnabled=el('tasksEnabled').checked;state.speakEnabled=el('speakEnabled').checked;
    render();
    el('settingsDialog').close();
    loadAdminDay();
    markWeekEditorClean();
    setStatus('Grundindstillingerne er gemt', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Indstillingerne kunne ikke gemmes.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Gem indstillinger';
  }
}

function openTasksManager(){taskDraftResidents=state.residents.map(item=>({...item}));taskDraftTasks=state.teamTasks.map(item=>({...item}));el('taskRotationStart').value=state.taskRotationStart||currentCalendarWeekStart();renderTasksManager();el('tasksManagerDialog').showModal()}
function renderTasksManager(){el('residentManager').innerHTML=taskDraftResidents.map((item,index)=>`<div><span>${escapeHtml(item.name)}</span><button type="button" data-remove-resident="${index}">Fjern</button></div>`).join('')||'<p class="empty">Ingen navne endnu.</p>';el('taskManager').innerHTML=taskDraftTasks.map((item,index)=>`<div><span>${escapeHtml(item.name)}</span><button type="button" data-remove-task="${index}">Fjern</button></div>`).join('')||'<p class="empty">Ingen opgaver endnu.</p>';document.querySelectorAll('[data-remove-resident]').forEach(button=>button.onclick=()=>{taskDraftResidents.splice(Number(button.dataset.removeResident),1);renderTasksManager()});document.querySelectorAll('[data-remove-task]').forEach(button=>button.onclick=()=>{taskDraftTasks.splice(Number(button.dataset.removeTask),1);renderTasksManager()})}
function addTaskDraft(kind){const input=el(kind==='resident'?'newResidentName':'newTaskName'),name=input.value.trim();if(!name)return;const list=kind==='resident'?taskDraftResidents:taskDraftTasks;if(list.some(item=>item.name.toLowerCase()===name.toLowerCase()))return setStatus('Navnet findes allerede.','error');list.push({name});input.value='';renderTasksManager()}
async function syncTaskList(table,drafts,current){
  const keptIds=new Set(drafts.map(item=>item.id).filter(Boolean));
  const removed=current.filter(item=>item.id&&!keptIds.has(item.id));
  await Promise.all(removed.map(item=>apiFetch(`/rest/v1/${table}?id=eq.${encodeURIComponent(item.id)}&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({active:false})},true)));
  for(let index=0;index<drafts.length;index+=1){
    const item=drafts[index],values={team_slug:TEAM_SLUG,name:item.name,sort_order:index+1,active:true};
    if(item.id)await apiFetch(`/rest/v1/${table}?id=eq.${encodeURIComponent(item.id)}&team_slug=eq.${encodeURIComponent(TEAM_SLUG)}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(values)},true);
    else await apiFetch(`/rest/v1/${table}?on_conflict=team_slug,name`,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(values)},true);
  }
}
async function saveTasks(){
  const button=el('saveTasksButton'),rotationStart=el('taskRotationStart').value;
  if(!rotationStart)return setStatus('Vælg en startmandag.','error');
  if(dateFromIso(rotationStart).getDay()!==1)return setStatus('Rotationen skal starte på en mandag.','error');
  button.disabled=true;button.textContent='Gemmer…';
  try{
    await syncTaskList('team_residents',taskDraftResidents,state.residents);
    await syncTaskList('team_tasks',taskDraftTasks,state.teamTasks);
    await upsertTeamSettings({task_rotation_start:rotationStart});
    el('tasksManagerDialog').close();await loadData({quiet:true});setStatus('Ugeopgaverne er gemt','success');
  }catch(error){console.error(error);setStatus('Ugeopgaverne kunne ikke gemmes. Intet er slettet.','error')}
  finally{button.disabled=false;button.textContent='Gem ugeopgaver'}
}

async function teamAccountAction(action, value) {
  const response = await fetch('/api/team-account', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${state.session.access_token}` }, body:JSON.stringify({ action, value }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Handlingen mislykkedes.');
  return data;
}

async function saveViewerCode() {
  if (!requireEditable()) return;
  const input=el('newViewerCode'),button=el('saveViewerCode'),value=input.value;
  if(value.length<6){setStatus('Tavlekoden skal have mindst seks tegn.','error');return}
  if(!confirm('Vil du sætte en ny tavlekode? Den gamle kode stopper med at virke.'))return;
  button.disabled=true;button.textContent='Gemmer…';
  try{await teamAccountAction('reset-viewer',value);input.value='';setStatus('Den nye tavlekode er gemt','success')}
  catch(error){setStatus(error.message,'error')}
  finally{button.disabled=false;button.textContent='Sæt ny tavlekode'}
}

async function sendStaffRecovery(email) {
  const response=await fetch('/api/team-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:TEAM_SLUG,action:'recover',email})});
  if(!response.ok)throw new Error('Mailen kunne ikke sendes. Prøv igen senere.');
}

async function handleRecoveryLink() {
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.get('type')!=='recovery'||!params.get('access_token'))return false;
  state.session={access_token:params.get('access_token'),refresh_token:params.get('refresh_token'),user:{user_metadata:{role:'editor',team_slug:TEAM_SLUG}}};
  history.replaceState(null,'',location.pathname);
  el('newPasswordDialog').showModal();
  return true;
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
el('closeAdmin').addEventListener('click', closeAdminWithCheck);
el('adminDialog').addEventListener('cancel', event => { event.preventDefault(); closeAdminWithCheck(); });
el('closeImageDialog').addEventListener('click', () => el('imageDialog').close());
el('imageDialog').addEventListener('click', event => { if (event.target === el('imageDialog')) el('imageDialog').close(); });
el('logoutButton').addEventListener('click', () => { if (confirmDiscardWeekChanges('logge ud')) signOut(); });
el('viewerLogoutButton').addEventListener('click', leaveBoard);
el('adminDaySelect').addEventListener('change', () => {
  captureAdminDay();
  loadAdminDay();
});
el('previousEditWeek').addEventListener('click', () => changeEditingWeek(-7));
el('nextEditWeek').addEventListener('click', () => changeEditingWeek(7));
el('publishWeekButton').addEventListener('click', publishEditingWeek);
document.querySelectorAll('[data-add-shift]').forEach(button => button.addEventListener('click', () => {
  const type = button.dataset.addShift;
  if (editingShifts[type].length < 10) editingShifts[type].push('');
  renderShiftEditors();
}));
el('openSettingsButton').addEventListener('click', () => {
  if (hasUnsavedWeekChanges()) return setStatus('Gem ændringerne, før du åbner Grundindstillinger.', 'error');
  openSettings();
});
el('shiftMode').addEventListener('change',updateSettingsVisibility);
el('nightEnabled').addEventListener('change',updateSettingsVisibility);
el('tasksEnabled').addEventListener('change',updateSettingsVisibility);
el('closeSettingsButton').addEventListener('click', () => el('settingsDialog').close());
el('saveSettingsButton').addEventListener('click', saveSettings);
el('saveViewerCode').addEventListener('click',saveViewerCode);
el('toggleViewerCode').addEventListener('click',()=>{const input=el('newViewerCode');input.type=input.type==='password'?'text':'password';el('toggleViewerCode').textContent=input.type==='password'?'Vis':'Skjul'});
el('addActivityRow').addEventListener('click', () => { editingActivities.push({ time: '10:00', name: '' }); renderActivityEditor(); });
el('saveDayButton').addEventListener('click', saveWeekChanges);
el('addStaffButton').addEventListener('click', addStaff);
['breakfast','lunch','dinner'].forEach(type=>el(`${type}PhotoInput`).addEventListener('change',event=>{pendingMealPhotos[type]=event.target.files?.[0]||null;if(type==='dinner'){pendingDinnerPhoto=pendingMealPhotos[type];selectedPexelsPhoto=null}el(`${type}PhotoName`).textContent=pendingMealPhotos[type]?pendingMealPhotos[type].name:'Intet billede valgt.'}));
el('openStaffManagerButton').addEventListener('click',()=>{
  if(hasUnsavedWeekChanges())return setStatus('Gem ændringerne, før du redigerer medarbejderlisten.','error');
  renderStaffManager();el('staffManagerDialog').showModal()
});
el('closeStaffManagerButton').addEventListener('click',()=>el('staffManagerDialog').close());
el('boardTab').addEventListener('click',()=>showModule('board'));
el('tasksTab').addEventListener('click',()=>showModule('tasks'));
el('openTasksManagerButton').addEventListener('click',openTasksManager);
el('closeTasksManagerButton').addEventListener('click',()=>el('tasksManagerDialog').close());
el('addResidentButton').addEventListener('click',()=>addTaskDraft('resident'));
el('addTaskButton').addEventListener('click',()=>addTaskDraft('task'));
el('saveTasksButton').addEventListener('click',saveTasks);
el('requestSubscriptionButton').addEventListener('click', event => requestSubscription(event.currentTarget));
el('requestSubscriptionSettingsButton').addEventListener('click', event => requestSubscription(event.currentTarget));
el('openViewerHelp').addEventListener('click',()=>el('viewerHelpDialog').showModal());
el('closeViewerHelp').addEventListener('click',()=>el('viewerHelpDialog').close());
el('viewerHelpForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;el('viewerHelpStatus').textContent='Sender…';try{const response=await fetch('/api/public-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'viewer-help',team_slug:TEAM_SLUG,contact_name:el('viewerHelpName').value,contact_email:el('viewerHelpEmail').value})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Kunne ikke sende anmodningen.');event.target.reset();el('viewerHelpStatus').textContent='Anmodningen er sendt. Du bliver kontaktet på arbejdsmailen.'}catch(error){el('viewerHelpStatus').textContent=error.message}finally{button.disabled=false}});
el('forgotStaffPassword').addEventListener('click',()=>{el('loginDialog').close();el('staffRecoveryDialog').showModal()});
el('closeStaffRecovery').addEventListener('click',()=>el('staffRecoveryDialog').close());
el('staffRecoveryForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;el('staffRecoveryStatus').textContent='Sender…';try{await sendStaffRecovery(el('staffRecoveryEmail').value.trim());el('staffRecoveryStatus').textContent='Hvis mailen er registreret på teamets personalelogin, er nulstillingslinket sendt.'}catch(error){el('staffRecoveryStatus').textContent=error.message}finally{button.disabled=false}});
el('newPasswordForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await apiFetch('/auth/v1/user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:el('recoveryNewPassword').value})},true);el('newPasswordStatus').textContent='Koden er ændret. Du kan nu logge ind som personale.';setTimeout(()=>location.href=`/${TEAM_SLUG}`,1500)}catch{el('newPasswordStatus').textContent='Koden kunne ikke ændres. Bed om et nyt link.'}finally{button.disabled=false}});
document.querySelectorAll('[data-open-meal-search]').forEach(searchButton=>searchButton.addEventListener('click', () => {
  mealSearchTarget=searchButton.dataset.openMealSearch;
  el('imageSearchTitle').textContent=`Find billede til ${{breakfast:'morgenmad',lunch:'frokost',dinner:'aftensmad'}[mealSearchTarget]}`;
  el('imageSearchInput').value = el(`${mealSearchTarget}Input`).value.trim();
  el('imageSearchResults').innerHTML = '<p class="image-search-message">Skriv fx “lasagne”, “frikadeller” eller “kylling med ris”.</p>';
  el('imageSearchDialog').showModal();
  el('imageSearchInput').focus();
}));
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
window.addEventListener('beforeunload', event => {
  if (!hasUnsavedWeekChanges()) return;
  event.preventDefault();
  event.returnValue = '';
});
document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) event.target.classList.add('image-load-error'); }, true);

async function init() {
  try {
    const response=await fetch(`/api/team-login?slug=${encodeURIComponent(TEAM_SLUG)}`),team=await response.json();
    if(!response.ok)throw new Error(team.error||'Tavlen blev ikke fundet.');
    state.team=team;
    document.querySelectorAll('.eyebrow').forEach(node=>{if(node.textContent.trim()==='TEAM 2')node.textContent=team.name.toUpperCase()});
    el('viewerUsername').value=team.name;
    document.querySelector('#viewerLoginDialog .note').textContent=`Indtast ${team.name}s fælles tavlekode. Browseren kan selv tilbyde at gemme koden på enheder, du stoler på.`;
    document.querySelector('#loginForm input[name="username"]').value=`${team.name} – personale`;
  } catch(error) {
    document.body.innerHTML=`<main class="app-shell"><section class="panel"><h1>Tavlen blev ikke fundet</h1><p>${escapeHtml(error.message)}</p><a class="button" href="/login">Find jeres tavle</a></section></main>`;
    return;
  }
  renderLoginState();
  if(await handleRecoveryLink())return;
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
