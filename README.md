# GlobeTrotter – Nyom Health Services Locator

GlobeTrotter is a **monolithic application** built for a semester-long capstone project: students build the monolith first, then refactor it into microservices, and finally deploy it to the cloud with resilience patterns using Docker, Kubernetes, and cloud-native tooling.

For the "help tourists locate places" brief, my chosen domain is **health services in Nyom** — hospitals, clinics and pharmacies that a visitor or resident might need to find quickly, in an unfamiliar area, sometimes in an unfamiliar language.

This repo contains **two things**:

| | Location | Status |
|---|---|---|
| Original course scaffold (Flask) | `app/`, `requirements.txt`, `Dockerfile`, `docker-compose.yml` | Untouched starter template, kept for reference |
| ⭐ **My submission: Nyom Health Services Locator** (Node/Express) | `src/`, `data/`, `tests/`, `package.json` | This is the active monolith for grading |

Everything below describes my submission.

---

## Features

- **Search & filter** health services by name, type (hospital / clinic / pharmacy) and language spoken, with one-tap category chips.
- **"Near me" locating** — uses the browser's geolocation API and a Haversine distance calculation to sort every service by real distance from the user, with a live "X km away" chip on each card. This is the core of the "locate places" requirement: it isn't just a static list, it answers *what's actually closest to me right now*.
- **Accounts** — register/login with bcrypt-hashed passwords (never stored or returned in plain text).
- **Community contributions** — logged-in users can add a new service to the directory (`POST /services`), which then appears for everyone.
- **Share & save** — share any service to a friend's email, or save it to a personal favorites list (kept in the browser).
- **Full CRUD on services** — create, read, update and delete, with write actions gated behind a lightweight auth check so only signed-in users can modify data.
- **Recommendations** — a "popular" feed surfaced on the home page, distance-sorted the same way as search results.
- **Live open/closed status** computed from each service's operating hours, and a star rating per service.
- **Usage metrics** endpoint (`/metrics`) reporting total users/services/shares — a simple analytics hook for the monolith.

## Design

The UI uses a warm, soft palette (sand, sage and clay tones) instead of a generic admin-dashboard look, a serif/sans type pairing (Fraunces + Work Sans), pill-shaped buttons, soft diffused shadows, and small motion touches (card lift on hover, fade-ins, toast notifications instead of browser `alert()`/`prompt()` popups) so the app feels considered rather than default-Bootstrap.

---

## Running the Nyom Health API

```bash
npm install
npm start        # serves the app at http://localhost:3000
npm test         # runs the Jest/Supertest suite
```

Then open **http://localhost:3000** in a browser. Frontend pages are served statically from `src/public/` (`index.html`, `login.html`, `services.html`).

### Endpoints

| Method | Endpoint               | Auth required | Description                                  |
|--------|-------------------------|:---:|-----------------------------------------------|
| POST   | `/users`                | No | Register a new user (bcrypt-hashed password)  |
| POST   | `/login`                | No | Authenticate with email/password              |
| GET    | `/services`             | No | List all health services (optional `?lat=&lng=` for distance sort) |
| GET    | `/services/search`      | No | Search by `type`, `name`, `language`, optional `lat`/`lng` |
| GET    | `/services/:id`         | No | Get a single service                          |
| POST   | `/services`             | Yes (`x-user-email` header) | Add a health service                          |
| PUT    | `/services/:id`         | Yes | Update a service                              |
| DELETE | `/services/:id`         | Yes | Remove a service                              |
| POST   | `/services/share`       | Yes | Share a service by email                      |
| GET    | `/recommendations`      | No | Popular services (optional `?lat=&lng=`)      |
| GET    | `/metrics`              | No | Counts of users/services/shares               |

