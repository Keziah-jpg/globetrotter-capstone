const request = require('supertest');

// Requires a real Postgres reachable at DATABASE_URL (defaults to the one
// docker-compose.yml starts - run `docker compose up -d postgres` first).
// The server creates its own schema/table on startup if missing.
const app = require('../server');

const email = `alice.${Date.now()}@example.com`;

afterAll(() => app.pool.end());

describe('user-service', () => {
  it('registers a new user with a hashed password (never returned in plain text)', async () => {
    const res = await request(app)
      .post('/users')
      .send({ name: 'Alice', email, password: 'sup3rsecret', preferences: ['pharmacy'] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ name: 'Alice', email, preferences: ['pharmacy'] });
    expect(res.body.password).toBeUndefined();
    expect(res.body.hash).toBeUndefined();
  });

  it('rejects a duplicate email', async () => {
    const res = await request(app)
      .post('/users')
      .send({ name: 'Alice 2', email, password: 'whatever123' });
    expect(res.statusCode).toBe(409);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/login').send({ email, password: 'sup3rsecret' });
    expect(res.statusCode).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it('rejects login with the wrong password', async () => {
    const res = await request(app).post('/login').send({ email, password: 'wrong-password' });
    expect(res.statusCode).toBe(401);
  });

  it('exposes an internal lookup used by other services to verify auth', async () => {
    const ok = await request(app).get(`/internal/users/by-email/${encodeURIComponent(email)}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.email).toBe(email);

    const missing = await request(app).get('/internal/users/by-email/nobody@example.com');
    expect(missing.statusCode).toBe(404);
  });

  it('reports a user count on /metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.users).toBe('number');
  });

  it('requires login to save a favorite', async () => {
    const res = await request(app).post('/favorites').send({ placeId: 5 });
    expect(res.statusCode).toBe(401);
  });

  it('toggles a place on and off the favorites list', async () => {
    const add = await request(app).post('/favorites').set('x-user-email', email).send({ placeId: 5 });
    expect(add.statusCode).toBe(200);
    expect(add.body.favorites).toContain(5);

    const list = await request(app).get('/favorites').set('x-user-email', email);
    expect(list.body.favorites).toEqual([5]);

    const remove = await request(app).post('/favorites').set('x-user-email', email).send({ placeId: 5 });
    expect(remove.body.favorites).not.toContain(5);
  });

  it('records a visited place idempotently, with a timestamp', async () => {
    const first = await request(app).post('/visited').set('x-user-email', email).send({ placeId: 9 });
    expect(first.statusCode).toBe(200);
    expect(first.body.visited).toHaveLength(1);
    expect(first.body.visited[0]).toMatchObject({ placeId: 9 });
    expect(first.body.visited[0].visitedAt).toBeDefined();

    const second = await request(app).post('/visited').set('x-user-email', email).send({ placeId: 9 });
    expect(second.body.visited).toHaveLength(1); // no duplicate entry

    const list = await request(app).get('/visited').set('x-user-email', email);
    expect(list.body.visited).toHaveLength(1);
  });

  // This is the actual "accommodate 100 users" fix: with the old JSON-file
  // storage, N simultaneous writes did read-whole-file -> modify -> write-whole-
  // file with no locking, so concurrent requests could overwrite each other's
  // change (a lost update). Postgres's SELECT ... FOR UPDATE row lock in the
  // /favorites handler serializes writes to the SAME row instead, so this must
  // come out with all 25 toggles applied - not fewer.
  it('does not lose updates when many requests toggle favorites concurrently', async () => {
    const concurrentEmail = `concurrent.${Date.now()}@example.com`;
    await request(app).post('/users').send({ name: 'C', email: concurrentEmail, password: 'pw123456' });

    const placeIds = Array.from({ length: 25 }, (_, i) => i + 1);
    await Promise.all(placeIds.map(placeId =>
      request(app).post('/favorites').set('x-user-email', concurrentEmail).send({ placeId })
    ));

    const res = await request(app).get('/favorites').set('x-user-email', concurrentEmail);
    expect(res.body.favorites).toHaveLength(25);
    expect(res.body.favorites.slice().sort((a, b) => a - b)).toEqual(placeIds);
  });
});
