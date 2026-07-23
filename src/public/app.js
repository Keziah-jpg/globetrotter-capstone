// ============================================================
// Nyom Health Locator — front-end
// ============================================================

const USER_KEY = 'nyomUser';
const FAVORITES_KEY = 'nyomFavorites';
let userCoords = null;
let pendingShareServiceId = null;

// ---------- session helpers ----------

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

function setCurrentUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  updateAuthUI();
}

function logoutUser() {
  localStorage.removeItem(USER_KEY);
  updateAuthUI();
  showToast('Logged out. See you again soon!');
  setTimeout(() => { window.location.href = 'index.html'; }, 600);
}

function updateAuthUI() {
  const user = getCurrentUser();
  const chip = document.getElementById('userChip');
  const chipName = document.getElementById('userChipName');
  const navAuthLink = document.getElementById('navAuthLink');
  if (!chip) return;
  if (user) {
    chip.classList.add('show');
    if (chipName) chipName.textContent = user.name;
    if (navAuthLink) navAuthLink.style.display = 'none';
  } else {
    chip.classList.remove('show');
    if (navAuthLink) navAuthLink.style.display = '';
  }
  refreshAddServiceHint();
}

function authHeaders() {
  const user = getCurrentUser();
  return user ? { 'x-user-email': user.email } : {};
}

// ---------- toasts ----------

function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  if (!stack) { return; }
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ---------- misc ui helpers ----------

function togglePassword(fieldId, btn) {
  const input = document.getElementById(fieldId);
  const isPw = input.type === 'password';
  input.type = isPw ? 'text' : 'password';
  btn.innerHTML = isPw ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
}

function starString(rating) {
  if (typeof rating !== 'number') return '';
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function computeOpenStatus(hours) {
  if (!hours || !hours.open || !hours.close) return null;
  const now = new Date();
  const [oh, om] = hours.open.split(':').map(Number);
  const [ch, cm] = hours.close.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const openMinutes = oh * 60 + om;
  const closeMinutes = ch * 60 + cm;
  const isOpen = closeMinutes <= openMinutes
    ? true // spans midnight or 24h (00:00-23:59) — treat as always open
    : nowMinutes >= openMinutes && nowMinutes <= closeMinutes;
  return isOpen;
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; } catch { return []; }
}

function isFavorite(id) { return getFavorites().includes(id); }

function toggleFavorite(id, btn) {
  let favs = getFavorites();
  if (favs.includes(id)) {
    favs = favs.filter(f => f !== id);
    showToast('Removed from favorites');
  } else {
    favs.push(id);
    showToast('Saved to favorites');
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  if (btn) {
    const icon = btn.querySelector('i');
    icon.className = favs.includes(id) ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
  }
}

// ---------- card rendering ----------

function renderServiceCard(s) {
  const openStatus = computeOpenStatus(s.hours);
  const statusBadge = openStatus === null ? '' :
    `<span class="badge ${openStatus ? 'status-open' : 'status-closed'}">${openStatus ? 'Open now' : 'Closed'}</span>`;
  const distanceBadge = typeof s.distanceKm === 'number' ?
    `<span class="distance-chip"><i class="fa-solid fa-route"></i> ${s.distanceKm} km away</span>` : '';
  const ratingLine = typeof s.rating === 'number' ?
    `<p><span style="color:#d99a1a;">${starString(s.rating)}</span> ${s.rating.toFixed(1)}</p>` : '';
  const fav = isFavorite(s.id);

  return `
    <div class="card fade-in">
      <div class="card-top">
        <span class="badge ${s.type}">${s.type}</span>
        ${statusBadge}
      </div>
      <h3>${s.name}</h3>
      <p><i class="fa-solid fa-location-dot"></i> ${s.address}</p>
      ${s.contact ? `<p><i class="fa-solid fa-phone"></i> ${s.contact}</p>` : ''}
      ${s.hours ? `<p><i class="fa-regular fa-clock"></i> ${s.hours.open} – ${s.hours.close}</p>` : ''}
      ${s.languages && s.languages.length ? `<p><i class="fa-solid fa-language"></i> ${s.languages.join(', ')}</p>` : ''}
      ${s.services && s.services.length ? `<p><i class="fa-solid fa-stethoscope"></i> ${s.services.join(', ')}</p>` : ''}
      ${ratingLine}
      ${distanceBadge}
      <div class="card-actions">
        <button class="secondary" onclick="openShareModal(${s.id})"><i class="fa-solid fa-share"></i> Share</button>
        <button class="${fav ? '' : 'secondary'}" onclick="toggleFavorite(${s.id}, this)">
          <i class="fa-${fav ? 'solid' : 'regular'} fa-heart"></i> ${fav ? 'Saved' : 'Save'}
        </button>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address + ' Nyom')}" target="_blank" rel="noopener">
          <button class="secondary" type="button"><i class="fa-solid fa-map"></i> Map</button>
        </a>
      </div>
    </div>
  `;
}

function renderList(containerId, services, emptyMessage) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!services.length) {
    el.innerHTML = `<div class="empty-state">${emptyMessage || 'No results found.'}</div>`;
    return;
  }
  el.innerHTML = services.map(renderServiceCard).join('');
}

// ---------- share modal ----------

function openShareModal(id) {
  if (!getCurrentUser()) {
    showToast('Log in first to share a service', 'error');
    setTimeout(() => { window.location.href = 'login.html'; }, 900);
    return;
  }
  pendingShareServiceId = id;
  document.getElementById('shareModal').classList.add('show');
}

