// Free stack: Leaflet + OpenStreetMap tiles for the map (no API key), the public
// OSRM demo server for turn-by-turn routing (no API key). Nothing here costs money.
const OSRM_BASE = 'https://router.project-osrm.org/route/v1';

let map = null;
let currentRoute = null;   // { steps: [...], stepIndex, profile }
let routeLayer = null;
let userMarker = null;
let voiceOn = false;
let lastUserPos = null;
let directionsProfile = 'walking';

function typeColor(type) {
  return {
    hospital: '#b91c1c', clinic: '#b45309', pharmacy: '#0f766e', market: '#a16207',
    police: '#1d4ed8', church: '#6d28d9', hotel: '#be185d', restaurant: '#c2410c',
    fuel: '#065f46', recreation: '#0891b2', bank: '#0d9488'
  }[type] || '#0b2545';
}

function dotIcon(type) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${typeColor(type)};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function buildPopupHtml(place) {
  const photo = place.image ? `<img src="${place.image}" alt="${place.name}" onerror="this.style.display='none'">` : '';
  return `
    <div class="map-popup">
      ${photo}
      <div class="body">
        <h4>${place.name}</h4>
        <p><i class="fa-solid fa-location-dot"></i> ${place.address}</p>
        <p><i class="fa-regular fa-clock"></i> ${place.hours.open} - ${place.hours.close}</p>
        <div class="d-flex gap-1 mt-2">
          <button class="btn btn-sm btn-app-accent flex-fill" onclick="startDirectionsTo(${place.id})">
            <i class="fa-solid fa-route"></i> Directions
          </button>
          <a class="btn btn-sm btn-app-clay flex-fill" href="place.html?id=${place.id}">
            <i class="fa-solid fa-circle-info"></i> Details
          </a>
        </div>
      </div>
    </div>`;
}

// Small, muted context markers for real nearby OpenStreetMap places (not part of
// the curated Nyom Locator directory) - just so the map doesn't look empty around
// our pins and shows the actual neighborhood. Fails silently if unavailable.
async function loadNearbyContext() {
  try {
    const res = await fetch('/nearby');
    const data = await res.json();
    (data.elements || []).forEach(p => {
      if (p.lat == null || p.lng == null || !p.name) return;
      L.circleMarker([p.lat, p.lng], {
        radius: 3, color: '#94a3b8', weight: 1, fillColor: '#cbd5e1', fillOpacity: 0.85
      }).addTo(map).bindTooltip(`${p.name}`, { direction: 'top' });
    });
  } catch (e) { /* decorative only - fine if the public Overpass API is slow/unavailable */ }
}

async function initMap() {
  map = L.map('mapContainer').setView([3.95, 11.52], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  const res = await fetch('/services');
  const places = await res.json();
  window.__places = places;

  places.forEach(place => {
    if (place.lat == null || place.lng == null) return;
    L.marker([place.lat, place.lng], { icon: dotIcon(place.type) })
      .addTo(map)
      .bindPopup(buildPopupHtml(place), { maxWidth: 240 })
      .bindTooltip(place.name, { permanent: true, direction: 'right', offset: [8, 0], className: 'place-label' });
  });

  loadNearbyContext(); // non-blocking - map is already usable without it

  // Deep link from the assistant chat / place cards: map.html?place=ID
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get('place');
  if (targetId) {
    const place = places.find(p => String(p.id) === targetId);
    if (place) {
      map.setView([place.lat, place.lng], 16);
      setTimeout(() => startDirectionsTo(place.id), 800);
    }
  }
}

function setDirectionsProfile(profile) {
  directionsProfile = profile;
  document.getElementById('profileWalking').classList.toggle('active', profile === 'walking');
  document.getElementById('profileDriving').classList.toggle('active', profile === 'driving');
  if (currentRoute) startDirectionsTo(currentRoute.place.id);
}

function startDirectionsTo(placeId) {
  const place = (window.__places || []).find(p => p.id === placeId);
  if (!place) return;
  if (!navigator.geolocation) { alert('Geolocation is not supported in this browser.'); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const origin = [pos.coords.longitude, pos.coords.latitude]; // OSRM wants lng,lat
    const dest = [place.lng, place.lat];
    await fetchDirections(origin, dest, place);
  }, () => alert('Could not get your current location for directions.'));
}

// Turns OSRM's maneuver codes into a readable instruction - OSRM (unlike Mapbox)
// doesn't ship a pre-built sentence, just type/modifier/street-name codes.
function describeStep(step) {
  const name = step.name && step.name.trim() ? step.name : 'the road';
  const m = step.maneuver;
  switch (m.type) {
    case 'depart': return `Head ${m.modifier ? m.modifier + ' ' : ''}on ${name}`;
    case 'arrive': return 'You have arrived at your destination';
    case 'roundabout':
    case 'rotary': return `Enter the roundabout${m.exit ? `, take exit ${m.exit}` : ''} onto ${name}`;
    case 'turn':
    case 'end of road':
    case 'fork':
    case 'merge': return `Turn ${m.modifier || 'ahead'} onto ${name}`;
    case 'new name': return `Continue onto ${name}`;
    default: return `Continue onto ${name}`;
  }
}

