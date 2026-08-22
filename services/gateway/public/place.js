let currentPlace = null;
let myFavorites = [];
let myVisited = [];

function getPlaceId() {
  return new URLSearchParams(window.location.search).get('id');
}

function reviewCardHtml(r) {
  return `
    <div class="review-card">
      <div class="d-flex justify-content-between align-items-start">
        <strong>${r.name}</strong>
        <span class="text-muted small">${r.date}</span>
      </div>
      ${starsHtml(r.rating)}
      <p class="mb-0 mt-1">${r.comment}</p>
    </div>`;
}

function renderPlace(p) {
  const meta = TYPE_META[p.type] || { icon: 'fa-map-pin', label: p.type };
  const open = isOpenNow(p.hours);
  const reviews = p.reviews || [];
  const avgReviewRating = reviews.length
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : p.rating;

  // Real photo when we have one verified; otherwise a gradient in this
  // place's own category colour (not a generic navy fallback) so the "no
  // photo" state still looks like a deliberate, on-brand design rather than
  // something broken - same principle as the placeholder cards elsewhere.
  const categoryColor = TYPE_COLOR[p.type] || '#0b2545';
  const heroStyle = p.image
    ? `background-image:linear-gradient(180deg, rgba(11,37,69,0.15), rgba(11,37,69,0.85)), url('${p.image}')`
    : `background-image:linear-gradient(135deg, ${categoryColor}, var(--navy))`;

  document.title = `${p.name} - Nyom Locator`;

  document.getElementById('placeContent').innerHTML = `
    <div class="place-hero" style="${heroStyle}">
      <div class="place-hero-inner">
        <span class="badge badge-type" data-type="${p.type}"><i class="fa-solid ${meta.icon}"></i> ${meta.label}</span>
        <h1>${p.name}</h1>
        <div class="place-hero-meta">
          ${starsHtml(avgReviewRating)}
          <span class="mx-2">&middot;</span>
          <span class="status-chip ${open ? 'open' : 'closed'}">${open ? 'Open now' : 'Closed'}</span>
        </div>
      </div>
    </div>

    <div class="row g-4 mt-1">
      <div class="col-lg-8">
        <div class="panel">
          <h2>About</h2>
          <p>${p.description || 'No description yet.'}</p>
          <h2>What they offer</h2>
          <div class="pill-list">${(p.services || []).map(s => `<span class="pill">${s}</span>`).join('')}</div>
        </div>
        <div class="panel">
          <h2>Reviews ${reviews.length ? `(${reviews.length})` : ''}</h2>
          ${reviews.length ? reviews.map(reviewCardHtml).join('') : '<p class="text-muted">No reviews yet - be the first to visit and tell us about it.</p>'}
        </div>
      </div>
      <div class="col-lg-4">
        <div class="panel">
          <h2>Details</h2>
          <p><i class="fa-solid fa-location-dot"></i> ${p.address}</p>
          <p><a href="tel:${(p.contact || '').replace(/\s/g, '')}"><i class="fa-solid fa-phone"></i> ${p.contact}</a></p>
          <p><i class="fa-regular fa-clock"></i> ${p.hours.open} - ${p.hours.close}</p>
          <p><i class="fa-solid fa-language"></i> ${(p.languages || []).join(', ')}</p>
        </div>
        <div class="panel">
          <h2>Actions</h2>
          <a href="map.html?place=${p.id}" class="btn btn-app-clay w-100 mb-2"><i class="fa-solid fa-route"></i> Get directions from where you are</a>
          <a href="${yangoBookingUrl(p.lat, p.lng)}" target="_blank" rel="noopener" class="btn w-100 mb-2" style="background:#ff2b04;color:#fff;">
            <i class="fa-solid fa-car-side"></i> Book a ride with Yango
          </a>
          <button id="saveBtn" class="btn btn-outline-secondary w-100 mb-2" onclick="toggleSave()"><i class="fa-regular fa-heart"></i> Save</button>
          <button id="shareBtn" class="btn btn-outline-secondary w-100 mb-2" onclick="sharePlace()"><i class="fa-solid fa-share"></i> Share</button>
          <button id="visitedBtn" class="btn btn-outline-secondary w-100" onclick="markVisited()"><i class="fa-regular fa-circle-check"></i> Mark as visited</button>
        </div>
      </div>
    </div>
  `;

  refreshActionButtons();
}

async function loadMyLists() {
  const user = currentUser();
  if (!user) { myFavorites = []; myVisited = []; return; }
  try {
    const [favRes, visRes] = await Promise.all([
      fetch('/favorites', { headers: authHeaders() }),
      fetch('/visited', { headers: authHeaders() })
    ]);
    myFavorites = favRes.ok ? (await favRes.json()).favorites : [];
    myVisited = visRes.ok ? (await visRes.json()).visited : [];
  } catch (e) { /* user-service unreachable */ }
}

function refreshActionButtons() {
  if (!currentPlace) return;
  const saveBtn = document.getElementById('saveBtn');
  const visitedBtn = document.getElementById('visitedBtn');
  const saved = myFavorites.includes(currentPlace.id);
  saveBtn.innerHTML = saved
    ? '<i class="fa-solid fa-heart"></i> Saved'
    : '<i class="fa-regular fa-heart"></i> Save';
  saveBtn.classList.toggle('btn-app-accent', saved);
  saveBtn.classList.toggle('btn-outline-secondary', !saved);

  const visit = myVisited.find(v => v.placeId === currentPlace.id);
  if (visit) {
    visitedBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Visited ${new Date(visit.visitedAt).toLocaleDateString()}`;
    visitedBtn.disabled = true;
  } else {
    visitedBtn.innerHTML = '<i class="fa-regular fa-circle-check"></i> Mark as visited';
    visitedBtn.disabled = false;
  }
}

async function toggleSave() {
  const user = currentUser();
  if (!user) { alert('Please log in to save places.'); return; }
  const res = await fetch('/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ placeId: currentPlace.id })
  });
  if (res.ok) {
    myFavorites = (await res.json()).favorites;
    refreshActionButtons();
  }
}

async function markVisited() {
  const user = currentUser();
  if (!user) { alert('Please log in to track places you have visited.'); return; }
  const res = await fetch('/visited', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ placeId: currentPlace.id })
  });
  if (res.ok) {
    myVisited = (await res.json()).visited;
    refreshActionButtons();
  }
}

// Real sharing: the native OS share sheet (WhatsApp, SMS, email...) where supported,
// falling back to copying a real deep link to the clipboard everywhere else.
async function sharePlace() {
  const url = `${window.location.origin}/place.html?id=${currentPlace.id}`;
  const shareData = {
    title: currentPlace.name,
    text: `${currentPlace.name} - ${currentPlace.address}, Nyom. Found it on Nyom Locator:`,
    url
  };
  if (navigator.share) {
    try { await navigator.share(shareData); return; } catch (e) { /* user cancelled */ return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    alert('Link copied! Paste it in WhatsApp, SMS or email to share this place.');
  } catch (e) {
    prompt('Copy this link to share this place:', url);
  }
}

async function loadPlace() {
  const id = getPlaceId();
  if (!id) {
    document.getElementById('placeContent').innerHTML = '<div class="alert alert-warning">No place specified.</div>';
    return;
  }
  const res = await fetch(`/services/${id}`);
  if (!res.ok) {
    document.getElementById('placeContent').innerHTML = '<div class="alert alert-warning">That place could not be found.</div>';
    return;
  }
  currentPlace = await res.json();
  await loadMyLists();
  renderPlace(currentPlace);
}

document.addEventListener('DOMContentLoaded', loadPlace);
