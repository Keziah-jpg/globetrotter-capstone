// Icon + label per place type
const TYPE_META = {
  hospital: { icon: 'fa-hospital', label: 'Hospital' },
  clinic: { icon: 'fa-stethoscope', label: 'Clinic' },
  pharmacy: { icon: 'fa-prescription-bottle-medical', label: 'Pharmacy' },
  market: { icon: 'fa-store', label: 'Market' },
  police: { icon: 'fa-shield-halved', label: 'Police' },
  church: { icon: 'fa-place-of-worship', label: 'Church' }
};

function currentUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); }
  catch (e) { return null; }
}

function authHeaders() {
  const user = currentUser();
  return user ? { 'x-user-email': user.email } : {};
}

// Renders 5-star rating with a numeric score
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

// Computes open/closed from the place's hours, using the browser's local time
function isOpenNow(hours) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = hours.open.split(':').map(Number);
  const [ch, cm] = hours.close.split(':').map(Number);
  const openMin = oh * 60 + om, closeMin = ch * 60 + cm;
  if (closeMin <= openMin) return cur >= openMin || cur < closeMin;
  return cur >= openMin && cur < closeMin;
}

// Render service card with map, rating, open/closed status + auth-gated edit/delete
function renderServiceCard(s) {
  const meta = TYPE_META[s.type] || { icon: 'fa-map-pin', label: s.type };
  const open = isOpenNow(s.hours);
  const distance = (s.distanceKm !== undefined && s.distanceKm !== null)
    ? `<span class="distance-chip"><i class="fa-solid fa-route"></i> ${s.distanceKm} km</span>`
    : '';
  const user = currentUser();
  const ownerActions = user ? `
        <button class="btn-outline" onclick="editService(${s.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn-danger" onclick="deleteService(${s.id})"><i class="fa-solid fa-trash"></i> Delete</button>` : '';

  const photo = s.image
    ? `<img class="card-photo" src="${s.image}" alt="${s.name}" loading="lazy" onerror="this.style.display='none'">`
    : '';

  return `
    <div class="card fade-in" data-type="${s.type}">
      ${photo}
      <div class="card-top">
        <span class="badge" data-type="${s.type}"><i class="fa-solid ${meta.icon}"></i> ${meta.label}</span>
        <span>
          <span class="status-chip ${open ? 'open' : 'closed'}">${open ? 'Open now' : 'Closed'}</span>
          ${distance}
        </span>
      </div>
      <h3>${s.name}</h3>
      ${starsHtml(s.rating)}
      <p><i class="fa-solid fa-location-dot"></i> ${s.address}</p>
      <p><i class="fa-solid fa-phone"></i> ${s.contact}</p>
      <p><i class="fa-regular fa-clock"></i> ${s.hours.open} - ${s.hours.close}</p>
      <p><i class="fa-solid fa-language"></i> ${s.languages.join(', ')}</p>
      <p><i class="fa-solid fa-tags"></i> ${s.services.join(', ')}</p>
      <iframe class="map-embed" loading="lazy" src="https://www.google.com/maps?q=${s.lat},${s.lng}(${encodeURIComponent(s.name)})&z=16&output=embed"></iframe>
      <div class="card-actions">
        <button onclick="shareService(${s.id})"><i class="fa-solid fa-share"></i> Share</button>
        <button class="btn-outline" onclick="saveFavorite(${s.id})"><i class="fa-solid fa-heart"></i> Save</button>
        <a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}" target="_blank">
          <button class="btn-outline"><i class="fa-solid fa-map"></i> Open in Maps</button>
        </a>${ownerActions}
      </div>
    </div>
  `;
}

// Results container works on either index.html (#results) or services.html (#servicesList)
function getListContainer() {
  return document.getElementById('results') || document.getElementById('servicesList');
}

function renderList(data) {
  const list = getListContainer();
  if (!list) return;
  list.innerHTML = '';
  if (data.length === 0) {
    list.innerHTML = `<div class="card"><h3><i class="fa-solid fa-magnifying-glass"></i> No results found</h3></div>`;
    return;
  }
  data.forEach(s => { list.innerHTML += renderServiceCard(s); });
}

// Stat bar: totals by category
async function loadStatBar() {
  const bar = document.getElementById('statBar');
  if (!bar) return;
  const res = await fetch('/services');
  const data = await res.json();
  const counts = {};
  data.forEach(s => { counts[s.type] = (counts[s.type] || 0) + 1; });
  const order = ['hospital', 'clinic', 'pharmacy', 'market', 'police', 'church'];
  let html = `<div class="stat-tile"><div class="num">${data.length}</div><div class="label">Total Places</div></div>`;
  order.forEach(type => {
    const meta = TYPE_META[type];
    html += `<div class="stat-tile"><div class="num">${counts[type] || 0}</div><div class="label">${meta.label}s</div></div>`;
  });
  bar.innerHTML = html;
}

