const request = require('supertest');
const app = require('../src/server');

describe('Nyom Health API', ()=>{
  it('GET /services should return array', async ()=>{
    const res = await request(app).get('/services');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /users should register user', async ()=>{
    const res = await request(app)
      .post('/users')
      .send({ id: 1, name: "Alice", email: "alice@example.com", password: "1234", preferences: ["hospital"] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('name', 'Alice');
  });

  it('POST /login should authenticate user', async ()=>{
    const res = await request(app)
      .post('/login')
      .send({ email: "alice@example.com", password: "1234" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('message', 'Login successful');
  });

  it('GET /recommendations should return popular services', async ()=>{
    const res = await request(app).get('/recommendations');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /metrics should return counts', async ()=>{
    const res = await request(app).get('/metrics');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('services');
    expect(res.body).toHaveProperty('shares');
  });
});
