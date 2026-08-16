const express = require('express');

const app = express();

// Render's private-network "hostport" reference gives just "host:port" with no
// protocol, while Docker Compose env vars are already a full "http://host:port" -
// normalize so the same code works unchanged on both.
function withProtocol(url) {
  return url.includes('://') ? url : `http://${url}`;
}

const PLACES_SERVICE_URL = withProtocol(process.env.PLACES_SERVICE_URL || 'http://localhost:4002');
const USER_SERVICE_URL = withProtocol(process.env.USER_SERVICE_URL || 'http://localhost:4001');

app.use(express.json());

// Recommendation Service owns no data of its own - it reads from
// places-service (and, when a user is known, user-service) over REST,
// exactly the "Recommendation Service calling User/Places Service" pattern.
app.get('/recommendations', async (req, res) => {
  try {
    const qs = new URLSearchParams();
    if (req.query.lat !== undefined) qs.set('lat', req.query.lat);
    if (req.query.lng !== undefined) qs.set('lng', req.query.lng);

    const placesRes = await fetch(`${PLACES_SERVICE_URL}/services?${qs}`);
    if (!placesRes.ok) return res.status(502).json({ message: 'places-service unavailable' });
    const places = await placesRes.json();

    let preferredTypes = [];
    const email = req.headers['x-user-email'];
    if (email) {
      const userRes = await fetch(`${USER_SERVICE_URL}/internal/users/by-email/${encodeURIComponent(email)}`);
      if (userRes.ok) {
        const user = await userRes.json();
        preferredTypes = user.preferences || [];
      }
    }

    let popular = places.filter(s => s.popular);
    if (preferredTypes.length) {
      // personalise: places matching the user's stored preferences rank first
      popular = popular.sort((a, b) => {
        const aMatch = preferredTypes.includes(a.type) ? 1 : 0;
        const bMatch = preferredTypes.includes(b.type) ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
        return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      });
    }

    res.json(popular);
  } catch (err) {
    res.status(502).json({ message: 'Failed to build recommendations', error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'recommendation-service' }));

if (require.main === module) {
  const PORT = process.env.PORT || 4003;
  app.listen(PORT, () => console.log(`recommendation-service listening on ${PORT}`));
}
module.exports = app;
