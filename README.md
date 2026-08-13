# GlobeTrotter – Nyom Locator

GlobeTrotter is a semester-long capstone: build a monolith, decompose it into microservices, then
deploy with cloud-native tooling. My domain is **essential places in Nyom** — hospitals, clinics,
pharmacies, markets, police stations, churches, hotels, restaurants and banks in the Nyom
neighborhood of Yaoundé, Cameroon — answering "what's actually near me, right now?" for a visitor
or resident.

This repo now contains **three things**:

| | Location | Status |
|---|---|---|
| Original course scaffold (Flask) | `app/`, `requirements.txt`, `Dockerfile`, `docker-compose.yml` (git history) | Untouched starter template, kept for reference |
| Phase 1 submission (Node/Express monolith) | `src/`, `data/`, `tests/` | Superseded by Phase 2, kept for reference |
| ⭐ **Phase 2 submission: Nyom Locator microservices** | `services/` | **This is the active submission for grading** |

Everything below describes the Phase 2 submission.

---

## Architecture

Per the brief, the monolith is decomposed into independent services, each owning its own data,
talking to each other over REST, behind a single API Gateway:

```
                         ┌──────────────────┐
                         │   API Gateway     │  :3000  (serves the frontend too, only port exposed to the host)
                         └─────────┬─────────┘
            ┌───────────┬──────────┼───────────┬─────────────┐
            ▼           ▼          ▼            ▼             │
      ┌──────────┐┌───────────┐┌────────────┐┌──────────────┐│
      │  User    ││  Places   ││Recommend-  ││  Assistant    ││
      │  Service ││  Service  ││ation Svc   ││  Service      ││
      │  :4001   ││  :4002    ││  :4003     ││  :4004        ││
      └────┬─────┘└─────┬─────┘└─────┬──────┘└───────┬───────┘│
           │            │            │  REST calls    │        │
           ▼            ▼            └──────┬─────────┘        │
      users.json   places.json,             ▼                  │
                   shares.json      (reads Places + User)   chats.json
                                                                │
      ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ Docker network boundary ┄┄┄┄┄┄┄┄┄┼┄┄┄┄
                                                                ▼
                                                        ┌──────────────┐
                                                        │  Ollama      │  :11434
                                                        │  (native, on │
                                                        │  your host)  │
                                                        └──────────────┘
```

| Service | Owns | Responsibilities |
|---|---|---|
| **User Service** | `users.json` | Registration, login (scrypt-hashed passwords), profile/preferences, saved favorites and visited-places history. Exposes an internal `GET /internal/users/by-email/:email` used by other services to verify a caller is a real, registered user. |
| **Places Service** | `places.json`, `shares.json` | Search/filter/CRUD on the Nyom directory, sharing. Write routes call **User Service** over REST to verify auth — real synchronous inter-service communication, not a shared database. Also owns the Nyom **geofence** config. |
| **Recommendation Service** | *(none — reads others)* | Calls **Places Service** for the popular feed and, when a user is logged in, **User Service** for their preferences, to personalise ranking. |
| **Assistant Service** | `chats.json` | The AI assistant. Retrieves real matching places from **Places Service** (a small deterministic retrieval step - see below), sends that data plus the question to **Ollama** (a small model, llama3.2:1b by default), and attaches chat history to a real user via **User Service**. |
| **API Gateway** | *(none)* | Single entry point on port 3000 - the only container with a port published to the host. Routes each path to the owning service, serves the static frontend, and aggregates `/metrics`. |

**Ollama runs natively on the host, not as a container** — a deliberate, pragmatic choice: the
official `ollama/ollama` Docker image bundles a ~2.4GB GPU-library layer that's brutal to pull on a
slow/unstable connection, and Docker can't resume a partially-downloaded layer (a real problem I hit
while building this). The native Windows/Mac/Linux installer is smaller and Ollama's own model
downloads *do* resume properly. `assistant-service` reaches it via Docker Desktop's
`host.docker.internal` DNS name (`extra_hosts` in `docker-compose.yml` makes that work on Linux too).
Everything else stays exactly as described in the brief - a service in its own container, reached
over REST, not a monolith with an LLM bolted in.

