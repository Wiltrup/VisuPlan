const SUPABASE_URL = 'https://fzrtvogirhmnbicdaffc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oHmuwX8xm8d-77XLapdBFw_ragbZH4F';
const slug = location.pathname.split('/').filter(Boolean).at(-1) || '';
const DAYS = [
  ['Mandag','Man','#eab308'],
  ['Tirsdag','Tir','#ef4444'],
  ['Onsdag','Ons','#22c55e'],
  ['Torsdag','Tor','#f97316'],
  ['Fredag','Fre','#3b82f6'],
  ['Lørdag','Lør','#a855f7'],
  ['Søndag','Søn','#ec4899']
];
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const timeLabel = (start, end) => {
  const from = String(start || '').slice(0, 5);
  const to = String(end || '').slice(0, 5);
  return from && to ? `${from}–${to}` : from || (to ? `Til ${to}` : '');
};

let offer = null;
let session = null;
let selected = Math.min(6, Math.max(0, (new Date().getDay() + 6) % 7));
let weekStart = '';
let days = {};
let activities = {};
let editingActivities = [];
let pendingPhoto = null;
let editorMode = false;
let imageSearchTarget = { kind:'meal', index:null };
const signedMediaCache = new Map();

function iso(date) { return date.toISOString().slice(0, 10); }
function monday() { const now = new Date(); now.setHours(12,0,0,0); now.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return iso(now); }
function add(date, numberOfDays) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + numberOfDays); return iso(value); }
function dateAt(index) { return add(weekStart, index); }
function format(date) { return new Intl.DateTimeFormat('da-DK', { day:'numeric', month:'long' }).format(new Date(`${date}T12:00:00`)); }
function headers(extra = {}) { return { apikey:SUPABASE_KEY, Authorization:`Bearer ${session?.access_token || SUPABASE_KEY}`, ...extra }; }
function status(text) { $('offerStatus').textContent = text; if (text) setTimeout(() => { if ($('offerStatus').textContent === text) $('offerStatus').textContent = ''; }, 3500); }

async function api(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers:headers(options.headers) });
  const text = await response.text();
  if (!response.ok) throw new Error(text || 'Handlingen mislykkedes');
  return text ? JSON.parse(text) : null;
}

