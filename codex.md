# YuGiOh Tournament Manager - Project Rules

## Goal

Build a lightweight tournament management platform for local Yu-Gi-Oh tournaments.

The application is NOT intended to replace Konami tournament software.

V1 focuses only on:

* tournament creation
* player management
* manual round creation
* manual match pairings
* table assignments
* result entry
* public tournament display page
* KTS `.Tournament` import
* local KTS auto-sync for one active live-event file

---

# Tech Stack

Frontend:

* React
* Vite
* TailwindCSS
* Axios

Backend:

* FastAPI
* SQLAlchemy
* Pydantic

Database:

* SQLite by default

Infrastructure:

* No infrastructure required for normal SQLite development
* Tauri desktop dev starts the backend automatically
* Manual web dev remains available with SQLite

---

# Architecture Rules

* Keep architecture simple and beginner-readable.
* Avoid overengineering.
* Prefer explicit readable code over abstractions.
* Do not introduce microservices.
* Do not introduce CQRS/event sourcing.
* Do not introduce Redis.
* Do not introduce GraphQL.
* Do not introduce WebSockets for V1.
* Do not introduce message brokers.

---

# V1 Feature Scope

Allowed:

* Create tournaments
* Add players
* Create rounds
* Create matches manually
* Assign table numbers
* Enter match results
* Display standings
* Public read-only tournament page

Not allowed in V1:

* Authentication
* Role systems
* Decklists
* PWA
* Automatic Swiss pairings
* Tie-break algorithms
* Notifications
* Match history analytics
* Multi-admin editing
* Payments
* Discord integration

---

# Database Rules

Use simple relational design.

Core tables only:

* tournaments
* players
* rounds
* matches

Avoid premature optimization.

---

# Frontend Rules

* Mobile-friendly UI
* Keep components small
* Avoid giant component files
* Prefer simple Tailwind styling
* No heavy UI libraries for V1

---

# Backend Rules

* Use REST APIs only
* Keep route structure simple
* Keep validation readable
* Use SQLAlchemy ORM
* Use environment variables for DB config
* Default local database URL is `sqlite:///./data/app.db`

---

# General Development Rules

* Implement features incrementally.
* Never add features outside requested scope.
* Ask before introducing new dependencies.
* Keep folder structure clean and minimal.
* Prioritize maintainability over cleverness.
