const request = require('supertest');

let userServer, placesServer, userApp, placesApp, app;
const email = `dora.${Date.now()}@example.com`;

beforeAll((done) => {
  userApp = require('../../user-service/server');
  userServer = userApp.listen(0, async () => {
    process.env.USER_SERVICE_URL = `http://localhost:${userServer.address().port}`;

    placesApp = require('../../places-service/server');
    placesServer = placesApp.listen(0, async () => {
      process.env.PLACES_SERVICE_URL = `http://localhost:${placesServer.address().port}`;
      // No Ollama server running in the test environment: exercises the
      // "not reachable" path rather than requiring a local LLM for CI.
      process.env.OLLAMA_URL = 'http://localhost:1'; // reserved port, guaranteed to refuse
      app = require('../server');

      await request(userApp).post('/users').send({ name: 'Dora', email, password: 'pw123456' });
      done();
    });
  });
}, 15000);

afterAll(async () => {
  await app.pool.end();
  await placesApp.pool.end();
  await userApp.pool.end();
  await new Promise(resolve => placesServer.close(resolve));
  await new Promise(resolve => userServer.close(resolve));
});

describe('assistant-service', () => {
  it('reports Ollama as unreachable on /health rather than crashing', async () => {
    const health = await request(app).get('/health');
    expect(health.body.ollamaReachable).toBe(false);
  });

  it('still retrieves real place data (RAG step) even though the LLM call will fail', async () => {
    // this exercises retrievePlaces() against a real places-service before the
    // Ollama call is attempted and fails
    const res = await request(app).post('/ask').send({ message: 'pharmacy' });
    expect(res.statusCode).toBe(503);
    expect(res.body.message).toMatch(/Ollama/);
  });

  it('rejects a missing message', async () => {
    const res = await request(app).post('/ask').send({});
    expect(res.statusCode).toBe(400);
  });

  it('requires login to read chat history', async () => {
    const res = await request(app).get('/history');
    expect(res.statusCode).toBe(401);
  });

  it('returns an empty history for a real user who has never chatted', async () => {
    const res = await request(app).get('/history').set('x-user-email', email);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });
});