async function resolveMedia(value) {
  if (!value) return '';
  const markers = [
    '/storage/v1/object/public/visuplan-images/',
    '/storage/v1/object/sign/visuplan-images/',
    '/storage/v1/object/authenticated/visuplan-images/'
  ];
  const marker = markers.find(item => value.includes(item));
  const path = marker
    ? value.split(marker)[1].split('?')[0]
    : (/^https?:\/\//i.test(value) ? '' : String(value).replace(/^\/+/,''));
  if (!path) return value;
  const cached = signedMediaCache.get(path);
  if (cached?.expiresAt > Date.now()) return cached.url;
  try {
    const result = await api(`/storage/v1/object/sign/visuplan-images/${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ expiresIn:3600 }) });
    const raw = result?.signedURL || result?.signedUrl || result?.signed_url || '';
    let signed = '';
    if (/^https?:\/\//i.test(raw)) signed = raw;
    else if (raw.startsWith('/storage/v1/')) signed = `${SUPABASE_URL}${raw}`;
    else if (raw.startsWith('/object/')) signed = `${SUPABASE_URL}/storage/v1${raw}`;
    else if (raw) signed = `${SUPABASE_URL}/storage/v1/object/sign/visuplan-images/${path}?token=${encodeURIComponent(raw)}`;
    if (!signed && result?.token) signed = `${SUPABASE_URL}/storage/v1/object/sign/visuplan-images/${path}?token=${encodeURIComponent(result.token)}`;
    if (!signed) throw new Error('Billedlinket kunne ikke oprettes.');
    signedMediaCache.set(path, { url:signed, expiresAt:Date.now() + 50 * 60 * 1000 });
    return signed;
  } catch (error) { console.error('Kunne ikke åbne klubbillede', error); return ''; }
}

function photoNote(element, state, detail = '') {
  element.classList.toggle('is-empty', state === 'empty');
  const heading = state === 'empty' ? 'Intet billede valgt' : state === 'existing' ? 'Billede tilknyttet ✓' : 'Billede valgt ✓';
  element.innerHTML = `<strong>${heading}</strong>${detail ? `<span>${esc(detail)}</span>` : ''}`;
}

async function loadOffer() {
  const response = await fetch(`/api/shared-offer-login?slug=${encodeURIComponent(slug)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Tilbuddet blev ikke fundet.');
  offer = data;
  $('offerName').textContent = offer.name;
  $('offerWorkplace').textContent = offer.workplace || offer.municipality || 'FÆLLES TILBUD';
  $('offerLoginTitle').textContent = `Åbn ${offer.name}`;
}

async function login(action, password) {
  const response = await fetch('/api/shared-offer-login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ slug, action, password }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Login mislykkedes.');
  session = data;
  sessionStorage.setItem(`visuplanner-offer-${slug}`, JSON.stringify(data));
  editorMode = action === 'editor-login';
  $('offerLoginDialog').close();
  $('offerLogout').hidden = false;
  await loadWeek();
  if (editorMode) openEditor();
}

async function restore() {
  const saved = JSON.parse(sessionStorage.getItem(`visuplanner-offer-${slug}`) || 'null');
  if (!saved?.refresh_token) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method:'POST', headers:{ apikey:SUPABASE_KEY, 'Content-Type':'application/json' }, body:JSON.stringify({ refresh_token:saved.refresh_token }) });
  if (!response.ok) return false;
  session = await response.json();
  editorMode = session.user?.user_metadata?.role === 'offer_editor';
  $('offerLogout').hidden = false;
  return true;
}

async function loadWeek() {
  weekStart = weekStart || monday();
  const dates = Array.from({ length:7 }, (_, index) => dateAt(index));
  const filter = `(${dates.join(',')})`;
  const [dayRows, activityRows] = await Promise.all([
    api(`/rest/v1/shared_offer_days?offer_id=eq.${offer.id}&plan_date=in.${filter}&select=*`),
    api(`/rest/v1/shared_offer_activities?offer_id=eq.${offer.id}&plan_date=in.${filter}&select=*&order=activity_time.asc,sort_order.asc`)
  ]);
  days = {};
  for (const row of dayRows || []) days[row.plan_date] = { ...row, meal_photo_path:row.meal_photo_url || '', meal_photo_url:await resolveMedia(row.meal_photo_url) };
  activities = {};
  for (const row of activityRows || []) {
    const item = { ...row, photo_path:row.photo_url || '', photo_url:await resolveMedia(row.photo_url) };
    (activities[row.plan_date] ??= []).push(item);
  }
  render();
}

function render() {
  const date = dateAt(selected);
  const day = DAYS[selected];
  const data = days[date] || {};
  const items = activities[date] || [];
  document.documentElement.style.setProperty('--day-color', day[2]);
  $('offerDay').textContent = day[0].toUpperCase();
  $('offerDate').textContent = format(date);
  $('offerDayTabs').innerHTML = DAYS.map((item, index) => `<button class="${index === selected ? 'active' : ''}" data-day="${index}">${item[1]}<small>${new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'numeric'}).format(new Date(`${dateAt(index)}T12:00:00`))}</small></button>`).join('');
  document.querySelectorAll('[data-day]').forEach(button => button.onclick = () => { selected = Number(button.dataset.day); render(); });
  $('offerMeal').textContent = data.meal_name || 'Ikke udfyldt';
  $('offerMealPhotoButton').hidden = !data.meal_photo_url;
  if (data.meal_photo_url) { $('offerMealPhoto').src = data.meal_photo_url; $('offerMealPhoto').alt = data.meal_name || 'Mad i klubben'; }
  $('offerActivities').innerHTML = items.length ? items.map(item => `<div class="offer-activity ${item.photo_url ? 'has-photo' : ''}">${item.photo_url ? `<button class="offer-activity-photo" data-offer-image="${esc(item.photo_url)}" data-offer-caption="${esc(item.name)}" aria-label="Vis stort billede af ${esc(item.name)}"><img src="${esc(item.photo_url)}" alt=""></button>` : ''}<time>${esc(timeLabel(item.activity_time, item.activity_end_time))}</time><strong>${esc(item.name)}</strong></div>`).join('') : '<p class="empty">Ingen aktiviteter</p>';
  document.querySelectorAll('[data-offer-image]').forEach(button => button.onclick = () => openLargeImage(button.dataset.offerImage, button.dataset.offerCaption));
  $('offerMessageCard').hidden = !data.message;
  $('offerMessage').textContent = data.message || '';
}

function openEditor() {
  if (!editorMode) return startEditorLogin();
  $('offerEditDate').innerHTML = Array.from({ length:28 }, (_, index) => {
    const date = add(monday(), index);
    return `<option value="${date}" ${date === dateAt(selected) ? 'selected' : ''}>${DAYS[index % 7][0]} ${format(date)}</option>`;
  }).join('');
  loadEditorDay();
  $('offerEditorDialog').showModal();
}

async function ensureEditorDate(date) {
  if (!days[date] && date < add(monday(), 7)) { days[date] = {}; activities[date] = activities[date] || []; }
  if (date >= add(monday(), 7)) {
    const [dayRows, activityRows] = await Promise.all([
      api(`/rest/v1/shared_offer_days?offer_id=eq.${offer.id}&plan_date=eq.${date}&select=*`),
      api(`/rest/v1/shared_offer_activities?offer_id=eq.${offer.id}&plan_date=eq.${date}&select=*&order=activity_time.asc,sort_order.asc`)
    ]);
    const row = dayRows?.[0] || {};
    days[date] = { ...row, meal_photo_path:row.meal_photo_url || '', meal_photo_url:await resolveMedia(row.meal_photo_url) };
    activities[date] = [];
    for (const item of activityRows || []) activities[date].push({ ...item, photo_path:item.photo_url || '', photo_url:await resolveMedia(item.photo_url) });
  }
}

async function loadEditorDay() {
  const date = $('offerEditDate').value;
  await ensureEditorDate(date);
  const data = days[date] || {};
  $('offerMealInput').value = data.meal_name || '';
  $('offerMessageInput').value = data.message || '';
  $('offerMealFile').value = '';
  pendingPhoto = null;
  photoNote($('offerMealFileNote'), data.meal_photo_path ? 'existing' : 'empty', data.meal_photo_path ? 'Vælg et nyt billede for at udskifte det.' : 'Søg efter et billede eller upload jeres eget.');
  editingActivities = (activities[date] || []).map(item => ({ time:(item.activity_time || '').slice(0,5), endTime:(item.activity_end_time || '').slice(0,5), name:item.name, photoPath:item.photo_path || item.photo_url || '', photoUrl:item.photo_url || '', photoFile:null }));
  renderActivityEditor();
}

function renderActivityEditor() {
  $('offerActivityEditor').innerHTML = editingActivities.map((item, index) => {
    const hasPhoto = Boolean(item.photoFile || item.photoPath);
    const detail = item.photoFile ? item.photoFile.name : hasPhoto ? 'Vælg et nyt billede for at udskifte det.' : 'Søg eller upload et billede til aktiviteten.';
    return `<div class="activity-edit-row"><label><span>Start</span><input type="time" data-activity-start="${index}" value="${esc(item.time)}"></label><label><span>Slut</span><input type="time" data-activity-end="${index}" value="${esc(item.endTime)}"></label><input data-activity-name="${index}" value="${esc(item.name)}" placeholder="Aktivitet"><button class="remove-activity" data-remove-activity="${index}" type="button" aria-label="Fjern aktivitet">✕</button><div class="activity-photo-controls"><button data-search-activity-photo="${index}" type="button">🔎 Søg efter billede</button><label>Upload billede<input type="file" accept="image/jpeg,image/png,image/webp" data-activity-photo="${index}"></label>${hasPhoto ? `<button class="clear-photo" data-clear-activity-photo="${index}" type="button">Fjern billede</button>` : ''}<div class="photo-selection-note ${hasPhoto ? '' : 'is-empty'}"><strong>${hasPhoto ? (item.photoFile ? 'Billede valgt ✓' : 'Billede tilknyttet ✓') : 'Intet billede valgt'}</strong><span>${esc(detail)}</span></div></div></div>`;
  }).join('') || '<p class="empty">Ingen aktiviteter endnu.</p>';
  document.querySelectorAll('[data-activity-start]').forEach(input => input.oninput = () => { editingActivities[Number(input.dataset.activityStart)].time = input.value; });
  document.querySelectorAll('[data-activity-end]').forEach(input => input.oninput = () => { editingActivities[Number(input.dataset.activityEnd)].endTime = input.value; });
  document.querySelectorAll('[data-activity-name]').forEach(input => input.oninput = () => { editingActivities[Number(input.dataset.activityName)].name = input.value; });
  document.querySelectorAll('[data-remove-activity]').forEach(button => button.onclick = () => { editingActivities.splice(Number(button.dataset.removeActivity), 1); renderActivityEditor(); });
  document.querySelectorAll('[data-search-activity-photo]').forEach(button => button.onclick = () => openImageSearch('activity', Number(button.dataset.searchActivityPhoto)));
  document.querySelectorAll('[data-activity-photo]').forEach(input => input.onchange = () => {
    const item = editingActivities[Number(input.dataset.activityPhoto)];
    item.photoFile = input.files?.[0] || null;
    if (item.photoFile) renderActivityEditor();
  });
  document.querySelectorAll('[data-clear-activity-photo]').forEach(button => button.onclick = () => {
    const item = editingActivities[Number(button.dataset.clearActivityPhoto)];
    item.photoFile = null; item.photoPath = ''; item.photoUrl = '';
    renderActivityEditor();
  });
}

async function uploadPhoto(file, date, folder = 'meals', suffix = '') {
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `offers/${offer.id}/${folder}/${date}${suffix ? `-${suffix}` : ''}-${Date.now()}.${extension || 'jpg'}`;
  await api(`/storage/v1/object/visuplan-images/${path}`, { method:'POST', headers:{ 'Content-Type':file.type || 'image/jpeg', 'x-upsert':'false' }, body:file });
  return path;
}

function openImageSearch(kind, index = null) {
  imageSearchTarget = { kind, index };
  const activity = kind === 'activity' ? editingActivities[index] : null;
  $('offerImageSearchTitle').textContent = kind === 'activity' ? 'Find et aktivitetsbillede' : 'Find et madbillede';
  $('offerImageSearchNote').textContent = kind === 'activity' ? 'Vælg ét billede til aktiviteten.' : 'Vælg ét billede til maden på den valgte dag.';
  $('offerImageSearchInput').placeholder = kind === 'activity' ? 'Fx svømning eller musik' : 'Fx lasagne';
  $('offerImageSearchInput').value = kind === 'activity' ? activity?.name.trim() || '' : $('offerMealInput').value.trim();
  $('offerImageSearchResults').innerHTML = '';
  $('offerImageSearchDialog').showModal();
}

function openLargeImage(url, caption = '') {
  $('offerLargeImage').src = url;
  $('offerLargeImage').alt = caption;
  $('offerImageDialog').showModal();
}

async function searchImages(query) {
  const response = await fetch(`/api/pexels-search?q=${encodeURIComponent(query)}`, { headers:{ Authorization:`Bearer ${session.access_token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Billedsøgningen fejlede.');
  return data.photos || [];
}

function renderImageResults(photos) {
  const target = $('offerImageSearchResults');
  if (!photos.length) { target.innerHTML = '<p class="image-search-message">Ingen billeder fundet. Prøv et andet eller mere enkelt søgeord.</p>'; return; }
  target.innerHTML = photos.map((photo, index) => `<button type="button" class="image-search-result" data-image-index="${index}"><img src="${esc(photo.thumbnail)}" alt="${esc(photo.alt)}" loading="lazy"><span>Foto: ${esc(photo.photographer)}</span></button>`).join('');
  document.querySelectorAll('[data-image-index]').forEach(button => button.onclick = async () => {
    const photo = photos[Number(button.dataset.imageIndex)];
    button.disabled = true;
    status('Henter billedet…');
    try {
      const response = await fetch(`/api/pexels-image?id=${encodeURIComponent(photo.id)}`, { headers:{ Authorization:`Bearer ${session.access_token}` } });
      if (!response.ok) throw new Error('Billedet kunne ikke hentes.');
      const blob = await response.blob();
      const file = new File([blob], `pexels-${photo.id}.jpg`, { type:blob.type || 'image/jpeg' });
      if (imageSearchTarget.kind === 'activity') {
        const item = editingActivities[imageSearchTarget.index];
        if (!item) throw new Error('Aktiviteten blev ikke fundet.');
        item.photoFile = file;
        renderActivityEditor();
      } else {
        pendingPhoto = file;
        $('offerMealFile').value = '';
        photoNote($('offerMealFileNote'), 'selected', `Valgt via Pexels · Foto: ${photo.photographer}`);
      }
      $('offerImageSearchDialog').close();
      status('Billedet er valgt – husk at gemme.');
    } catch (error) { status(error.message); button.disabled = false; }
  });
}

async function saveEditor() {
  const button = $('offerSave');
  const date = $('offerEditDate').value;
  button.disabled = true;
  button.textContent = 'Gemmer…';
  try {
    // Kontrollér v43-kolonnen før eksisterende aktivitetsrækker udskiftes.
    await api('/rest/v1/shared_offer_activities?select=activity_end_time&limit=0');
    let photoPath = days[date]?.meal_photo_path || '';
    if (pendingPhoto) photoPath = await uploadPhoto(pendingPhoto, date);
    const valid = editingActivities.filter(item => item.name.trim());
    for (let index = 0; index < valid.length; index += 1) {
      if (valid[index].photoFile) valid[index].photoPath = await uploadPhoto(valid[index].photoFile, date, 'activities', String(index + 1));
    }
    await api('/rest/v1/shared_offer_days?on_conflict=offer_id,plan_date', { method:'POST', headers:{ 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify({ offer_id:offer.id, plan_date:date, meal_name:$('offerMealInput').value.trim() || null, meal_photo_url:photoPath || null, message:$('offerMessageInput').value.trim() || null, updated_at:new Date().toISOString() }) });
    await api(`/rest/v1/shared_offer_activities?offer_id=eq.${offer.id}&plan_date=eq.${date}`, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
    if (valid.length) await api('/rest/v1/shared_offer_activities', { method:'POST', headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' }, body:JSON.stringify(valid.map((item, index) => ({ offer_id:offer.id, plan_date:date, activity_time:item.time || null, activity_end_time:item.endTime || null, name:item.name.trim(), photo_url:item.photoPath || null, sort_order:index + 1 }))) });
    if (date >= weekStart && date <= add(weekStart, 6)) await loadWeek();
    else {
      days[date] = { meal_name:$('offerMealInput').value.trim(), meal_photo_path:photoPath, meal_photo_url:await resolveMedia(photoPath), message:$('offerMessageInput').value.trim() };
      activities[date] = await Promise.all(valid.map(async item => ({ ...item, activity_time:item.time, activity_end_time:item.endTime, photo_url:await resolveMedia(item.photoPath || ''), photo_path:item.photoPath || '' })));
    }
    status('Klubbens indhold er opdateret på alle tilknyttede tavler.');
    button.textContent = 'Gemt ✓';
  } catch (error) {
    console.error(error);
    status('Indholdet kunne ikke gemmes. Kontrollér, at v43-databaseopdateringen er kørt.');
    button.textContent = 'Prøv igen';
  } finally {
    button.disabled = false;
    setTimeout(() => { button.textContent = 'Gem og opdatér alle tavler'; }, 1500);
  }
}

function startEditorLogin() {
  $('offerLoginTitle').textContent = `Rediger ${offer.name}`;
  $('offerLoginNote').textContent = 'Indtast tilbuddets redigeringskode.';
  $('offerLoginSubmit').textContent = 'Log ind og redigér';
  $('offerEditorLogin').hidden = true;
  $('offerLoginForm').dataset.mode = 'editor-login';
  $('offerLoginPassword').value = '';
  $('offerLoginDialog').showModal();
}

$('offerLoginForm').onsubmit = async event => { event.preventDefault(); $('offerLoginError').textContent = ''; try { await login(event.currentTarget.dataset.mode || 'viewer-login', $('offerLoginPassword').value); } catch (error) { $('offerLoginError').textContent = error.message; } };
$('offerEditorLogin').onclick = startEditorLogin;
$('offerEdit').onclick = openEditor;
$('offerCloseEditor').onclick = () => $('offerEditorDialog').close();
$('offerEditDate').onchange = loadEditorDay;
$('offerAddActivity').onclick = () => { editingActivities.push({ time:'10:00', endTime:'', name:'', photoPath:'', photoUrl:'', photoFile:null }); renderActivityEditor(); };
$('offerMealFile').onchange = event => {
  pendingPhoto = event.target.files?.[0] || null;
  if (pendingPhoto) photoNote($('offerMealFileNote'), 'selected', pendingPhoto.name);
  else photoNote($('offerMealFileNote'), days[$('offerEditDate').value]?.meal_photo_path ? 'existing' : 'empty', 'Søg efter et billede eller upload jeres eget.');
};
$('offerOpenImageSearch').onclick = () => openImageSearch('meal');
$('offerCloseImageSearch').onclick = () => $('offerImageSearchDialog').close();
$('offerImageSearchForm').onsubmit = async event => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; $('offerImageSearchResults').innerHTML = '<p class="image-search-message">Søger…</p>'; try { renderImageResults(await searchImages($('offerImageSearchInput').value.trim())); } catch (error) { $('offerImageSearchResults').innerHTML = `<p class="image-search-message">${esc(error.message)}</p>`; } finally { button.disabled = false; } };
$('offerSave').onclick = saveEditor;
$('offerPrev').onclick = () => { selected = (selected + 6) % 7; render(); };
$('offerNext').onclick = () => { selected = (selected + 1) % 7; render(); };
$('offerMealPhotoButton').onclick = () => openLargeImage($('offerMealPhoto').src, $('offerMealPhoto').alt);
$('offerCloseImage').onclick = () => $('offerImageDialog').close();
$('offerLogout').onclick = () => { sessionStorage.removeItem(`visuplanner-offer-${slug}`); location.reload(); };

(async () => {
  try {
    weekStart = monday();
    await loadOffer();
    if (await restore()) await loadWeek();
    else $('offerLoginDialog').showModal();
  } catch (error) {
    document.body.innerHTML = `<main class="dialog-card"><h1>Tilbuddet kunne ikke åbnes</h1><p>${esc(error.message)}</p><a href="/">Til forsiden</a></main>`;
  }
})();
