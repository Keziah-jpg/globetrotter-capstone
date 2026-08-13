const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const CHATS_FILE = path.join(__dirname, 'data', 'chats.json');
const PLACES_SERVICE_URL = process.env.PLACES_SERVICE_URL || 'http://localhost:4002';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';

app.use(express.json());

function readChats() {
  if (!fs.existsSync(CHATS_FILE)) return {};
  return JSON.parse(fs.readFileSync(CHATS_FILE));
}
function writeChats(chats) {
  fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
}

const SYSTEM_PROMPT = `You are the Nyom Locator assistant, embedded in a directory app for essential
places in Nyom, a neighborhood of Yaoundé, Cameroon: hospitals, clinics, pharmacies, markets,
police stations, churches, hotels, restaurants, fuel stations, recreation spots and banks.

You will be given a block of REAL DATA retrieved from the app's own places directory, followed by
the user's question. Answer ONLY using that data - never invent a name, address, phone number or
opening hours. If the data block is empty or doesn't answer the question, say plainly that you
couldn't find a matching place in Nyom, instead of guessing.

Be concise (2-4 sentences). When you recommend a place, name it exactly as it appears in the data
so the app can link straight to it on the map.`;

// Simple keyword -> category matcher. Ollama/small local models' tool-calling isn't reliable enough for a
// free local model, so retrieval is done here in plain code (a small, deterministic RAG step)
// instead of asking the model to call a tool - the model only ever sees data we already fetched.
const TYPE_SYNONYMS = {
  hospital: ['hospital', 'emergency', 'surgery', 'maternity', 'accident'],
  clinic: ['clinic', 'doctor', 'consultation', 'dentist', 'pediatric'],
  pharmacy: ['pharmacy', 'pharmacie', 'medicine', 'medication', 'drug'],
  market: ['market', 'marche', 'marché', 'shopping', 'food', 'produce', 'groceries'],
  police: ['police', 'gendarmerie', 'security', 'station', 'crime', 'report'],
  church: ['church', 'parish', 'paroisse', 'mass', 'cathedral', 'worship', 'pray'],
  hotel: ['hotel', 'hôtel', 'room', 'stay', 'accommodation', 'lodging'],
  restaurant: ['restaurant', 'food', 'eat', 'dinner', 'lunch', 'meal'],
  fuel: ['fuel', 'petrol', 'gas', 'gasoline', 'diesel', 'station'],
  recreation: ['recreation', 'sport', 'sports', 'club', 'gym', 'fitness', 'play'],
  bank: ['bank', 'banque', 'atm', 'money', 'withdraw', 'deposit', 'transfer']
};

function detectType(message) {
  const q = message.toLowerCase();
  for (const [type, words] of Object.entries(TYPE_SYNONYMS)) {
    if (words.some(w => q.includes(w))) return type;
  }
  return null;
}

function isOpenNow(hours) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = hours.open.split(':').map(Number);
  const [ch, cm] = hours.close.split(':').map(Number);
  const openMin = oh * 60 + om, closeMin = ch * 60 + cm;
  if (closeMin <= openMin) return cur >= openMin || cur < closeMin;
  return cur >= openMin && cur < closeMin;
}

async function retrievePlaces(message, lat, lng) {
  const type = detectType(message);
  const qs = new URLSearchParams();
  if (!type) qs.set('name', message.slice(0, 60));
  if (type) qs.set('type', type);
  if (lat !== undefined) qs.set('lat', lat);
  if (lng !== undefined) qs.set('lng', lng);

  let r = await fetch(`${PLACES_SERVICE_URL}/services/search?${qs}`);
  let places = r.ok ? await r.json() : [];

  // Free-text search found nothing - fall back to the popular feed so the model
  // still has real data to ground a "closest I can suggest" style answer in.
  if (places.length === 0 && !type) {
    r = await fetch(`${PLACES_SERVICE_URL}/services${lat !== undefined ? `?lat=${lat}&lng=${lng}` : ''}`);
    places = r.ok ? (await r.json()).filter(p => p.popular) : [];
  }

  return places.slice(0, 5).map(p => ({
    id: p.id, name: p.name, type: p.type, address: p.address,
    lat: p.lat, lng: p.lng, rating: p.rating,
    distanceKm: p.distanceKm ?? null,
    openNow: isOpenNow(p.hours),
    hours: p.hours,
    description: p.description,
    reviews: (p.reviews || []).slice(0, 2)
  }));
}

function placesToContext(places) {
  if (!places.length) return '(no matching places found in the directory)';
  return places.map(p => (
    `- ${p.name} (${p.type}), ${p.address}. Hours ${p.hours.open}-${p.hours.close} ` +
    `(${p.openNow ? 'open now' : 'closed now'}). Rating ${p.rating}/5.` +
    `${p.distanceKm != null ? ` ${p.distanceKm}km away.` : ''}` +
    `${p.description ? ` ${p.description}` : ''}`
  )).join('\n');
}

async function askOllama(message, context) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `REAL DATA from Nyom Locator:\n${context}\n\nQuestion: ${message}` }
      ]
    })
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  return data.message?.content?.trim() || '';
}

// POST /assistant/ask { message, lat?, lng? } - x-user-email header optional
// (chat history is only persisted when the caller is logged in)
app.post('/ask', async (req, res) => {
  const { message, lat, lng } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ message: 'message is required' });
  const email = req.headers['x-user-email'];

  try {
    const places = await retrievePlaces(message, lat, lng);
    const context = placesToContext(places);
    let replyText;
    try {
      replyText = await askOllama(message, context);
    } catch (err) {
      return res.status(503).json({
        message: `AI assistant is not reachable. Make sure Ollama is installed and running on your machine (ollama serve) with the ${OLLAMA_MODEL} model pulled - see README for setup.`
      });
    }

    const reply = { reply: replyText || "I couldn't find anything for that - try rephrasing.", places };

    if (email) {
      const chats = readChats();
      const history = chats[email] || [];
      history.push({ role: 'user', content: message, ts: new Date().toISOString() });
      history.push({ role: 'assistant', content: reply.reply, places, ts: new Date().toISOString() });
      chats[email] = history;
      writeChats(chats);
    }

    res.json(reply);
  } catch (err) {
    res.status(502).json({ message: 'Assistant request failed', error: err.message });
  }
});

// GET /history - x-user-email header required
app.get('/history', async (req, res) => {
  const email = req.headers['x-user-email'];
  if (!email) return res.status(401).json({ message: 'Login required' });
  try {
    const r = await fetch(`${USER_SERVICE_URL}/internal/users/by-email/${encodeURIComponent(email)}`);
    if (!r.ok) return res.status(401).json({ message: 'Invalid user' });
  } catch (err) {
    return res.status(502).json({ message: 'user-service unavailable' });
  }
  const chats = readChats();
  res.json(chats[email] || []);
});

app.get('/health', async (req, res) => {
  let ollamaReachable = false;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    ollamaReachable = r.ok;
  } catch { /* not reachable */ }
  res.json({ status: 'ok', service: 'assistant-service', model: OLLAMA_MODEL, ollamaReachable });
});

if (require.main === module) {
  const PORT = process.env.PORT || 4004;
  app.listen(PORT, () => console.log(`assistant-service listening on ${PORT}`));
}
module.exports = app;