Write routes expect a `x-user-email` header identifying a registered user (the frontend sets this automatically once you're logged in). This is a deliberately lightweight guard rather than a full JWT/session system, given the project timeline — noted here rather than silently left unauthenticated.

### Known limitations (honest, not hidden)

- Auth is header-based (`x-user-email`), not a signed token/session — fine for a class demo, not production-grade.
- Seed coordinates for the 6 Nyom services are approximate, illustrative locations, not verified GPS pins.

---

## Pushing your changes

```bash
git add -A
git status              # sanity check what's staged
git commit -m "Polish UI/UX and add near-me search, auth-guarded CRUD, hashed passwords"
git push origin main
```

---

## Original Flask Scaffold

The sections below describe the **course-provided Flask starter** in `app/`, kept as-is for reference. It is not the active submission.

## Project Structure

```
.
├── app/
│   ├── __init__.py         # Flask app factory
│   ├── models.py           # Data models and JSON file I/O
│   ├── auth.py             # Registration, login, JWT handling
│   ├── destinations.py     # Destination search endpoint
│   ├── recommendations.py  # Personalised recommendations endpoint
│   ├── itineraries.py      # Create / list itineraries
│   └── main.py             # App entry point
├── data/
│   ├── destinations.json   # Static destination catalogue (seed data)
│   ├── users.json          # Created at runtime
│   └── itineraries.json    # Created at runtime
├── tests/                  # Placeholder for future tests
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md
```

---

## REST API

| Method | Endpoint            | Auth required | Description                              |
|--------|---------------------|---------------|------------------------------------------|
| POST   | `/register`         | No            | Register a new user                      |
| POST   | `/login`            | No            | Authenticate and receive a JWT token     |
| GET    | `/destinations`     | No            | Search the destination catalogue         |
| GET    | `/recommendations`  | Yes (JWT)     | Get personalised recommendations        |
| POST   | `/itineraries`      | Yes (JWT)     | Create a new itinerary                   |
| GET    | `/itineraries`      | Yes (JWT)     | List all itineraries for the logged-in user |

Protected routes expect the header:  
`Authorization: Bearer <your-token>`

### Example requests

```bash
# Register
curl -X POST http://localhost:5000/register \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "s3cr3t", "preferences": ["beach", "food"]}'

# Login
curl -X POST http://localhost:5000/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "s3cr3t"}'
# Save the returned token: TOKEN=<value from .token field>

# Search destinations
curl "http://localhost:5000/destinations?tag=beach&max_cost=100"

# Personalised recommendations
curl http://localhost:5000/recommendations \
  -H "Authorization: Bearer $TOKEN"

# Create an itinerary
curl -X POST http://localhost:5000/itineraries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title": "Beach Escape", "destinations": ["Bali"], "start_date": "2025-07-01", "end_date": "2025-07-14"}'

# List itineraries
curl http://localhost:5000/itineraries \
  -H "Authorization: Bearer $TOKEN"
```

---

## Running Locally

### Prerequisites
- Python 3.9+
- pip

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the server
python app/main.py
```

The API will be available at `http://localhost:5000`.

---

## Running with Docker

```bash
# Build and start
docker-compose up --build

# Stop
docker-compose down
```

The `data/` directory is mounted into the container, so JSON files persist between runs.

---

## Data Storage

All data is persisted in plain JSON files inside the `data/` directory:

| File                    | Purpose                              |
|-------------------------|--------------------------------------|
| `data/destinations.json`| Static catalogue of travel destinations (seed data) |
| `data/users.json`       | Registered users (created at runtime) |
| `data/itineraries.json` | User itineraries (created at runtime) |

> **Note:** `data/*.json` (except `destinations.json`) are excluded from version control via `.gitignore`.

---

## Configuration

| Environment Variable | Default                              | Description           |
|----------------------|--------------------------------------|-----------------------|
| `SECRET_KEY`         | `globetrotter-secret-change-in-prod` | JWT signing key – **must be overridden in production** |
| `FLASK_DEBUG`        | `0`                                  | Set to `1` to enable Flask debug mode (development only) |
| `PORT`               | `5000`                               | Port the app listens on |

> **Important:** Always set `SECRET_KEY` to a long, random value in production (e.g. `python -c "import secrets; print(secrets.token_hex(32))"`).
