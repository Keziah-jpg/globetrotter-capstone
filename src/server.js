const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../data', file)));
}
function writeJson(file, data) {
  fs.writeFileSync(path.join(__dirname, '../data', file), JSON.stringify(data, null, 2));
}

// Password hashing (Node's built-in scrypt - no external dependency)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, preferences: u.preferences || [] };
}

// Auth guard for write routes - expects x-user-email of a registered user
function requireAuth(req, res, next) {
  const email = req.headers['x-user-email'];
  if (!email) return res.status(401).json({ message: 'Login required' });
  const users = readJson('users.json');
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ message: 'Invalid user' });
  req.authUser = user;
  next();
}

// Haversine distance in km
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Attach distanceKm and sort by it when lat/lng are provided
function withDistance(services, lat, lng) {
  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    return services;
  }
  return services
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

// Register user
app.post('/users', (req, res) => {
  const { name, email, password, preferences } = req.body;
  let users = readJson('users.json');
  if (users.find(u => u.email === email)) {
    return res.status(409).json({ message: 'Email already registered' });
  }
  const { salt, hash } = hashPassword(password);
  const user = { id: Date.now(), name, email, salt, hash, preferences: preferences || [] };
  users.push(user);
  writeJson('users.json', users);
  res.json(publicUser(user));
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  let users = readJson('users.json');
  const user = users.find(u => u.email === email);
  if (user && verifyPassword(password, user.salt, user.hash)) {
    res.json({ message: 'Login successful', user: publicUser(user) });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

// Add a place (auth required)
app.post('/services', requireAuth, (req, res) => {
  let services = readJson('services.json');
  const nextId = services.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  const service = {
    id: nextId,
    rating: 0,
    popular: false,
    ...req.body,
  };
  services.push(service);
  writeJson('services.json', services);
  res.json(service);
});

// Update a place (auth required)
app.put('/services/:id', requireAuth, (req, res) => {
  let services = readJson('services.json');
  const id = parseInt(req.params.id, 10);
  const idx = services.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ message: 'Not found' });
  services[idx] = { ...services[idx], ...req.body, id };
  writeJson('services.json', services);
  res.json(services[idx]);
});

// Delete a place (auth required)
app.delete('/services/:id', requireAuth, (req, res) => {
  let services = readJson('services.json');
  const id = parseInt(req.params.id, 10);
  const exists = services.some(s => s.id === id);
  if (!exists) return res.status(404).json({ message: 'Not found' });
  services = services.filter(s => s.id !== id);
  writeJson('services.json', services);
  res.json({ message: 'Deleted' });
});

// View all places (optional ?lat=&lng= for distance sort)
app.get('/services', (req, res) => {
  const { lat, lng } = parseLatLng(req.query);
  res.json(withDistance(readJson('services.json'), lat, lng));
});

// Search places
app.get('/services/search', (req, res) => {
  const { type, name, language } = req.query;
  const { lat, lng } = parseLatLng(req.query);
  let services = readJson('services.json');
  const q = name ? name.toLowerCase() : '';
  let results = services.filter(s => {
    const matchesQuery = !q ||
      s.name.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q) ||
      s.address.toLowerCase().includes(q);
    return matchesQuery &&
      (!type || s.type === type) &&
      (!language || s.languages.includes(language));
  });
  res.json(withDistance(results, lat, lng));
});

// Get a single place
app.get('/services/:id', (req, res) => {
  const services = readJson('services.json');
  const service = services.find(s => s.id === parseInt(req.params.id, 10));
  if (!service) return res.status(404).json({ message: 'Not found' });
  res.json(service);
});

// Share a place (auth required)
app.post('/services/share', requireAuth, (req, res) => {
  let shares = readJson('shares.json');
  const share = { ...req.body, sharedBy: req.authUser.email, sharedAt: new Date().toISOString() };
  shares.push(share);
  writeJson('shares.json', shares);
  res.json(share);
});

// Recommendations - popular places (optional ?lat=&lng=)
app.get('/recommendations', (req, res) => {
  const { lat, lng } = parseLatLng(req.query);
  const services = readJson('services.json');
  const popular = services.filter(s => s.popular);
  res.json(withDistance(popular, lat, lng));
});

// Metrics
app.get('/metrics', (req, res) => {
  res.json({
    users: readJson('users.json').length,
    services: readJson('services.json').length,
    shares: readJson('shares.json').length
  });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Nyom Locator API running on port ${PORT}`));
}
module.exports = app;
