const fs = require('fs');
const os = require('os');
const path = require('path');

// Run against a scratch copy of the seed data so tests never mutate the
// committed data/*.json files (services.json is real seed data; users.json
// and shares.json are runtime files that don't exist in a fresh clone).
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyom-test-'));
fs.copyFileSync(
  path.join(__dirname, '../data/services.json'),
  path.join(tmpDataDir, 'services.json')
);
process.env.DATA_DIR = tmpDataDir;

const request = require('supertest');
const app = require('../src/server');

const testUser = { name: 'Alice', email: 'alice@example.com', password: '1234', preferences: ['hospital'] };

describe('Nyom Health API', () => {
  it('GET /services should return an array with seeded services', async () => {
    const res = await request(app).get('/services');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET /services?lat=&lng= should attach distanceKm and sort by nearest', async () => {
    const res = await request(app).get('/services?lat=3.8730&lng=11.4680');
    expect(res.statusCode).toBe(200);
    expect(res.body[0]).toHaveProperty('distanceKm');
    for (let i = 1; i < res.body.length; i++) {
      expect(res.body[i].distanceKm).toBeGreaterThanOrEqual(res.body[i - 1].distanceKm);
    }
  });

  it('GET /services/search filters by type', async () => {
    const res = await request(app).get('/services/search?type=pharmacy');
    expect(res.statusCode).toBe(200);
    expect(res.body.every(s => s.type === 'pharmacy')).toBe(true);
  });

  it('POST /users rejects incomplete payloads', async () => {
    const res = await request(app).post('/users').send({ email: 'nobody@example.com' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /users should register a user without leaking the password', async () => {
    const res = await request(app).post('/users').send(testUser);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('name', 'Alice');
    expect(res.body).not.toHaveProperty('password');
  });

  it('POST /users rejects a duplicate email', async () => {
    const res = await request(app).post('/users').send(testUser);
    expect(res.statusCode).toBe(409);
  });

  it('POST /login rejects wrong credentials', async () => {
    const res = await request(app).post('/login').send({ email: testUser.email, password: 'wrong' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /login should authenticate with the right password', async () => {
    const res = await request(app).post('/login').send({ email: testUser.email, password: testUser.password });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('message', 'Login successful');
  });

  it('POST /services without an x-user-email header is rejected', async () => {
    const res = await request(app).post('/services').send({ name: 'Test Clinic', type: 'clinic', address: 'Somewhere' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /services with a known user creates a service, and it is retrievable by id', async () => {
    const createRes = await request(app)
      .post('/services')
      .set('x-user-email', testUser.email)
      .send({ name: 'Test Clinic', type: 'clinic', address: 'Somewhere in Nyom' });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body).toHaveProperty('id');

    const getRes = await request(app).get(`/services/${createRes.body.id}`);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toHaveProperty('name', 'Test Clinic');
  });

  it('DELETE /services/:id requires auth and removes the service', async () => {
    const createRes = await request(app)
      .post('/services')
      .set('x-user-email', testUser.email)
      .send({ name: 'Temp Pharmacy', type: 'pharmacy', address: 'Nyom' });

    const unauthedDelete = await request(app).delete(`/services/${createRes.body.id}`);
    expect(unauthedDelete.statusCode).toBe(401);

    const deleteRes = await request(app)
      .delete(`/services/${createRes.body.id}`)
      .set('x-user-email', testUser.email);
    expect(deleteRes.statusCode).toBe(200);

    const getRes = await request(app).get(`/services/${createRes.body.id}`);
    expect(getRes.statusCode).toBe(404);
  });

  it('POST /services/share requires auth', async () => {
    const res = await request(app).post('/services/share').send({ serviceId: 1, sharedWith: 'friend@example.com' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /services/share works for a logged-in user', async () => {
    const res = await request(app)
      .post('/services/share')
      .set('x-user-email', testUser.email)
      .send({ serviceId: 1, sharedWith: 'friend@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('sharedBy', testUser.email);
  });

  it('GET /recommendations should return only popular services', async () => {
    const res = await request(app).get('/recommendations');
    expect(res.statusCode).toBe(200);
    expect(res.body.every(s => s.popular)).toBe(true);
  });

  it('GET /metrics should return counts', async () => {
    const res = await request(app).get('/metrics');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('services');
    expect(res.body).toHaveProperty('shares');
  });
});
