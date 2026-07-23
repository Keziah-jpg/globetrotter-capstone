// Render service card with Google Maps + actions
function renderServiceCard(s) {
  return `
    <div class="card fade-in">
      <h3>${s.name}</h3>
      <p><i class="fa-solid fa-location-dot"></i> ${s.address}</p>
      <p><i class="fa-solid fa-phone"></i> ${s.contact}</p>
      <p><i class="fa-regular fa-clock"></i> ${s.hours.open} - ${s.hours.close}</p>
      <p><i class="fa-solid fa-language"></i> ${s.languages.join(', ')}</p>
      <p><i class="fa-solid fa-stethoscope"></i> ${s.services.join(', ')}</p>
      <div class="card-actions">
        <button onclick="shareService(${s.id})"><i class="fa-solid fa-share"></i> Share</button>
        <button onclick="saveFavorite(${s.id})"><i class="fa-solid fa-heart"></i> Save</button>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}" target="_blank">
          <button><i class="fa-solid fa-map"></i> View on Map</button>
        </a>
      </div>
    </div>
  `;
}

// Search services
async function searchServices() {
  const name = document.getElementById('searchName').value;
  const type = document.getElementById('searchType').value;
  const language = document.getElementById('searchLanguage').value;

  const query = new URLSearchParams({ name, type, language });
  const res = await fetch(`/services/search?${query}`);
  const data = await res.json();

  const results = document.getElementById('results');
  results.innerHTML = '';
  if(data.length === 0) {
    results.innerHTML = `<div class="card"><h3>No results found</h3></div>`;
  }
  data.forEach(s => {
    results.innerHTML += renderServiceCard(s);
  });
}

// Register user
async function registerUser() {
  const name = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;

  const res = await fetch('/users', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ id: Date.now(), name, email, password, preferences: [] })
  });
  const data = await res.json();
  document.getElementById('loginResult').innerText = `Registered: ${data.name}`;
}

// Login user
async function loginUser() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  document.getElementById('loginResult').innerText = data.message;
  if(data.user) {
    localStorage.setItem('user', JSON.stringify(data.user));
    loadRecommendations();
  }
}

// Load services list
async function loadServices() {
  const res = await fetch('/services');
  const data = await res.json();
  const list = document.getElementById('servicesList');
  list.innerHTML = '';
  data.forEach(s => {
    list.innerHTML += renderServiceCard(s);
  });
}

// Share service
async function shareService(serviceId) {
  const email = prompt("Enter email to share with:");
  if(!email) return;
  await fetch('/services/share', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ serviceId, sharedWith: email })
  });
  alert("Service shared!");
}

// Save favorite
function saveFavorite(serviceId) {
  let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
  if(!favorites.includes(serviceId)) {
    favorites.push(serviceId);
    localStorage.setItem('favorites', JSON.stringify(favorites));
    alert("Saved to favorites!");
  }
}

// Load recommendations
async function loadRecommendations() {
  const res = await fetch('/recommendations');
  const data = await res.json();
  const results = document.getElementById('results');
  if(results) {
    results.innerHTML = '<h2>Recommended for you</h2>';
    data.forEach(s => {
      results.innerHTML += renderServiceCard(s);
    });
  }
}

// Auto-load services if on services page
document.addEventListener('DOMContentLoaded', () => {
  if(document.getElementById('servicesList')) {
    loadServices();
  }
});
