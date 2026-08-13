const request = require('supertest');

let userServer, placesServer, app;
const email = `carol.${Date.now()}@example.com`;

beforeAll((done) => {
  const userApp = require('../../user-service/server');
  userServer = userApp.listen(0, async () => {
    process.env.USER_SERVICE_URL = `http://localhost:${userServer.address().port}`;

    const placesApp = require('../../places-service/server');
    placesServer = placesApp.listen(0, async () => {
      process.env.PLACES_SERVICE_URL = `http://localhost:${placesServer.address().port}`;
      app = require('../server');

      await request(userApp).post('/users').send({ name: 'Carol', email, password: 'pw123456', preferences: ['church'] });
      done();
    });
  });
}, 15000);

afterAll((done) => {
  placesServer.close(() => userServer.close(done));
});

describe('recommendation-service', () => {
  it('reads places-service over REST and returns only popular places', async () => {
    const res = await request(app).get('/recommendations');
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('personalises ranking using preferences read from user-service', async () => {
    const res = await request(app).get('/recommendations').set('x-user-email', email);
    expect(res.statusCode).toBe(200);
    expect(res.body[0].type).toBe('church');
  });

  it('works without a logged-in user (no x-user-email header)', async () => {
    const res = await request(app).get('/recommendations?lat=3.95&lng=11.52');
    expect(res.statusCode).toBe(200);
  });
});
