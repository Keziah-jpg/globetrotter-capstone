const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const DATA_FILE = path.join(__dirname, 'data', 'users.json');

app.use(express.json());

function readUsers() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE));
}
function writeUsers(users) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

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

// Register a new user
app.post('/users', (req, res) => {
  const { name, email, password, preferences } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email and password are required' });
  }
  const users = readUsers();
  if (users.find(u => u.email === email)) {
    return res.status(409).json({ message: 'Email already registered' });
  }
  const { salt, hash } = hashPassword(password);
  const user = { id: Date.now(), name, email, salt, hash, preferences: preferences || [], favorites: [], visited: [] };
  users.push(user);
  writeUsers(users);
  res.json(publicUser(user));
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const users = readUsers();
  const user = users.find(u => u.email === email);
  if (user && verifyPassword(password, user.salt, user.hash)) {
    res.json({ message: 'Login successful', user: publicUser(user) });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

// Internal: used by other services to verify a x-user-email header belongs to a real,
// registered user (synchronous service-to-service REST call, e.g. from places-service
// on write routes, or assistant-service before saving chat history).
app.get('/internal/users/by-email/:email', (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.email === req.params.email);
  if (!user) return res.status(404).json({ message: 'Not found' });
  res.json(publicUser(user));
});

// Auth guard for the "my places" routes below - expects x-user-email of a registered user
function requireAuth(req, res, next) {
  const email = req.headers['x-user-email'];
  if (!email) return res.status(401).json({ message: 'Login required' });
  const users = readUsers();
  const idx = users.findIndex(u => u.email === email);
  if (idx === -1) return res.status(401).json({ message: 'Invalid user' });
  req.users = users;
  req.userIdx = idx;
  next();
}

// Saved / favorited places - toggles a placeId on and off the caller's list
app.post('/favorites', requireAuth, (req, res) => {
  const { placeId } = req.body;
  if (placeId === undefined) return res.status(400).json({ message: 'placeId is required' });
  const { users, userIdx } = req;
  const user = users[userIdx];
  user.favorites = user.favorites || [];
  const existingIdx = user.favorites.indexOf(placeId);
  if (existingIdx === -1) user.favorites.push(placeId);
  else user.favorites.splice(existingIdx, 1);
  writeUsers(users);
  res.json({ favorites: user.favorites });
});

app.get('/favorites', requireAuth, (req, res) => {
  res.json({ favorites: req.users[req.userIdx].favorites || [] });
});

// Visited places - idempotent add with a timestamp, used both by the "Mark as visited"
// button and by the frontend's automatic geofence-proximity detection
app.post('/visited', requireAuth, (req, res) => {
  const { placeId } = req.body;
  if (placeId === undefined) return res.status(400).json({ message: 'placeId is required' });
  const { users, userIdx } = req;
  const user = users[userIdx];
  user.visited = user.visited || [];
  if (!user.visited.some(v => v.placeId === placeId)) {
    user.visited.push({ placeId, visitedAt: new Date().toISOString() });
    writeUsers(users);
  }
  res.json({ visited: user.visited });
});

app.get('/visited', requireAuth, (req, res) => {
  res.json({ visited: req.users[req.userIdx].visited || [] });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'user-service' }));
app.get('/metrics', (req, res) => res.json({ users: readUsers().length }));

if (require.main === module) {
  const PORT = process.env.PORT || 4001;
  app.listen(PORT, () => console.log(`user-service listening on ${PORT}`));
}
module.exports = app;
