// Icon + label per place type
const TYPE_META = {
  hospital: { icon: 'fa-hospital', label: 'Hospital' },
  clinic: { icon: 'fa-stethoscope', label: 'Clinic' },
  pharmacy: { icon: 'fa-prescription-bottle-medical', label: 'Pharmacy' },
  market: { icon: 'fa-store', label: 'Market' },
  police: { icon: 'fa-shield-halved', label: 'Police' },
  church: { icon: 'fa-place-of-worship', label: 'Church' },
  hotel: { icon: 'fa-bed', label: 'Hotel' },
  restaurant: { icon: 'fa-utensils', label: 'Restaurant' },
  fuel: { icon: 'fa-gas-pump', label: 'Fuel Station' },
  recreation: { icon: 'fa-futbol', label: 'Recreation' },
  bank: { icon: 'fa-building-columns', label: 'Bank' }
};

function currentUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); }
  catch (e) { return null; }
}
function authHeaders() {
  const user = currentUser();
  return user ? { 'x-user-email': user.email } : {};
}

function starsHtml(rating) {
  const r = Math.round((rating || 0) * 2) / 2;
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (r >= i) html += '<i class="fa-solid fa-star"></i>';
    else if (r >= i - 0.5) html += '<i class="fa-solid fa-star-half-stroke"></i>';
    else html += '<i class="fa-regular fa-star far-empty"></i>';
  }
  return `<span class="rating">${html}<span class="score">${(rating || 0).toFixed(1)}</span></span>`;
}

function isOpenNow(hours) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = hours.open.split(':').map(Number);
  const [ch, cm] = hours.close.split(':').map(Number);
  const openMin = oh * 60 + om, closeMin = ch * 60 + cm;
  if (closeMin <= openMin) return cur >= openMin || cur < closeMin;
  return cur >= openMin && cur < closeMin;
}

let myFavoritesCache = [];
async function loadMyFavoritesCache() {
  if (!currentUser()) { myFavoritesCache = []; return; }
  try {
    const res = await fetch('/favorites', { headers: authHeaders() });
    myFavoritesCache = res.ok ? (await res.json()).favorites : [];
  } catch (e) { /* user-service unreachable */ }
}

function renderServiceCard(s) {
  const meta = TYPE_META[s.type] || { icon: 'fa-map-pin', label: s.type };
  const open = isOpenNow(s.hours);
  const distance = (s.distanceKm !== undefined && s.distanceKm !== null)
    ? `<span class="distance-chip"><i class="fa-solid fa-route"></i> ${s.distanceKm} km</span>`
    : '';
  const user = currentUser();
  const saved = myFavoritesCache.includes(s.id);
  const ownerActions = user ? `
        <button class="btn btn-sm btn-outline-secondary" onclick="editService(${s.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteService(${s.id})"><i class="fa-solid fa-trash"></i> Delete</button>` : '';

  const photo = s.image
    ? `<img class="card-photo" src="${s.image}" alt="${s.name}" loading="lazy" onerror="this.style.display='none'">`
    : '';

  return `
    <div class="card place-card fade-in" data-type="${s.type}">
      ${photo}
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-1">
          <span class="badge badge-type" data-type="${s.type}"><i class="fa-solid ${meta.icon}"></i> ${meta.label}</span>
          <span>
            <span class="status-chip ${open ? 'open' : 'closed'}">${open ? 'Open now' : 'Closed'}</span>
            ${distance}
          </span>
        </div>
        <h3 class="h6 fw-bold">${s.name}</h3>
        ${starsHtml(s.rating)}
        <p class="small mb-1"><i class="fa-solid fa-location-dot"></i> ${s.address}</p>
        <p class="small mb-1"><i class="fa-solid fa-phone"></i> ${s.contact}</p>
        <p class="small mb-1"><i class="fa-regular fa-clock"></i> ${s.hours.open} - ${s.hours.close}</p>
        <p class="small mb-1"><i class="fa-solid fa-language"></i> ${(s.languages || []).join(', ')}</p>
        <p class="small mb-2"><i class="fa-solid fa-tags"></i> ${(s.services || []).join(', ')}</p>
        <div class="d-flex flex-wrap gap-2">
          <a href="place.html?id=${s.id}" class="btn btn-sm btn-app-clay"><i class="fa-solid fa-circle-info"></i> Details</a>
          <a href="map.html?place=${s.id}" class="btn btn-sm btn-app"><i class="fa-solid fa-map"></i> Map</a>
          <a href="${yangoBookingUrl(s.lat, s.lng)}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#ff2b04;color:#fff;"><i class="fa-solid fa-car-side"></i> Ride</a>
          <button class="btn btn-sm btn-outline-secondary" data-name="${s.name}" onclick="shareService(${s.id}, this)"><i class="fa-solid fa-share"></i> Share</button>
          <button class="btn btn-sm ${saved ? 'btn-app-accent' : 'btn-outline-secondary'}" onclick="saveFavorite(${s.id}, this)"><i class="fa-${saved ? 'solid' : 'regular'} fa-heart"></i> ${saved ? 'Saved' : 'Save'}</button>
          ${ownerActions}
        </div>
      </div>
    </div>
  `;
}

