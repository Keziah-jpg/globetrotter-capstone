const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const PLACES_SERVICE_URL = process.env.PLACES_SERVICE_URL || 'http://localhost:4002';
const RECOMMENDATION_SERVICE_URL = process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:4003';
const ASSISTANT_SERVICE_URL = process.env.ASSISTANT_SERVICE_URL || 'http://localhost:4004';

// Aggregated metrics - the gateway fans this out to the services that own each count.
app.get('/metrics', async (req, res) => {
  const safe = async (url, fallback) => {
    try {
      const r = await fetch(url);
      return r.ok ? await r.json() : fallback;
    } catch {
      return fallback;
    }
  };
  const [userMetrics, placesMetrics] = await Promise.all([
    safe(`${USER_SERVICE_URL}/metrics`, { users: 0 }),
    safe(`${PLACES_SERVICE_URL}/metrics`, { services: 0, shares: 0 })
  ]);
  res.json({ users: userMetrics.users, services: placesMetrics.services, shares: placesMetrics.shares });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));

// ---- Routing table: single entry point, fans requests out to each microservice ----
app.use('/users', createProxyMiddleware({ target: USER_SERVICE_URL, changeOrigin: true }));
app.use('/login', createProxyMiddleware({ target: USER_SERVICE_URL, changeOrigin: true }));
app.use('/favorites', createProxyMiddleware({ target: USER_SERVICE_URL, changeOrigin: true }));
app.use('/visited', createProxyMiddleware({ target: USER_SERVICE_URL, changeOrigin: true }));
app.use('/services', createProxyMiddleware({ target: PLACES_SERVICE_URL, changeOrigin: true }));
app.use('/geofence', createProxyMiddleware({ target: PLACES_SERVICE_URL, changeOrigin: true }));
app.use('/nearby', createProxyMiddleware({ target: PLACES_SERVICE_URL, changeOrigin: true }));
app.use('/recommendations', createProxyMiddleware({ target: RECOMMENDATION_SERVICE_URL, changeOrigin: true }));
app.use('/assistant', createProxyMiddleware({
  target: ASSISTANT_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/assistant': '' }
}));

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nyom Locator API Gateway running on port ${PORT}`));
