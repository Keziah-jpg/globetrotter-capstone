const request = require('supertest');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'users.json');
const app = require('../server');

const email = `alice.${Date.now()}@example.com`;

afterAll(() => {
  // leave the data file empty for the next test run
  if (fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
});

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
});