function getListContainer() {
  return document.getElementById('results') || document.getElementById('servicesList');
}
function renderList(data) {
  const list = getListContainer();
  if (!list) return;
  list.innerHTML = '';
  if (data.length === 0) {
    list.innerHTML = `<div class="card place-card p-3"><h3 class="h6"><i class="fa-solid fa-magnifying-glass"></i> No results found</h3></div>`;
    return;
  }
  data.forEach(s => { list.innerHTML += renderServiceCard(s); });
}

async function loadStatBar() {
  const bar = document.getElementById('statBar');
  if (!bar) return;
  const res = await fetch('/services');
  const data = await res.json();
  const counts = {};
  data.forEach(s => { counts[s.type] = (counts[s.type] || 0) + 1; });
  const order = ['hospital', 'clinic', 'pharmacy', 'market', 'police', 'church', 'hotel', 'restaurant', 'fuel', 'recreation', 'bank'];
  let html = `<div class="stat-tile"><div class="num">${data.length}</div><div class="label">Total Places</div></div>`;
  order.forEach(type => {
    const meta = TYPE_META[type];
    html += `<div class="stat-tile"><div class="num">${counts[type] || 0}</div><div class="label">${meta.label}s</div></div>`;
  });
  bar.innerHTML = html;
}

// ---------- Ask Nyom Locator: Claude-powered assistant (assistant-service) ----------
function renderChatBubble(role, content, places) {
  const chips = (places || []).map(p =>
    `<a class="place-chip" href="map.html?place=${p.id}"><i class="fa-solid fa-location-dot"></i> ${p.name} &middot; directions</a>`
  ).join('');
  return `<div class="chat-bubble ${role}">${content}${chips ? `<div class="mt-2">${chips}</div>` : ''}</div>`;
}

async function loadAssistantHistory() {
  const box = document.getElementById('assistantHistory');
  const hint = document.getElementById('assistantHint');
  if (!box) return;
  const user = currentUser();
  if (!user) {
    box.innerHTML = '';
    if (hint) hint.textContent = 'Log in to save your chat history.';
    return;
  }
  try {
    const res = await fetch('/assistant/history', { headers: authHeaders() });
    if (!res.ok) return;
    const history = await res.json();
    box.innerHTML = history.map(m => renderChatBubble(m.role, m.content, m.places)).join('');
    box.scrollTop = box.scrollHeight;
    if (hint) hint.textContent = history.length ? '' : 'Your previous chats will appear here.';
  } catch (e) { /* assistant-service unreachable */ }
}

function askAssistantWithPosition(raw) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({}),
      { timeout: 3000 }
    );
  });
}

