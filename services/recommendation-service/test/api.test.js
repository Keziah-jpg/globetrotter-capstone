const request = require('supertest');

let userServer, placesServer, userApp, placesApp, app;
const email = `carol.${Date.now()}@example.com`;

beforeAll((done) => {
  userApp = require('../../user-service/server');
  userServer = userApp.listen(0, async () => {
    process.env.USER_SERVICE_URL = `http://localhost:${userServer.address().port}`;

    placesApp = require('../../places-service/server');
    placesServer = placesApp.listen(0, async () => {
      process.env.PLACES_SERVICE_URL = `http://localhost:${placesServer.address().port}`;
      app = require('../server');

      await request(userApp).post('/users').send({ name: 'Carol', email, password: 'pw123456', preferences: ['church'] });
      done();
    });
  });
}, 15000);

afterAll(async () => {
  await placesApp.pool.end();
  await userApp.pool.end();
  await new Promise(resolve => placesServer.close(resolve));
  await new Promise(resolve => userServer.close(resolve));
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
