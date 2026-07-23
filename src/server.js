const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const app = express();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const EARTH_RADIUS_KM = 6371;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function withDistance(services, lat, lng) {
  if (lat === undefined || lng === undefined) return services;
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  if (Number.isNaN(userLat) || Number.isNaN(userLng)) return services;
  return services
    .map(s => ({
      ...s,
      distanceKm:
        typeof s.lat === 'number' && typeof s.lng === 'number'
          ? Math.round(distanceKm(userLat, userLng, s.lat, s.lng) * 10) / 10
          : null
    }))
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

// Very lightweight access control: write routes require a header identifying
// a registered user. Not a replacement for real sessions/JWTs, but it stops
// anonymous writes without adding a full auth stack under time pressure.
function requireUser(req, res, next) {
  const email = req.header('x-user-email');
  if (!email) return res.status(401).json({ message: 'Login required (missing x-user-email header)' });
  const users = readJson('users.json');
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ message: 'Unknown user' });
  req.user = user;
  next();
}

// ---------- Users ----------

app.post('/users', (req, res) => {
  const { name, email, password, preferences } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email and password are required' });
  }
  const users = readJson('users.json');
  if (users.some(u => u.email === email)) {
    return res.status(409).json({ message: 'Email already registered' });
  }
  const user = { id: Date.now(), name, email, password: bcrypt.hashSync(password, 10), preferences: preferences || [] };
  users.push(user);
  writeJson('users.json', users);
  const { password: _pw, ...safeUser } = user;
  res.json(safeUser);
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const users = readJson('users.json');
  const user = users.find(u => u.email === email);
  if (user && bcrypt.compareSync(password || '', user.password)) {
    const { password: _pw, ...safeUser } = user;
    res.json({ message: 'Login successful', user: safeUser });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

// ---------- Services ----------
// Static sub-paths (search, share, nearby) must be declared before the
// generic '/services/:id' route so Express doesn't treat them as an id.

app.get('/services/search', (req, res) => {
  const { type, name, language, lat, lng } = req.query;
  const services = readJson('services.json');
  const results = services.filter(s => {
    return (!type || s.type === type) &&
      (!name || s.name.toLowerCase().includes(name.toLowerCase())) &&
      (!language || s.languages.includes(language));
  });
  res.json(withDistance(results, lat, lng));
});

app.post('/services/share', requireUser, (req, res) => {
  const { serviceId, sharedWith } = req.body;
  if (!serviceId || !sharedWith) {
    return res.status(400).json({ message: 'serviceId and sharedWith are required' });
  }
  const shares = readJson('shares.json');
  const share = { id: Date.now(), serviceId, sharedWith, sharedBy: req.user.email, sharedAt: new Date().toISOString() };
  shares.push(share);
  writeJson('shares.json', shares);
  res.json(share);
});

app.get('/services', (req, res) => {
  const { lat, lng } = req.query;
  res.json(withDistance(readJson('services.json'), lat, lng));
});

app.post('/services', requireUser, (req, res) => {
  const { name, type, address } = req.body;
  if (!name || !type || !address) {
    return res.status(400).json({ message: 'name, type and address are required' });
  }
  const services = readJson('services.json');
  const service = {
    id: Date.now(),
    name,
    type,
    address,
    lat: typeof req.body.lat === 'number' ? req.body.lat : null,
    lng: typeof req.body.lng === 'number' ? req.body.lng : null,
    contact: req.body.contact || '',
    hours: req.body.hours || { open: '00:00', close: '23:59' },
    languages: Array.isArray(req.body.languages) ? req.body.languages : [],
    services: Array.isArray(req.body.services) ? req.body.services : [],
    rating: typeof req.body.rating === 'number' ? req.body.rating : null,
    popular: false,
    addedBy: req.user.email
  };
  services.push(service);
  writeJson('services.json', services);
  res.status(201).json(service);
});

app.get('/services/:id', (req, res) => {
  const service = readJson('services.json').find(s => String(s.id) === req.params.id);
  if (!service) return res.status(404).json({ message: 'Service not found' });
  res.json(service);
});

app.put('/services/:id', requireUser, (req, res) => {
  const services = readJson('services.json');
  const idx = services.findIndex(s => String(s.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ message: 'Service not found' });
  services[idx] = { ...services[idx], ...req.body, id: services[idx].id };
  writeJson('services.json', services);
  res.json(services[idx]);
});

app.delete('/services/:id', requireUser, (req, res) => {
  const services = readJson('services.json');
  const idx = services.findIndex(s => String(s.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ message: 'Service not found' });
  const [removed] = services.splice(idx, 1);
  writeJson('services.json', services);
  res.json(removed);
});

// ---------- Recommendations & metrics ----------

app.get('/recommendations', (req, res) => {
  const { lat, lng } = req.query;
  const services = readJson('services.json');
  const popular = services.filter(s => s.popular);
  res.json(withDistance(popular, lat, lng));
});

app.get('/metrics', (req, res) => {
  res.json({
    users: readJson('users.json').length,
    services: readJson('services.json').length,
    shares: readJson('shares.json').length
  });
});

if (require.main === module) {
  app.listen(3000, () => console.log('Nyom Health API running on port 3000'));
}
module.exports = app;