async function askAssistant() {
  const input = document.getElementById('askInput');
  const raw = input.value.trim();
  const reply = document.getElementById('assistantReply');
  const box = document.getElementById('assistantHistory');
  if (!raw) return;
  reply.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Thinking...`;
  if (box) box.innerHTML += renderChatBubble('user', raw);
  input.value = '';

  const { lat, lng } = await askAssistantWithPosition(raw);

  try {
    const res = await fetch('/assistant/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ message: raw, lat, lng })
    });
    const data = await res.json();
    if (!res.ok) {
      reply.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${data.message || 'Assistant unavailable.'}`;
      return;
    }
    reply.innerHTML = '';
    if (box) {
      box.innerHTML += renderChatBubble('assistant', data.reply, data.places);
      box.scrollTop = box.scrollHeight;
    } else {
      reply.innerHTML = `<i class="fa-solid fa-robot"></i> ${data.reply}`;
    }
  } catch (e) {
    reply.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Could not reach the assistant.`;
  }
}

// Search places
async function searchServices() {
  const name = document.getElementById('searchName').value;
  const type = document.getElementById('searchType').value;
  const language = document.getElementById('searchLanguage').value;
  const query = new URLSearchParams({ name, type, language });
  const res = await fetch(`/services/search?${query}`);
  const data = await res.json();
  renderList(data);
}

// Near Me: geolocate and sort every place by real distance
function findNearMe() {
  if (!navigator.geolocation) { alert('Geolocation is not supported in this browser.'); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    const res = await fetch(`/services?lat=${latitude}&lng=${longitude}`);
    const data = await res.json();
    renderList(data);
  }, () => { alert('Could not get your location. Showing places sorted by relevance instead.'); });
}

async function registerUser() {
  const name = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const res = await fetch('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, preferences: [] })
  });
  const data = await res.json();
  document.getElementById('loginResult').innerText = res.ok
    ? `Registered: ${data.name}. You can now log in below.`
    : (data.message || 'Registration failed');
}

async function loginUser() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  document.getElementById('loginResult').innerText = data.message;
  if (data.user) {
    localStorage.setItem('user', JSON.stringify(data.user));
    updateAuthUI();
    setTimeout(() => { window.location.href = 'services.html'; }, 600);
  }
}

function logout() {
  localStorage.removeItem('user');
  updateAuthUI();
  if (document.getElementById('servicesList')) loadServices();
}

function updateAuthUI() {
  const user = currentUser();
  const link = document.getElementById('navAuthLink');
  if (link) {
    if (user) {
      link.textContent = `Logout (${user.name})`;
      link.href = '#';
      link.onclick = (e) => { e.preventDefault(); logout(); };
    } else {
      link.textContent = 'Login';
      link.href = 'login.html';
      link.onclick = null;
    }
  }
  const addSection = document.getElementById('addPlaceSection');
  if (addSection) addSection.style.display = user ? 'block' : 'none';
}

async function loadServices() {
  const res = await fetch('/services');
  const data = await res.json();
  renderList(data);
}

async function addPlace() {
  const user = currentUser();
  if (!user) { alert('Please log in first.'); return; }
  const name = document.getElementById('newName').value;
  const type = document.getElementById('newType').value;
  const address = document.getElementById('newAddress').value;
  const contact = document.getElementById('newContact').value;
  const open = document.getElementById('newOpen').value;
  const close = document.getElementById('newClose').value;
  if (!name || !address) { alert('Name and address are required.'); return; }

  const res = await fetch('/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      name, type, address, contact,
      lat: 3.95, lng: 11.52,
      hours: { open, close },
      languages: ['French'],
      services: []
    })
  });
  if (res.ok) {
    document.getElementById('newName').value = '';
    document.getElementById('newAddress').value = '';
    document.getElementById('newContact').value = '';
    loadServices();
    loadStatBar();
  } else {
    const data = await res.json();
    alert(data.message || 'Could not add place.');
  }
}

async function editService(id) {
  const user = currentUser();
  if (!user) { alert('Please log in first.'); return; }
  const res = await fetch(`/services/${id}`);
  const s = await res.json();
  const name = prompt('Name:', s.name);
  if (name === null) return;
  const address = prompt('Address:', s.address);
  if (address === null) return;
  const open = prompt('Opening time (HH:MM):', s.hours.open);
  if (open === null) return;
  const close = prompt('Closing time (HH:MM):', s.hours.close);
  if (close === null) return;
  const putRes = await fetch(`/services/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, address, hours: { open, close } })
  });
  if (putRes.ok) { loadServices(); }
  else { const d = await putRes.json(); alert(d.message || 'Could not update place.'); }
}

