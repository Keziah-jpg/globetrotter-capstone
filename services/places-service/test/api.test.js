const request = require('supertest');

const email = `bob.${Date.now()}@example.com`;

let userServer, app;

beforeAll((done) => {
  // Real cross-service call: places-service's write routes verify the
  // x-user-email header against a live user-service over HTTP.
  const userApp = require('../../user-service/server');
  userServer = userApp.listen(0, async () => {
    process.env.USER_SERVICE_URL = `http://localhost:${userServer.address().port}`;
    app = require('../server');
    await require('supertest')(userApp).post('/users').send({ name: 'Bob', email, password: 'pw123456' });
    done();
  });
}, 15000);

afterAll((done) => {
  userServer.close(done);
});

describe('places-service', () => {
  it('lists all places', async () => {
    const res = await request(app).get('/services');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('sorts by real distance when lat/lng are given (Haversine)', async () => {
    const res = await request(app).get('/services?lat=3.95&lng=11.52');
    expect(res.statusCode).toBe(200);
    const distances = res.body.map(p => p.distanceKm);
    const sorted = [...distances].sort((a, b) => a - b);
    expect(distances).toEqual(sorted);
  });

  it('searches by type', async () => {
    const res = await request(app).get('/services/search?type=pharmacy');
    expect(res.statusCode).toBe(200);
    expect(res.body.every(p => p.type === 'pharmacy')).toBe(true);
  });

  it('rejects writes with no auth header', async () => {
    const res = await request(app).post('/services').send({ name: 'Nope' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects writes from an unknown user', async () => {
    const res = await request(app)
      .post('/services')
      .set('x-user-email', 'ghost@example.com')
      .send({ name: 'Nope' });
    expect(res.statusCode).toBe(401);
  });

  it('allows create/update/delete for a real, registered user', async () => {
    const create = await request(app)
      .post('/services')
      .set('x-user-email', email)
      .send({
        name: 'Test Pharmacy', type: 'pharmacy', address: 'Test Rd',
        lat: 3.95, lng: 11.52, contact: '000',
        hours: { open: '08:00', close: '18:00' }, languages: ['French'], services: []
      });
    expect(create.statusCode).toBe(200);
    const id = create.body.id;

    const update = await request(app)
      .put(`/services/${id}`)
      .set('x-user-email', email)
      .send({ name: 'Renamed Pharmacy' });
    expect(update.statusCode).toBe(200);
    expect(update.body.name).toBe('Renamed Pharmacy');

    const del = await request(app).delete(`/services/${id}`).set('x-user-email', email);
    expect(del.statusCode).toBe(200);

    const gone = await request(app).get(`/services/${id}`);
    expect(gone.statusCode).toBe(404);
  });

  it('reports the Nyom geofence and correctly classifies inside vs outside', async () => {
    const inside = await request(app).get('/geofence?lat=3.95&lng=11.52');
    expect(inside.body.insideNyom).toBe(true);

    const outside = await request(app).get('/geofence?lat=6.5244&lng=3.3792'); // Lagos
    expect(outside.body.insideNyom).toBe(false);
  });

  it('reports counts on /metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.services).toBe('number');
  });
});