function closeShareModal() {
  document.getElementById('shareModal').classList.remove('show');
  document.getElementById('shareEmail').value = '';
  pendingShareServiceId = null;
}

async function confirmShare() {
  const email = document.getElementById('shareEmail').value.trim();
  if (!email) { showToast('Enter an email address', 'error'); return; }
  const res = await fetch('/services/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ serviceId: pendingShareServiceId, sharedWith: email })
  });
  if (res.ok) {
    showToast('Service shared!');
    closeShareModal();
  } else {
    const data = await res.json().catch(() => ({}));
    showToast(data.message || 'Could not share service', 'error');
  }
}

// ---------- home page: search + near me ----------

async function searchServices() {
  const name = document.getElementById('searchName')?.value || '';
  const type = document.getElementById('searchType')?.value || '';
  const language = document.getElementById('searchLanguage')?.value || '';

  const params = new URLSearchParams({ name, type, language });
  if (userCoords) {
    params.set('lat', userCoords.lat);
    params.set('lng', userCoords.lng);
  }
  const res = await fetch(`/services/search?${params}`);
  const data = await res.json();
  renderList('results', data, 'No services match your search — try a different filter.');

  const subtitle = document.getElementById('resultsSubtitle');
  if (subtitle) {
    subtitle.textContent = userCoords
      ? 'Sorted by distance from your current location'
      : 'Showing every registered health service in Nyom';
  }
}

function setActiveChip(type) {
  document.querySelectorAll('#typeChips .chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.type === type);
  });
}

function useMyLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by this browser', 'error');
    return;
  }
  const btn = document.getElementById('nearMeBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Locating...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Near me ✓';
      showToast('Location found — sorting by distance');
      searchServices();
    },
    () => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Near me';
      showToast('Could not get your location', 'error');
    }
  );
}

async function loadRecommendations() {
  const container = document.getElementById('recommendations');
  if (!container) return;
  const params = new URLSearchParams();
  if (userCoords) { params.set('lat', userCoords.lat); params.set('lng', userCoords.lng); }
  const res = await fetch(`/recommendations?${params}`);
  const data = await res.json();
  const toolbar = document.getElementById('recoToolbar');
  if (toolbar) toolbar.style.display = data.length ? '' : 'none';
  renderList('recommendations', data, '');
}

// ---------- services directory page ----------

async function loadServices() {
  const res = await fetch('/services');
  const data = await res.json();
  const sortBy = document.getElementById('sortBy')?.value || 'name';
  const sorted = [...data].sort((a, b) => {
    if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
    return a.name.localeCompare(b.name);
  });
  renderList('servicesList', sorted, 'No services registered yet.');
  const countLabel = document.getElementById('countLabel');
  if (countLabel) countLabel.textContent = `${data.length} service${data.length === 1 ? '' : 's'} registered`;
}

function refreshAddServiceHint() {
  const hint = document.getElementById('addServiceHint');
  const panel = document.getElementById('addServicePanel');
  if (!hint || !panel) return;
  const user = getCurrentUser();
  hint.textContent = user
    ? `Contributing as ${user.name}. Thanks for helping other travellers.`
    : 'You need to be logged in to add a service.';
}

async function addService() {
  if (!getCurrentUser()) {
    showToast('Log in first to add a service', 'error');
    setTimeout(() => { window.location.href = 'login.html'; }, 900);
    return;
  }
  const name = document.getElementById('newName').value.trim();
  const type = document.getElementById('newType').value;
  const address = document.getElementById('newAddress').value.trim();
  const contact = document.getElementById('newContact').value.trim();
  const languages = document.getElementById('newLanguages').value
    .split(',').map(l => l.trim()).filter(Boolean);

  if (!name || !address) {
    showToast('Name and address are required', 'error');
    return;
  }

  const res = await fetch('/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, type, address, contact, languages })
  });

  if (res.ok) {
    showToast('Service added — thank you!');
    document.getElementById('newName').value = '';
    document.getElementById('newAddress').value = '';
    document.getElementById('newContact').value = '';
    document.getElementById('newLanguages').value = '';
    loadServices();
  } else {
    const data = await res.json().catch(() => ({}));
    showToast(data.message || 'Could not add service', 'error');
  }
}

// ---------- auth page ----------

async function registerUser() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;

  if (!name || !email || !password) {
    showToast('Fill in name, email and password', 'error');
    return;
  }

  const res = await fetch('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, preferences: [] })
  });
  const data = await res.json();
  if (res.ok) {
    showToast(`Welcome, ${data.name}! Redirecting...`);
    setCurrentUser(data);
    setTimeout(() => { window.location.href = 'index.html'; }, 700);
  } else {
    showToast(data.message || 'Registration failed', 'error');
  }
}

async function loginUser() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  const resultEl = document.getElementById('loginResult');
  if (res.ok) {
    if (resultEl) resultEl.textContent = data.message;
    setCurrentUser(data.user);
    showToast(`Welcome back, ${data.user.name}!`);
    setTimeout(() => { window.location.href = 'index.html'; }, 700);
  } else {
    if (resultEl) resultEl.textContent = data.message;
    showToast(data.message || 'Login failed', 'error');
  }
}

// ---------- bootstrap ----------

document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();

  document.querySelectorAll('#typeChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.dataset.type;
      document.getElementById('searchType').value = type;
      setActiveChip(type);
      searchServices();
    });
  });

  if (document.getElementById('results')) {
    setActiveChip('');
    searchServices();
    loadRecommendations();
  }

  if (document.getElementById('servicesList')) {
    loadServices();
  }
});