async function fetchDirections(origin, dest, place) {
  const url = `${OSRM_BASE}/${directionsProfile}/${origin.join(',')};${dest.join(',')}?steps=true&geometries=geojson&overview=full`;
  let data;
  try {
    const res = await fetch(url);
    data = await res.json();
  } catch (e) {
    alert('Could not reach the routing service. Check your internet connection.');
    return;
  }
  if (data.code !== 'Ok' || !data.routes || !data.routes.length) { alert('No route found.'); return; }
  const route = data.routes[0];

  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.geoJSON(route.geometry, { style: { color: '#0f766e', weight: 4 } }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });

  const steps = route.legs[0].steps.map(s => ({
    instruction: describeStep(s),
    location: [s.maneuver.location[1], s.maneuver.location[0]], // -> [lat, lng]
    distance: s.distance // meters from this step's start to its own maneuver point
  }));

  currentRoute = { steps, stepIndex: 0, place, totalDistance: route.distance, arrived: false };
  renderDirectionsPanel();
  document.getElementById('directionsIntro').classList.add('d-none');
  document.getElementById('directionsPanel').classList.remove('d-none');
  document.getElementById('arrivedBanner').classList.add('d-none');
  document.getElementById('directionsTarget').textContent = `To ${place.name}`;
  document.getElementById('directionsEta').textContent = `${Math.round(route.duration / 60)} min · ${(route.distance / 1000).toFixed(1)} km`;
  updateRouteProgress(null); // reset the bar; live position updates take it from here
  if (voiceOn) speak(steps[0].instruction);
}

// Sums the distance from the user's current position to the rest of the route:
// distance to the next maneuver point, plus every step's distance after that.
function computeRemainingDistanceM(lat, lng) {
  const { steps, stepIndex } = currentRoute;
  const toNextManeuver = haversineKm(lat, lng, steps[stepIndex].location[0], steps[stepIndex].location[1]) * 1000;
  let rest = 0;
  for (let i = stepIndex + 1; i < steps.length; i++) rest += steps[i].distance;
  return toNextManeuver + rest;
}

function updateRouteProgress(userLatLng) {
  const bar = document.getElementById('routeProgressBar');
  const text = document.getElementById('routeProgressText');
  if (!currentRoute) return;
  if (!userLatLng) { bar.style.width = '0%'; text.textContent = 'Waiting for your location…'; return; }

  const remainingM = Math.max(0, computeRemainingDistanceM(userLatLng[0], userLatLng[1]));
  const pct = currentRoute.totalDistance > 0
    ? Math.min(100, Math.round((1 - remainingM / currentRoute.totalDistance) * 100))
    : 0;
  bar.style.width = `${pct}%`;
  text.textContent = remainingM >= 1000
    ? `${(remainingM / 1000).toFixed(1)} km remaining`
    : `${Math.round(remainingM)} m remaining`;
}

function renderDirectionsPanel() {
  const box = document.getElementById('directionSteps');
  if (!currentRoute) { box.innerHTML = ''; return; }
  box.innerHTML = currentRoute.steps.map((step, i) => `
    <div class="direction-step ${i === currentRoute.stepIndex ? 'active' : ''}" id="step-${i}">
      <i class="fa-solid fa-arrow-turn-up"></i> ${step.instruction}
    </div>`).join('');
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
}

function toggleVoiceDirections() {
  voiceOn = !voiceOn;
  const btn = document.getElementById('speakToggle');
  btn.innerHTML = voiceOn
    ? '<i class="fa-solid fa-volume-xmark"></i> Stop speaking'
    : '<i class="fa-solid fa-volume-high"></i> Speak directions';
  if (voiceOn && currentRoute) {
    speak(currentRoute.steps[currentRoute.stepIndex].instruction);
  } else {
    window.speechSynthesis && window.speechSynthesis.cancel();
  }
}

function clearDirections() {
  currentRoute = null;
  voiceOn = false;
  window.speechSynthesis && window.speechSynthesis.cancel();
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  document.getElementById('directionsPanel').classList.add('d-none');
  document.getElementById('directionsIntro').classList.remove('d-none');
  document.getElementById('arrivedBanner').classList.add('d-none');
}

const NEXT_TURN_TRIGGER_M = 40;  // announce/advance a bit before you're literally on top of the turn
const ARRIVAL_RADIUS_M = 20;

// Real-time: as the live GPS position updates (from app.js's watchPosition),
// move the "you are here" dot, update the progress bar, and auto-advance + speak
// the next turn as the person actually walks/drives the route - all the way to arrival.
document.addEventListener('nyom:position', (e) => {
  const { lat, lng } = e.detail;
  lastUserPos = [lat, lng];
  if (!map) return;

  if (!userMarker) {
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.25);"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    userMarker = L.marker(lastUserPos, { icon }).addTo(map);
  } else {
    userMarker.setLatLng(lastUserPos);
  }

  if (!currentRoute || currentRoute.arrived) return;

  updateRouteProgress(lastUserPos);

  const remainingM = computeRemainingDistanceM(lat, lng);
  if (remainingM <= ARRIVAL_RADIUS_M) {
    currentRoute.arrived = true;
    document.getElementById('arrivedBanner').classList.remove('d-none');
    document.getElementById('routeProgressBar').style.width = '100%';
    document.getElementById('routeProgressText').textContent = `Arrived at ${currentRoute.place.name}`;
    if (voiceOn) speak(`You have arrived at ${currentRoute.place.name}.`);
    return;
  }

  const step = currentRoute.steps[currentRoute.stepIndex];
  const distToStep = haversineKm(lat, lng, step.location[0], step.location[1]) * 1000;
  if (distToStep < NEXT_TURN_TRIGGER_M && currentRoute.stepIndex < currentRoute.steps.length - 1) {
    currentRoute.stepIndex += 1;
    renderDirectionsPanel();
    document.getElementById(`step-${currentRoute.stepIndex}`)?.scrollIntoView({ block: 'nearest' });
    if (voiceOn) speak(currentRoute.steps[currentRoute.stepIndex].instruction);
  }
});

document.addEventListener('DOMContentLoaded', initMap);
