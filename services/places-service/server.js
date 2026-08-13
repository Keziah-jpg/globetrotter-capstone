const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PLACES_FILE = path.join(__dirname, 'data', 'places.json');
const SHARES_FILE = path.join(__dirname, 'data', 'shares.json');
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';

// Nyom, Yaoundé - real-world geofence used by the frontend to tell a user
// whether their live GPS position is inside Nyom or not.
const NYOM_GEOFENCE = {
  name: 'Nyom, Yaoundé',
  center: { lat: 3.9500, lng: 11.5200 },
  radiusKm: 4
};

app.use(express.json());

function readJson(file) {
  return JSON.parse(fs.readFileSync(file));
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Auth guard for write routes - verifies the x-user-email header against
// user-service over REST (real synchronous inter-service communication).
async function requireAuth(req, res, next) {
  const email = req.headers['x-user-email'];
  if (!email) return res.status(401).json({ message: 'Login required' });
  try {
    const r = await fetch(`${USER_SERVICE_URL}/internal/users/by-email/${encodeURIComponent(email)}`);
    if (!r.ok) return res.status(401).json({ message: 'Invalid user' });
    req.authUser = await r.json();
    next();
  } catch (err) {
    res.status(502).json({ message: 'user-service unavailable' });
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function withDistance(places, lat, lng) {
  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    return places;
  }
  return places
    .map(s => ({
      ...s,
      distanceKm: (s.lat != null && s.lng != null)
        ? Math.round(haversineKm(lat, lng, s.lat, s.lng) * 10) / 10
        : null
    }))
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

function parseLatLng(query) {
  const lat = query.lat !== undefined ? parseFloat(query.lat) : undefined;
  const lng = query.lng !== undefined ? parseFloat(query.lng) : undefined;
  return { lat, lng };
}

// Real nearby points of interest from OpenStreetMap (free, no key) - purely for
// map context so it doesn't look empty around the curated Nyom Locator places.
// Proxied server-side (not called directly from the browser) to avoid CORS and
// to cache the result, since Overpass is a shared public server we shouldn't hammer.
const NEARBY_BBOX = { south: 3.910, west: 11.495, north: 3.985, east: 11.535 };
let nearbyCache = null;

app.get('/nearby', async (req, res) => {
  if (nearbyCache) return res.json(nearbyCache);
  const { south, west, north, east } = NEARBY_BBOX;
  const query = `[out:json][timeout:20];(` +
    `node["name"]["amenity"](${south},${west},${north},${east});` +
    `node["name"]["shop"](${south},${west},${north},${east});` +
    `node["name"]["leisure"](${south},${west},${north},${east});` +
    `);out center;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      // Overpass rejects requests with no/blank User-Agent (406) - Node's default
      // fetch doesn't send one it accepts, so we set our own.
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'NyomLocatorCapstone/1.0 (student capstone project)' },
      body: query
    });
    if (!r.ok) return res.json({ elements: [] });
    const data = await r.json();
    const elements = (data.elements || [])
      .filter(e => e.tags && e.tags.name && e.lat && e.lon)
      .slice(0, 150)
      .map(e => ({
        name: e.tags.name,
        lat: e.lat,
        lng: e.lon,
        category: e.tags.amenity || e.tags.shop || e.tags.leisure || 'place'
      }));
    nearbyCache = { elements };
    res.json(nearbyCache);
  } catch (err) {
    // Decorative context only - fail soft rather than break the map.
    res.json({ elements: [] });
  }
});

// Geofence config - lets the frontend know if a live GPS fix is inside Nyom
app.get('/geofence', (req, res) => {
  const { lat, lng } = parseLatLng(req.query);
  const response = { ...NYOM_GEOFENCE };
  if (lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    const distanceKm = Math.round(haversineKm(lat, lng, NYOM_GEOFENCE.center.lat, NYOM_GEOFENCE.center.lng) * 10) / 10;
    response.distanceKm = distanceKm;
    response.insideNyom = distanceKm <= NYOM_GEOFENCE.radiusKm;
  }
  res.json(response);
});

app.post('/services', requireAuth, (req, res) => {
  const places = readJson(PLACES_FILE);
  const nextId = places.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  const service = { id: nextId, rating: 0, popular: false, ...req.body };
  places.push(service);
  writeJson(PLACES_FILE, places);
  res.json(service);
});

app.put('/services/:id', requireAuth, (req, res) => {
  const places = readJson(PLACES_FILE);
  const id = parseInt(req.params.id, 10);
  const idx = places.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ message: 'Not found' });
  places[idx] = { ...places[idx], ...req.body, id };
  writeJson(PLACES_FILE, places);
  res.json(places[idx]);
});

app.delete('/services/:id', requireAuth, (req, res) => {
  let places = readJson(PLACES_FILE);
  const id = parseInt(req.params.id, 10);
  if (!places.some(s => s.id === id)) return res.status(404).json({ message: 'Not found' });
  places = places.filter(s => s.id !== id);
  writeJson(PLACES_FILE, places);
  res.json({ message: 'Deleted' });
});

app.get('/services', (req, res) => {
  const { lat, lng } = parseLatLng(req.query);
  res.json(withDistance(readJson(PLACES_FILE), lat, lng));
});

app.get('/services/search', (req, res) => {
  const { type, name, language } = req.query;
  const { lat, lng } = parseLatLng(req.query);
  const places = readJson(PLACES_FILE);
  const q = name ? name.toLowerCase() : '';
  const results = places.filter(s => {
    const matchesQuery = !q ||
      s.name.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q) ||
      s.address.toLowerCase().includes(q);
    return matchesQuery && (!type || s.type === type) && (!language || s.languages.includes(language));
  });
  res.json(withDistance(results, lat, lng));
});

app.get('/services/:id', (req, res) => {
  const places = readJson(PLACES_FILE);
  const service = places.find(s => s.id === parseInt(req.params.id, 10));
  if (!service) return res.status(404).json({ message: 'Not found' });
  res.json(service);
});

app.post('/services/share', requireAuth, (req, res) => {
  const shares = readJson(SHARES_FILE);
  const share = { ...req.body, sharedBy: req.authUser.email, sharedAt: new Date().toISOString() };
  shares.push(share);
  writeJson(SHARES_FILE, shares);
  res.json(share);
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'places-service' }));
app.get('/metrics', (req, res) => res.json({
  services: readJson(PLACES_FILE).length,
  shares: readJson(SHARES_FILE).length
}));

if (require.main === module) {
  const PORT = process.env.PORT || 4002;
  app.listen(PORT, () => console.log(`places-service listening on ${PORT}`));
}
module.exports = app;