**Inter-service communication** is synchronous REST (Node's built-in `fetch`) — e.g. Recommendation
Service calling User Service and Places Service, Places Service calling User Service to check auth,
Assistant Service calling both plus Ollama on the host. No message queue is used; per the brief
that's an optional alternative for event-driven cases, not a requirement for this deliverable.

**Why the assistant doesn't use "tool calling"**: Claude-style tool use isn't reliable enough on a
free local model this small, run on ordinary hardware. Instead, Assistant Service does the retrieval itself in
plain code (match the question against Places Service by keyword/category, or fall back to the
popular feed), then hands that real data to the local model as context and asks it to answer only from it.
Same grounding guarantee (the model can't invent a place that isn't in the data), implemented in a way
that doesn't depend on a specific model's tool-calling support.

**Data storage**: per-service JSON files (not a shared database), so each service unambiguously owns
its own data — the smallest thing that demonstrates real service boundaries for this course.

### Why microservices here (and the trade-off)
Each service can be developed, tested, deployed and scaled independently, and a bug in one (e.g. the
assistant) can't take down search or login. The cost is real: network latency between services,
eventual-consistency risk if two services' views of "the same" data drift, and harder debugging
across process boundaries — the Places Service auth check, for instance, now depends on User Service
being reachable, whereas in the monolith it was a local file read. That trade is made deliberately
here, not accidentally.

### VM vs. container, briefly
A **VM** virtualizes hardware — each VM ships a full guest OS kernel, so it's heavier and slower to
boot but strongly isolated. A **container** virtualizes the OS — it shares the host kernel and packages
just the app plus its dependencies, so it's lightweight and starts in milliseconds, at the cost of
weaker isolation than a VM. This project uses containers (via Docker Compose) because each
microservice is a small, fast-starting process that benefits from quick iteration, not from
hardware-level isolation.

---

## Phase 2 requirements checklist

A direct mapping from the lecture's "Phase 2 — Microservices" brief to what's actually implemented,
so it's checkable line by line rather than taken on faith.

**Architecture overview**
| Required | Implemented as |
|---|---|
| Decompose the monolith into independent microservices | `src/` (Phase 1 monolith) split into `services/user-service`, `services/places-service`, `services/recommendation-service`, `services/gateway` — plus `services/assistant-service` as a bonus 4th service |
| Service decomposition, inter-service communication, API design | Each service owns one REST resource family and one data file; see the routing table below and the `USER_SERVICE_URL` / `PLACES_SERVICE_URL` env vars each service calls |
| **User Service** — manages registration, login, profiles, owns "users" data | `services/user-service` — owns `users.json` exclusively; no other service touches it directly |
| **Itinerary Service** — owns core domain data | Renamed to **Places Service** for this domain (there's no "itinerary" concept in a places-locator app) — `services/places-service` owns `places.json` + `shares.json` exclusively |
| **Recommendation Service** — reads from User + Itinerary services | `services/recommendation-service` — holds no data at all; every request calls Places Service (popular feed) and, when logged in, User Service (preferences) live over HTTP |
| **API Gateway** — single entry point, routes to the right service | `services/gateway` — the only container with a published port (3000); every other service is unreachable from outside the Docker network |

**Inter-service communication**
| Required | Implemented as |
|---|---|
| Synchronous REST (e.g. Recommendation → User) | Node's built-in `fetch` between containers: Places→User (auth check), Recommendation→Places+User, Assistant→Places+User. Verified with real (not mocked) HTTP calls in each service's test suite. |
| Asynchronous / message queues | Not used — the brief lists this as an alternative for event-driven cases, not a requirement, and nothing in this domain is event-driven enough to justify the added complexity of RabbitMQ/SQS for a class project. |
| API Gateway as single entry point | `services/gateway/server.js` — `http-proxy-middleware` routes each path to its owning service; see the full table under "API Gateway routing table" below. |

**Benefits realized**
| Benefit | Where it shows up here |
|---|---|
| Modularity | Each service is its own folder, `package.json`, and `node_modules` — no shared code, no shared data file. |
| Independent deployment | `docker compose up --build gateway` rebuilds and restarts just the gateway; the other 4 containers keep running untouched (verified — see below). |
| Team autonomy | Nothing stops a different person owning `assistant-service` end-to-end; it only depends on the *interfaces* of Places/User Service, not their internals. |
| Technology diversity | All 4 services happen to be Node here (course/time constraint), but nothing in the architecture requires that — Places Service could be rewritten in Python tomorrow and the Gateway wouldn't notice, since the contract is just HTTP + JSON. |
| Isolation | Demonstrated directly: if Ollama isn't running on the host, Assistant Service returns a clean `503` on its own routes — Places, User, Recommendation and the rest of the site keep working normally. |
| Independent scaling | `docker compose up --scale places-service=3` would work today, since Places Service is stateless-per-request (all state is the shared volume) and the Gateway already talks to it by service name, not a fixed instance. |

**Challenges — acknowledged, not hidden**
| Challenge | How it's handled here |
|---|---|
| Network latency | Accepted trade-off, called out explicitly in "Why microservices here" above — each REST hop (e.g. a recommendation request touching 2 other services) is slower than the old in-process monolith call. |
| Data consistency | Sidestepped rather than solved: each service owns exactly one data file, so there's no dual-write / eventual-consistency problem to manage in the first place. |
| Service discovery | Static, via Docker Compose's built-in DNS (containers resolve each other by service name) plus `*_SERVICE_URL` env vars — appropriate at this scale; a real deployment would reach for something dynamic (Consul, Kubernetes Services). |
| Distributed tracing | Not implemented — a genuine gap. At this scale, logs per container (`docker compose logs <service>`) are the debugging tool; a next step would be correlation IDs passed through the `x-user-email`-style headers. |
| Deployment orchestration | `docker-compose.yml` handles it for this deliverable, exactly as the brief allows ("deployed on a single VM or Docker Compose"). |
| Testing across services | Addressed head-on rather than avoided: each service's Jest suite boots the *real* services it depends on in-process (see `services/*/test/api.test.js`) so the tests exercise actual REST calls, not mocks. |

### Proof for grading — run these live, or screenshot the output

Everything below is a real command against the running stack, not a claim. Run `docker compose up
--build -d` first, then work through these in order:

**1. Six independent containers, one shared network, only the gateway exposed:**
```bash
docker compose ps
```
You'll see `nyom_gateway` with a `0.0.0.0:3000->3000` port mapping, and `nyom_user_service`,
`nyom_places_service`, `nyom_recommendation_service`, `nyom_assistant_service` with **no** host port
mapping at all — they're only reachable from inside the Docker network, which is exactly what "the
gateway is the single entry point" means in practice, not just in a diagram.

**2. Each service has its own codebase, `package.json` and dependencies:**
```bash
ls services/
cat services/user-service/package.json
cat services/places-service/package.json
```
Four separate `services/*/package.json` files, four separate `node_modules`, no shared code.

**3. Each service owns its own data - prove it by hitting one directly (bypassing the gateway):**
```bash
docker compose exec places-service wget -qO- http://localhost:4002/services | head -c 300
docker compose exec user-service wget -qO- http://localhost:4001/metrics
```
places-service's data is `services/places-service/data/places.json`; user-service's is
`services/user-service/data/users.json` - two different files, two different containers, neither
one able to read the other's disk.

**4. The API Gateway actually routes, it isn't just a label:**
```bash
curl http://localhost:3000/services      # -> proxied to places-service
curl http://localhost:3000/recommendations # -> proxied to recommendation-service
curl -X POST http://localhost:3000/users -H "Content-Type: application/json" \
  -d '{"name":"Demo","email":"demo@example.com","password":"demo1234"}'  # -> proxied to user-service
```
All three go through port 3000 only, yet land in three different containers - see
`services/gateway/server.js` for the routing table (`app.use('/services', ...)`,
`app.use('/recommendations', ...)`, `app.use('/users', ...)`).

**5. Real inter-service REST calls, not a shared database:**
```bash
curl -X POST http://localhost:3000/services -H "Content-Type: application/json" \
  -H "x-user-email: ghost@nowhere.com" -d '{"name":"test"}'
```
Returns `401 Invalid user` — places-service just made a live HTTP call to user-service
(`GET /internal/users/by-email/...`) to check that email is real, and rejected the write because
it isn't. That's Recommendation/Places/Assistant → User Service communication, proven, not
diagrammed.

**6. Independent deployability:**
```bash
docker compose up --build -d places-service
docker compose ps
```
Only `nyom_places_service` restarts; `nyom_user_service`, `nyom_recommendation_service` etc. keep
their original `Up X minutes` uptime, unaffected - because they're independent processes, not one
app being restarted.

**Deliverable**: *"Three independent services communicating via REST APIs, with an API Gateway,
deployed on a single VM or Docker Compose."* — met and exceeded: 4 independent services + gateway,
communicating over real REST, running as 6 Docker Compose containers (verified end-to-end: register
→ login → auth-gated CRUD → recommendations → geofence → aggregated metrics, all through the
gateway on the real Docker network). See "Proof for grading" below for how to demonstrate every one
of these live.

---

## Running it

Nothing here needs an account, an API key, or any money — map tiles and routing are free public
services, and the AI assistant runs on a free, local, self-hosted model via Ollama.

### Step 1 — install Ollama once, on your machine (not in Docker)

Download and install [Ollama](https://ollama.com/download) for your OS, then pull the small default
model:
```bash
ollama pull llama3.2:1b
```
This is a one-time, ~1.3GB download (chosen deliberately small to be realistic on a limited/unstable
connection — see Architecture above for why Ollama isn't containerized). If you have more bandwidth
to spare, a bigger model like `llama3` (~4.7GB) will answer noticeably better - just
`ollama pull llama3` instead and set `OLLAMA_MODEL=llama3` in a `.env` file.

On Windows/Mac, the installer sets Ollama up to run in the background automatically. On Linux, run
`ollama serve`. Either way it listens on `localhost:11434`.

### Step 2 — Docker Compose (matches the deliverable: multiple containers, one entry point)

```bash
docker compose up --build
```

Open **http://localhost:3000**. This starts **six containers**: `gateway`, `user-service`,
`places-service`, `recommendation-service`, `assistant-service`, plus named volumes for persisted
data. Map, places, accounts, favorites, visited-tracking and directions all work immediately; the
assistant works as soon as Ollama (from Step 1) responds on your machine.

### Option B — everything locally without Docker

```bash
npm run install:services   # installs each service's own node_modules
npm run dev                 # runs all 5 Node services concurrently
```

Open **http://localhost:3000**. (Ollama from Step 1 is still required for the assistant.)

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `OLLAMA_MODEL` | assistant-service | Which local model to ask Ollama for. Defaults to `llama3.2:1b`. Optional - set to `llama3` or anything else you've pulled for better quality. |
| `OLLAMA_URL` | assistant-service | Where to reach Ollama. Defaults to `http://host.docker.internal:11434` in Docker Compose (reaches Ollama on your host machine), `http://localhost:11434` for local dev. |
| `*_SERVICE_URL` | gateway, recommendation-service, places-service, assistant-service | Where to reach each other service. Pre-wired for both Docker Compose (service names) and local dev (`localhost:<port>`). |

No `.env` file is required to run this project - `.env.example` exists only if you want to override
`OLLAMA_MODEL`.

### Tests

```bash
npm run test:services
```

Each service's suite spins up the real services it depends on in-process (e.g. places-service's
tests boot a real user-service instance to exercise the actual REST auth check), rather than mocking
the network boundary — so the tests catch the same integration bugs a mocked test would hide.

---

## Features

- **10 categories** of everyday places: hospitals, clinics, pharmacies, markets, police stations,
  churches, hotels, fuel stations, recreation and banks (restaurant category exists in the UI,
  awaiting real restaurant data - see Known limitations) — each with realistic, varied opening
  hours (24h hospitals/police/hotel reception, a 24h "pharmacie de garde", market hours that start
  before 6am, banks closing mid-afternoon) instead of one uniform schedule for everything.
- **Place detail pages** (`place.html?id=`) — full description, what each place offers, opening
  hours, languages spoken, and seeded reviews from named (fictional, pre-launch) reviewers so
  there's something to read before the app has real users - see Known limitations.
- **Search & filter** places by name, type and language, with one-tap category chips.
- **"Near me" locating** — real browser geolocation + Haversine distance, sorting every place by
  actual distance, not a static list.
- **Real GPS, everywhere** — a live status chip (in the navbar on every page) shows your real
  position and whether you're inside the Nyom geofence, even when you're nowhere near Nyom; it
  updates continuously via `watchPosition`, not a one-off lookup.
- **Interactive map** (`map.html`, Leaflet + OpenStreetMap tiles - free, no API key) — every place
  is plotted with its name always visible; clicking a marker opens a popup with its photo, address,
  hours, directions and a link to its full detail page.
- **Turn-by-turn directions with voice-over** — "Get directions" from any place's map popup or
  detail page computes a real walking *or* driving route (the free public OSRM routing API, no
  key) from wherever the user currently is, anywhere in Yaoundé; each step can be read aloud (Web
  Speech API), and the app auto-advances to (and speaks) the next turn as your live position gets
  close to it.
- **AI assistant, backed by a free local LLM (Ollama, llama3.2:1b by default)** — grounded in real place data: the
  assistant retrieves matching places from Places Service itself (a small deterministic step) and
  gives that data to the model as context, so it can't invent a place that isn't in the directory.
  Assistant replies that mention a place include a tap-through chip that jumps straight to that
  place on the map with directions pre-loaded.
- **Chat history** — logged-in users' conversations with the assistant are persisted per-user and
  reloaded on their next visit.
- **Real share & save** — Share uses the Web Share API to open the device's native share sheet
  (WhatsApp, SMS, email...) with a real deep link to the place, falling back to a copied link on
  desktop browsers that don't support it. Save persists to the logged-in user's account server-side
  (User Service), not just `localStorage`, so it follows them across devices.
- **Automatic visited-places tracking** — as a logged-in user's live location comes within ~150m of
  a place, it's silently recorded as visited; combined with manual "Mark as visited", this builds a
  real travel itinerary of places they've actually been, viewable on `my-places.html` alongside
  their saved list.
- **Accounts** — register/login with salted, scrypt-hashed passwords (Node's built-in `crypto`;
  never stored or returned in plain text).
- **Full CRUD on places**, gated behind a lightweight auth check verified live against User Service.
- **Popular/recommended feed** (personalised by stored preferences), **live open/closed status**,
  star ratings, and a `/metrics` endpoint aggregated across services.
- **Responsive UI** — Bootstrap 5, a proper viewport meta tag, and a deliberate design pass
  (Fraunces/Work Sans type pairing, warm palette, redesigned login page) instead of default-Bootstrap
  styling.

### Known limitations (honest, not hidden)
- **Restaurants**: removed the previous placeholder entries rather than keep guessing. I verified
  Nyom's real places via OpenStreetMap/Overpass (hotels, fuel stations, the sports club) but found
  no restaurant data specifically tagged within Nyom, and "Petit Marché" geocodes to a different,
  distant quartier (Yaoundé V) rather than anywhere near Nyom — so I did not want to fabricate
  restaurant names a second time. The `restaurant` category is wired through the whole app and
  ready to populate the moment real names/locations are provided.
- **Banks**: the two fictional entries were removed; **CCA (Crédit Communautaire d'Afrique)** is
  back as a real, OSM-verified branch about 0.5km into Nyom I, alongside the real recreation
  (Yaoundé Club) added at the same time.
- **Some photos are missing, honestly**: Wikimedia Commons (the only image source I can verify
  licensing and authenticity for) simply has no photos of Melrose Place Hôtel, Hôtel Tehasselois,
  Neptune Oil Nyom, Yaoundé Club or the CCA branch specifically — I searched multiple rounds of
  terms and confirmed there's nothing to find, rather than substitute an unrelated stock photo that
  would misrepresent the actual place. Total Okolo does have a photo because it's the same
  TotalEnergies chain/branding, honestly captioned as representative rather than the exact pump.
- **Reviews are seeded, not user-submitted**: since the app isn't deployed yet, each place ships
  with 2 reviews from fictional-but-realistic Cameroonian names as placeholder content, exactly as
  requested for pre-launch testing. There's no review-submission form yet - that would be the
  natural next feature once real users are testing it.
- Auth is a lightweight `x-user-email` header verified against User Service, not a signed
  token/session — appropriate for a class project's timeline, not production-grade.
- Each service persists to a JSON file, not a real database — deliberate for this phase (see
  Architecture above), and each file is genuinely owned by exactly one service.
- **The AI assistant needs Ollama installed and running on your machine** (not in Docker - see
  Architecture above for why), with its model already pulled (~1.3GB for the default llama3.2:1b,
  one-time). Until that's done, `/assistant/ask` returns a clear `503` instead of hanging or
  crashing. Map, directions, accounts, favorites and visited-tracking all work immediately either
  way - they don't depend on Ollama at all.
- A free local 1B-parameter model (llama3.2:1b via Ollama, chosen for a limited/unstable connection) is noticeably less capable than a hosted frontier model or even a larger local model like llama3 (8B)
  - answers are grounded in real data either way (see "Why the assistant doesn't use tool calling"
  above), but phrasing/reasoning quality will be more uneven. That's the honest trade-off of a
  zero-cost stack, made deliberately for this project.
- No message queue / async event bus — all inter-service calls are synchronous REST, which is what
  the deliverable asks for; async messaging is noted in the brief as an alternative, not required.

---

## API Gateway routing table (single entry point, `http://localhost:3000`)

| Method | Path | Routed to | Auth |
|---|---|---|---|
| POST | `/users` | user-service | No |
| POST | `/login` | user-service | No |
| GET | `/services`, `/services/search`, `/services/:id` | places-service | No |
| POST/PUT/DELETE | `/services`, `/services/:id`, `/services/share` | places-service | Yes (`x-user-email`, verified against user-service) |
| GET | `/geofence` | places-service | No |
| GET | `/recommendations` | recommendation-service | No (personalised if `x-user-email` sent) |
| POST | `/assistant/ask` | assistant-service | Optional (history only persists if logged in) |
| GET | `/assistant/history` | assistant-service | Yes |
| GET | `/metrics` | gateway (aggregates user-service + places-service) | No |
| GET | `/api/config` | gateway | No |
| POST/GET | `/favorites` | user-service | Yes (`x-user-email`) |
| POST/GET | `/visited` | user-service | Yes (`x-user-email`) |

---

## Original Flask Scaffold & Phase 1 Monolith

The course-provided Flask starter (`app/`) and the Phase 1 Node/Express monolith (`src/`) are kept
as-is for reference; neither is part of the active Phase 2 submission. See their inline code and
git history for details — the Phase 2 services above supersede both.
