const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://nyom:nyom_dev_password@localhost:5432/nyom'
});

// Wraps an async route handler so a thrown/rejected error reaches Express's
// error middleware instead of leaving the request hanging (Express 4 doesn't
// catch async errors on its own).
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// Postgres (not the JSON.parse/writeFileSync a monolith might use) is what
// makes this safe under real concurrent load: two requests writing to the
// SAME row are serialized by a row lock (see /favorites, /visited below)
// instead of racing to overwrite a whole shared file. Retries with backoff
// since Render doesn't guarantee this service starts after its database.
async function ensureSchema() {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS user_service');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_service.users (
          id BIGINT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          salt TEXT NOT NULL,
          hash TEXT NOT NULL,
          preferences JSONB NOT NULL DEFAULT '[]',
          favorites JSONB NOT NULL DEFAULT '[]',
          visited JSONB NOT NULL DEFAULT '[]'
        )
      `);
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
function publicUser(row) {
  return { id: Number(row.id), name: row.name, email: row.email, preferences: row.preferences || [] };
}

async function findUserByEmail(email) {
  const result = await pool.query('SELECT * FROM user_service.users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

// Register a new user
app.post('/users', ah(async (req, res) => {
  const { name, email, password, preferences } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email and password are required' });
  }
  const { salt, hash } = hashPassword(password);
  try {
    const result = await pool.query(
      `INSERT INTO user_service.users (id, name, email, salt, hash, preferences)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, preferences`,
      [Date.now(), name, email, salt, hash, JSON.stringify(preferences || [])]
    );
    res.json(publicUser(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Email already registered' });
    throw err;
  }
}));

// Login
app.post('/login', ah(async (req, res) => {
  const { email, password } = req.body;
  const user = await findUserByEmail(email);
  if (user && verifyPassword(password, user.salt, user.hash)) {
    res.json({ message: 'Login successful', user: publicUser(user) });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
}));

// Internal: used by other services to verify a x-user-email header belongs to a real,
// registered user (synchronous service-to-service REST call, e.g. from places-service
// on write routes, or assistant-service before saving chat history).
app.get('/internal/users/by-email/:email', ah(async (req, res) => {
  const user = await findUserByEmail(req.params.email);
  if (!user) return res.status(404).json({ message: 'Not found' });
  res.json(publicUser(user));
}));

// Auth guard for the "my places" routes below - expects x-user-email of a registered user
const requireAuth = ah(async (req, res, next) => {
  const email = req.headers['x-user-email'];
  if (!email) return res.status(401).json({ message: 'Login required' });
  const user = await findUserByEmail(email);
  if (!user) return res.status(401).json({ message: 'Invalid user' });
  req.authUser = user;
  next();
});

// Saved / favorited places - toggles a placeId on and off the caller's list.
// SELECT ... FOR UPDATE locks this one user's row for the transaction, so two
// concurrent toggles from the same account are serialized correctly instead of
// one silently overwriting the other - while other users' rows stay untouched
// and can be written in parallel.
app.post('/favorites', requireAuth, ah(async (req, res) => {
  const { placeId } = req.body;
  if (placeId === undefined) return res.status(400).json({ message: 'placeId is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT favorites FROM user_service.users WHERE email = $1 FOR UPDATE', [req.authUser.email]);
    const current = result.rows[0].favorites || [];
    const favorites = current.includes(placeId) ? current.filter(id => id !== placeId) : [...current, placeId];
    await client.query('UPDATE user_service.users SET favorites = $1 WHERE email = $2', [JSON.stringify(favorites), req.authUser.email]);
    await client.query('COMMIT');
    res.json({ favorites });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

app.get('/favorites', requireAuth, ah(async (req, res) => {
  res.json({ favorites: req.authUser.favorites || [] });
}));

// Visited places - idempotent add with a timestamp, used both by the "Mark as visited"
// button and by the frontend's automatic geofence-proximity detection. Same row-lock
// pattern as /favorites above.
app.post('/visited', requireAuth, ah(async (req, res) => {
  const { placeId } = req.body;
  if (placeId === undefined) return res.status(400).json({ message: 'placeId is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT visited FROM user_service.users WHERE email = $1 FOR UPDATE', [req.authUser.email]);
    let visited = result.rows[0].visited || [];
    if (!visited.some(v => v.placeId === placeId)) {
      visited = [...visited, { placeId, visitedAt: new Date().toISOString() }];
      await client.query('UPDATE user_service.users SET visited = $1 WHERE email = $2', [JSON.stringify(visited), req.authUser.email]);
    }
    await client.query('COMMIT');
    res.json({ visited });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

app.get('/visited', requireAuth, ah(async (req, res) => {
  res.json({ visited: req.authUser.visited || [] });
}));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'user-service' }));
app.get('/metrics', ah(async (req, res) => {
  const result = await pool.query('SELECT COUNT(*) FROM user_service.users');
  res.json({ users: Number(result.rows[0].count) });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal error' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 4001;
  app.listen(PORT, () => console.log(`user-service listening on ${PORT}`));
}
app.pool = pool; // exposed so tests can pool.end() and let Jest exit cleanly
module.exports = app;