// ---------- Ask Nyom Locator: natural-language assistant ----------
const TYPE_SYNONYMS = {
  hospital: ['hospital', 'emergency', 'surgery', 'maternity', 'accident'],
  clinic: ['clinic', 'doctor', 'consultation', 'dentist', 'pediatric'],
  pharmacy: ['pharmacy', 'pharmacie', 'medicine', 'medication', 'drug', 'drugs'],
  market: ['market', 'marche', 'marché', 'shopping', 'food', 'produce', 'groceries'],
  police: ['police', 'gendarmerie', 'security', 'station', 'crime', 'report'],
  church: ['church', 'parish', 'paroisse', 'mass', 'cathedral', 'worship', 'pray']
};

function detectType(q) {
  for (const [type, words] of Object.entries(TYPE_SYNONYMS)) {
    if (words.some(w => q.includes(w))) return type;
  }
  return null;
}

async function askAssistant() {
  const raw = document.getElementById('askInput').value.trim();
  const reply = document.getElementById('assistantReply');
  if (!raw) return;
  const q = raw.toLowerCase();

  const wantsNear = /\b(near|nearest|closest|around me|nearby)\b/.test(q);
  const wantsOpen = /\bopen\b/.test(q) && !/\bopen(ing)? (a|an)\b/.test(q);
  const type = detectType(q);

  reply.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Thinking...`;

  const runFilter = (data) => {
    let results = data;
    if (type) results = results.filter(s => s.type === type);
    if (wantsOpen) results = results.filter(s => isOpenNow(s.hours));
    return results;
  };

  const finish = (results, viaLocation) => {
    renderList(results);
    const typeLabel = type ? (TYPE_META[type].label.toLowerCase() + (results.length === 1 ? '' : 's')) : 'places';
    if (results.length === 0) {
      reply.innerHTML = `<i class="fa-solid fa-circle-info"></i> I couldn't find any ${typeLabel}${wantsOpen ? ' open right now' : ''} in Nyom matching "${raw}".`;
      return;
    }
    let msg = `Found <strong>${results.length}</strong> ${typeLabel}${wantsOpen ? ' open right now' : ''} in Nyom.`;
    if (viaLocation && results[0].distanceKm != null) {
      msg += ` Closest: <strong>${results[0].name}</strong> (${results[0].distanceKm} km away).`;
    } else {
      msg += ` Top match: <strong>${results[0].name}</strong>.`;
    }
    reply.innerHTML = `<i class="fa-solid fa-robot"></i> ${msg}`;
  };

  if (wantsNear && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const res = await fetch(`/services?lat=${latitude}&lng=${longitude}`);
      const data = await res.json();
      finish(runFilter(data), true);
    }, async () => {
      const res = await fetch('/services');
      const data = await res.json();
      finish(runFilter(data), false);
    });
    return;
  }

  if (type || wantsOpen) {
    const res = await fetch('/services');
    const data = await res.json();
    finish(runFilter(data), false);
    return;
  }

  // Fall back to plain keyword search across name/type/address
  const res = await fetch(`/services/search?name=${encodeURIComponent(raw)}`);
  const data = await res.json();
  finish(data, false);
}

// Search services
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
  if (!navigator.geolocation) {
    alert('Geolocation is not supported in this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    const res = await fetch(`/services?lat=${latitude}&lng=${longitude}`);
    const data = await res.json();
    renderList(data);
  }, () => {
    alert('Could not get your location. Showing places sorted by relevance instead.');
  });
}

// Register user
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

// Login user
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

// Reflect login state in the navbar + reveal the Add Place form
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

// Load services list (optionally sorted by distance)
async function loadServices() {
  const res = await fetch('/services');
  const data = await res.json();
  renderList(data);
}

// Add a place (requires login)
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
      lat: 3.94, lng: 11.52,
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

// Edit a place (requires login)
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

// Delete a place (requires login)
async function deleteService(id) {
  const user = currentUser();
  if (!user) { alert('Please log in first.'); return; }
  if (!confirm('Remove this place from the directory?')) return;

  const res = await fetch(`/services/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() }
  });
  if (res.ok) { loadServices(); loadStatBar(); }
  else { const d = await res.json(); alert(d.message || 'Could not delete place.'); }
}

// Share service
async function shareService(serviceId) {
  const user = currentUser();
  if (!user) { alert('Please log in to share a place.'); return; }
  const email = prompt('Enter email to share with:');
  if (!email) return;
  await fetch('/services/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ serviceId, sharedWith: email })
  });
  alert('Place shared!');
}

// Save favorite
function saveFavorite(serviceId) {
  let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
  if (!favorites.includes(serviceId)) {
    favorites.push(serviceId);
    localStorage.setItem('favorites', JSON.stringify(favorites));
    alert('Saved to favorites!');
  }
}

// Load recommendations
async function loadRecommendations() {
  const res = await fetch('/recommendations');
  const data = await res.json();
  const results = document.getElementById('results');
  if (results) {
    results.innerHTML = '<h2>Recommended for you</h2>';
    data.forEach(s => { results.innerHTML += renderServiceCard(s); });
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  loadStatBar();
  if (document.getElementById('servicesList')) {
    loadServices();
  } else if (document.getElementById('results')) {
    searchServices();
  }
});
