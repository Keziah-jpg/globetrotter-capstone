const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://nyom:nyom_dev_password@localhost:5432/nyom'
});

// Some deployment targets hand inter-service URLs over as a bare "host:port"
// with no protocol, while others (Docker Compose) give a full "http://host:port" -
// normalize so the same code works unchanged either way.
function withProtocol(url) {
  return url.includes('://') ? url : `http://${url}`;
}

const USER_SERVICE_URL = withProtocol(process.env.USER_SERVICE_URL || 'http://localhost:4001');

// Nyom, Yaoundé - real-world geofence used by the frontend to tell a user
// whether their live GPS position is inside Nyom or not.
const NYOM_GEOFENCE = {
  name: 'Nyom, Yaoundé',
  center: { lat: 3.9500, lng: 11.5200 },
  radiusKm: 4
};

const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// Postgres (not JSON files) is what makes writes here safe under real
// concurrent load - see /services/:id PUT below for the row-lock pattern.
// The seed places.json is still the source of truth for initial data (all the
// real, OSM-verified Nyom places researched for this project); it's loaded
// into the table once, the first time the table is empty. Retries with backoff
// since Render doesn't guarantee this service starts after its database.
async function ensureSchema() {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS places_service');
      await pool.query('CREATE TABLE IF NOT EXISTS places_service.places (id INTEGER PRIMARY KEY, data JSONB NOT NULL)');
      await pool.query('CREATE SEQUENCE IF NOT EXISTS places_service.places_id_seq');
      await pool.query('CREATE TABLE IF NOT EXISTS places_service.shares (id SERIAL PRIMARY KEY, data JSONB NOT NULL)');

      const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM places_service.places');
      if (Number(count) === 0) {
        const seedPath = path.join(__dirname, 'data', 'places.json');
        const seedPlaces = JSON.parse(fs.readFileSync(seedPath));
        for (const place of seedPlaces) {
          const { id, ...rest } = place;
          await pool.query(
            'INSERT INTO places_service.places (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
            [id, JSON.stringify(rest)]
          );
        }
      }
      const { rows: [{ max }] } = await pool.query('SELECT COALESCE(MAX(id), 0) AS max FROM places_service.places');
      await pool.query(`SELECT setval('places_service.places_id_seq', $1, true)`, [Math.max(Number(max), 1)]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}
const dbReady = ensureSchema();

app.use(express.json());
app.use(ah(async (req, res, next) => { await dbReady; next(); }));

function toPlace(row) {
  return { id: row.id, ...row.data };
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

app.post('/services', requireAuth, ah(async (req, res) => {
  const { rows: [{ nextval }] } = await pool.query(`SELECT nextval('places_service.places_id_seq') AS nextval`);
  const id = Number(nextval);
  const service = { rating: 0, popular: false, ...req.body };
  delete service.id;
  await pool.query('INSERT INTO places_service.places (id, data) VALUES ($1, $2)', [id, JSON.stringify(service)]);
  res.json({ id, ...service });
}));

// SELECT ... FOR UPDATE locks this one place's row for the transaction, so two
// concurrent edits to the SAME place are serialized correctly instead of one
// silently overwriting the other - while edits to different places (or reads)
// aren't blocked at all.
app.put('/services/:id', requireAuth, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT data FROM places_service.places WHERE id = $1 FOR UPDATE', [id]);
    if (!result.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Not found' }); }
    const updated = { ...result.rows[0].data, ...req.body };
    delete updated.id;
    await client.query('UPDATE places_service.places SET data = $1 WHERE id = $2', [JSON.stringify(updated), id]);
    await client.query('COMMIT');
    res.json({ id, ...updated });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

app.delete('/services/:id', requireAuth, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await pool.query('DELETE FROM places_service.places WHERE id = $1', [id]);
  if (result.rowCount === 0) return res.status(404).json({ message: 'Not found' });
  res.json({ message: 'Deleted' });
}));

app.get('/services', ah(async (req, res) => {
  const { lat, lng } = parseLatLng(req.query);
  const result = await pool.query('SELECT id, data FROM places_service.places ORDER BY id');
  res.json(withDistance(result.rows.map(toPlace), lat, lng));
}));

app.get('/services/search', ah(async (req, res) => {
  const { type, name, language } = req.query;
  const { lat, lng } = parseLatLng(req.query);
  const result = await pool.query('SELECT id, data FROM places_service.places');
  const q = name ? name.toLowerCase() : '';
  const results = result.rows.map(toPlace).filter(s => {
    const matchesQuery = !q ||
      s.name.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q) ||
      s.address.toLowerCase().includes(q);
    return matchesQuery && (!type || s.type === type) && (!language || s.languages.includes(language));
  });
  res.json(withDistance(results, lat, lng));
}));

app.get('/services/:id', ah(async (req, res) => {
  const result = await pool.query('SELECT id, data FROM places_service.places WHERE id = $1', [parseInt(req.params.id, 10)]);
  if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
  res.json(toPlace(result.rows[0]));
}));

app.post('/services/share', requireAuth, ah(async (req, res) => {
  const share = { ...req.body, sharedBy: req.authUser.email, sharedAt: new Date().toISOString() };
  await pool.query('INSERT INTO places_service.shares (data) VALUES ($1)', [JSON.stringify(share)]);
  res.json(share);
}));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'places-service' }));
app.get('/metrics', ah(async (req, res) => {
  const places = await pool.query('SELECT COUNT(*) FROM places_service.places');
  const shares = await pool.query('SELECT COUNT(*) FROM places_service.shares');
  res.json({ services: Number(places.rows[0].count), shares: Number(shares.rows[0].count) });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal error' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 4002;
  app.listen(PORT, () => console.log(`places-service listening on ${PORT}`));
}
app.pool = pool; // exposed so tests can pool.end() and let Jest exit cleanly
module.exports = app;