async function deleteService(id) {
  const user = currentUser();
  if (!user) { alert('Please log in first.'); return; }
  if (!confirm('Remove this place from the directory?')) return;
  const res = await fetch(`/services/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  if (res.ok) { loadServices(); loadStatBar(); }
  else { const d = await res.json(); alert(d.message || 'Could not delete place.'); }
}

// Real sharing: opens the OS share sheet (WhatsApp, SMS, email...) with a real deep
// link to this place's detail page, so whoever receives it can open it straight away.
async function shareService(serviceId, btn) {
  const name = btn?.dataset?.name || 'this place';
  const url = `${window.location.origin}/place.html?id=${serviceId}`;
  const shareData = { title: name, text: `${name} - found it on Nyom Locator:`, url };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch (e) { /* user cancelled */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    alert('Link copied! Paste it in WhatsApp, SMS or email to share this place.');
  } catch (e) {
    prompt('Copy this link to share this place:', url);
  }
}

// Save/unsave a place to the logged-in user's favorites (persisted server-side,
// so it follows them across devices, not just this browser's localStorage).
async function saveFavorite(serviceId, btn) {
  const user = currentUser();
  if (!user) { alert('Please log in to save places.'); return; }
  const res = await fetch('/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ placeId: serviceId })
  });
  if (!res.ok) return;
  const { favorites } = await res.json();
  const saved = favorites.includes(serviceId);
  if (btn) {
    btn.innerHTML = saved ? '<i class="fa-solid fa-heart"></i> Saved' : '<i class="fa-regular fa-heart"></i> Save';
    btn.classList.toggle('btn-app-accent', saved);
    btn.classList.toggle('btn-outline-secondary', !saved);
  }
}

// ---------- Real GPS + Nyom geofence (works anywhere in the world) ----------
let nyomGeofence = null;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function updateGpsStatus(lat, lng) {
  const chip = document.getElementById('gpsStatus');
  if (!chip) return;
  if (!nyomGeofence) {
    try {
      const res = await fetch('/geofence');
      nyomGeofence = await res.json();
    } catch (e) { return; }
  }
  const distanceKm = Math.round(haversineKm(lat, lng, nyomGeofence.center.lat, nyomGeofence.center.lng) * 10) / 10;
  const inside = distanceKm <= nyomGeofence.radiusKm;
  chip.className = inside ? 'inside' : 'outside';
  chip.innerHTML = inside
    ? `<i class="fa-solid fa-circle-check"></i> You're in Nyom`
    : `<i class="fa-solid fa-route"></i> ${distanceKm} km from Nyom`;
  window.__lastKnownPosition = { lat, lng };
  document.dispatchEvent(new CustomEvent('nyom:position', { detail: { lat, lng, distanceKm, inside } }));
  if (inside) checkNearbyPlacesForVisit(lat, lng);
}

// Real ride booking: hands off to Yango's actual Cameroon booking page (yango.com/en_cm)
// rather than building any booking flow ourselves - pre-fills pickup (from the user's
// live location, if we have it) and destination, verified working via the gfrom/gto
// query params Yandex/Yango document for their web ordering page.
function yangoBookingUrl(destLat, destLng) {
  const params = new URLSearchParams();
  const pos = window.__lastKnownPosition;
  if (pos) params.set('gfrom', `${pos.lng},${pos.lat}`);
  params.set('gto', `${destLng},${destLat}`);
  return `https://yango.com/en_cm/order/?${params.toString()}`;
}

// Automatic "visited" tracking: when a logged-in user's live GPS comes within ~150m
// of a place, silently record it as visited (once per place per browser session) -
// this is what builds up "places you've visited before" without any manual step.
const VISIT_RADIUS_KM = 0.15;
let placesForVisitCheck = null;
const visitedThisSession = new Set();

async function checkNearbyPlacesForVisit(lat, lng) {
  const user = currentUser();
  if (!user) return;
  if (!placesForVisitCheck) {
    try {
      const res = await fetch('/services');
      placesForVisitCheck = res.ok ? await res.json() : [];
    } catch (e) { return; }
  }
  for (const p of placesForVisitCheck) {
    if (p.lat == null || p.lng == null || visitedThisSession.has(p.id)) continue;
    const distKm = haversineKm(lat, lng, p.lat, p.lng);
    if (distKm <= VISIT_RADIUS_KM) {
      visitedThisSession.add(p.id);
      fetch('/visited', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ placeId: p.id })
      }).catch(() => {});
    }
  }
}

function startLiveLocation() {
  const chip = document.getElementById('gpsStatus');
  if (!navigator.geolocation) {
    if (chip) { chip.className = 'unknown'; chip.innerHTML = '<i class="fa-solid fa-ban"></i> Geolocation unsupported'; }
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => updateGpsStatus(pos.coords.latitude, pos.coords.longitude),
    () => { if (chip) { chip.className = 'unknown'; chip.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Location unavailable'; } },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  updateAuthUI();
  loadStatBar();
  loadAssistantHistory();
  startLiveLocation();
  await loadMyFavoritesCache();
  if (document.getElementById('servicesList')) {
    loadServices();
  } else if (document.getElementById('results')) {
    searchServices();
  }
});
