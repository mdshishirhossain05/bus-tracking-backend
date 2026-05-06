# 🚍 Real-Time Bus Tracking Backend API

![Node](https://img.shields.io/badge/node-%3E=20-green)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue)
![Prisma](https://img.shields.io/badge/ORM-Prisma-darkblue)
![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-blue)
![Redis](https://img.shields.io/badge/cache-Redis-red)
![CI](https://img.shields.io/github/actions/workflow/status/mdshishirhossain/bus-tracking-backend/ci.yml?branch=main)
![License](https://img.shields.io/badge/license-MIT-green)

A **production-grade backend API** for a **Real-Time Bus Tracking System** built with modern backend architecture, real-time state handling, and production-focused DevOps practices.

This project is designed for:

- real-world scalable backend systems
- transport fleet tracking
- location-based services
- a CSE final-year thesis project

---

# 📌 System Overview

The platform supports three main user roles:

| Role          | Responsibilities                                            |
| ------------- | ----------------------------------------------------------- |
| **Admin**     | Manage buses, routes, stops, schedules, users, and sessions |
| **Driver**    | Start trips, send location updates, and end trips           |
| **Passenger** | Track buses live, view ETAs, and check active trips         |

The system handles:

- real-time location updates
- trip state management
- Redis caching
- ETA estimation
- role-based access control
- secure authentication and session management

---

# ⚙️ Tech Stack

## Backend

- Node.js
- Express.js
- TypeScript

## Database

- PostgreSQL
- Prisma ORM

## Caching / Realtime State

- Redis

## Authentication

- JWT Access Tokens
- JWT Refresh Tokens
- Session tracking

## API Documentation

- Swagger OpenAPI

## Validation

- Zod

## Testing

- Vitest
- Supertest

## DevOps

- Docker
- GitHub Actions CI

---

# 🏗 System Architecture

The backend follows a **layered architecture pattern**.

```text
Client
   │
   ▼
Routes
   │
   ▼
Controllers
   │
   ▼
Services
   │
   ├── PostgreSQL (Prisma)
   │
   └── Redis (Realtime State)
```

Benefits:

- modular design
- testable services
- scalable architecture
- separation of concerns

---

# 🧠 Real-Time Tracking Architecture

```text
Driver App
    │
    │ GPS location
    ▼
API Server
    │
    ├── Store location buffer / trip state (Redis)
    │
    ├── Persist periodic updates (PostgreSQL)
    │
    └── Update active trip state
            │
            ▼
Passenger Tracking API
            │
            ▼
ETA Calculation
```

Redis is used for:

- trip state
- location buffering
- idempotency
- locking
- short-lived realtime data

---

# 📂 Project Structure

```text
src/
  app.ts
  server.ts

  config/
    env.ts
    prisma.ts
    redis.ts
    swagger.ts

  controllers/
  services/

  routes/
    index.ts
    auth.routes.ts
    health.routes.ts

    admin/
      bus.routes.ts
      route.routes.ts
      stop.routes.ts
      schedule.routes.ts
      routeStop.routes.ts
      session.routes.ts
      user.routes.ts

    driver/
      trip.routes.ts

    passenger/
      tracking.routes.ts
      trips.routes.ts

  middlewares/
    auth.middleware.ts
    error.middleware.ts
    origin.middleware.ts
    rateLimit.middleware.ts
    requestContext.middleware.ts

  utils/

tests/
  helpers/
  auth/
  health/
```

---

# 🔐 Authentication Flow

```text
User Login
    │
    ▼
Validate credentials
    │
    ▼
Generate Access Token + Refresh Token
    │
    ▼
Store session in database
    │
    ▼
Client uses Access Token for protected APIs
```

Refresh tokens rotate securely.

Supported roles:

- `ADMIN`
- `DRIVER`
- `PASSENGER`

---

# 🌐 API Versioning

All endpoints are versioned:

```text
/api/v1/...
```

Examples:

```http
POST /api/v1/auth/login
POST /api/v1/driver/trips/start
GET /api/v1/passenger/trips/active
```

---

# ❤️ Health Endpoints

Infrastructure health checks:

```text
/live
/health
/ready
```

Useful for:

- Docker health checks
- orchestration systems
- uptime monitoring
- load balancers

---

# 📘 API Documentation

Swagger documentation is available at:

```text
/docs
```

Example:

```text
http://localhost:5000/docs
```

---

# 🧪 Testing

Testing stack:

- Vitest
- Supertest

Run tests:

```bash
npm run test
```

Watch mode:

```bash
npm run test:watch
```

Coverage:

```bash
npm run test:coverage
```

---

# 🐳 Docker Support

The project includes Docker configuration for:

- Node API
- PostgreSQL
- Redis

Example:

```bash
docker-compose up
```

---

# ⚙️ Environment Variables

Environment validation is handled using **Zod** in:

```text
src/config/env.ts
```

Create your `.env` file from `.env.example`.

Example `.env`:

```env
APP_NAME=bus-tracking-backend
NODE_ENV=development
PORT=5000
API_VERSION=v1

DATABASE_URL=postgresql://user:password@localhost:5432/bus_tracking
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=your-very-strong-access-secret-at-least-32-chars
JWT_REFRESH_SECRET=your-very-strong-refresh-secret-at-least-32-chars

ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d

COOKIE_SECURE=false
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=

CORS_ORIGIN=http://localhost:3000

DEFAULT_SPEED_KMH=20
ARRIVAL_RADIUS_METERS=80
LOCATION_DB_WRITE_INTERVAL_MS=10000

RL_LOGIN_WINDOW_MS=600000
RL_LOGIN_MAX=20
RL_REFRESH_WINDOW_MS=300000
RL_REFRESH_MAX=120

STOPS_CACHE_TTL_MS=300000
STOPS_CACHE_MAX_ENTRIES=200

TRIP_STATE_TTL_SECONDS=180
STOPS_CACHE_TTL_SECONDS=300

TRIP_LOCK_TTL_MS=10000
IDEMPOTENCY_TTL_SECONDS=3600
```

---

# 🚀 Running the Project

Install dependencies:

```bash
npm install
```

Generate Prisma Client:

```bash
npx prisma generate
```

Run development server:

```bash
npm run dev
```

Build project:

```bash
npm run build
```

Start production server:

```bash
npm start
```

---

# 🔄 Database Migration

Create migration during development:

```bash
npx prisma migrate dev
```

Apply migrations in CI/production:

```bash
npx prisma migrate deploy
```

---

# 🌍 Continuous Integration

CI runs automatically on:

- push
- pull request

Pipeline steps:

```text
npm install
prisma generate
setup PostgreSQL and Redis
apply Prisma schema / migrations
npm run test
```

This helps ensure that the application remains stable as the project grows.

---

# 🧭 System Design Diagrams

## 1) High-Level Backend Architecture

```mermaid
flowchart TD
    A[Client Apps<br/>Admin Panel / Driver App / Passenger App] --> B[Express API Server]
    B --> C[Routes]
    C --> D[Controllers]
    D --> E[Services]

    E --> F[(PostgreSQL)]
    E --> G[(Redis)]

    B --> H[Middlewares]
    H --> H1[Auth Middleware]
    H --> H2[Authorization Middleware]
    H --> H3[Rate Limit Middleware]
    H --> H4[Request Context Middleware]
    H --> H5[Error Middleware]

    B --> I[Swagger Docs]
    B --> J[Health Endpoints]
```

### Explanation

This backend follows a layered architecture:

- **Routes** receive API requests
- **Controllers** handle request/response logic
- **Services** contain business logic
- **PostgreSQL** stores persistent data
- **Redis** stores realtime and temporary state

This structure improves:

- maintainability
- scalability
- testability
- separation of concerns

---

## 2) Request Lifecycle

```mermaid
sequenceDiagram
    participant Client
    participant Route
    participant Middleware
    participant Controller
    participant Service
    participant Redis
    participant DB

    Client->>Route: HTTP Request
    Route->>Middleware: Apply middleware chain
    Middleware->>Controller: Validated request
    Controller->>Service: Call business logic
    Service->>Redis: Read/write cache or live trip state
    Service->>DB: Read/write persistent data
    DB-->>Service: Database result
    Redis-->>Service: Cache/state result
    Service-->>Controller: Final response data
    Controller-->>Client: JSON Response
```

---

## 3) Authentication and Session Flow

```mermaid
sequenceDiagram
    participant User
    participant API
    participant AuthService
    participant DB
    participant Redis

    User->>API: POST /api/v1/auth/login
    API->>AuthService: Validate credentials
    AuthService->>DB: Find user by email
    DB-->>AuthService: User record
    AuthService->>AuthService: Compare password
    AuthService->>DB: Create session
    AuthService->>Redis: Cache/session support (optional)
    AuthService-->>API: Access token + refresh token
    API-->>User: Set cookies / return auth response
```

### Auth Features

- JWT access token
- JWT refresh token
- session storage
- logout current device
- logout all devices
- role-based authorization

Supported roles:

- `ADMIN`
- `DRIVER`
- `PASSENGER`

---

## 4) Real-Time Bus Tracking Flow

```mermaid
flowchart LR
    A[Driver starts trip] --> B[Trip created or activated]
    B --> C[Driver sends live location]
    C --> D[API validates active trip]
    D --> E[Store current trip state in Redis]
    E --> F[Buffer location updates]
    F --> G[Persist periodic location data in PostgreSQL]
    E --> H[Passenger tracking endpoint reads live trip state]
    H --> I[ETA estimation logic]
    I --> J[Passenger receives tracking data]
```

### Why Redis is used here

Redis is ideal for:

- active trip state
- location buffering
- trip locks
- idempotency keys
- short-lived realtime data

PostgreSQL is ideal for:

- users
- sessions
- buses
- routes
- stops
- schedules
- historical trip/location records

---

## 5) Admin, Driver, Passenger Domain Flow

```mermaid
flowchart TD
    A[Admin] --> A1[Manage buses]
    A --> A2[Manage routes]
    A --> A3[Manage stops]
    A --> A4[Manage schedules]
    A --> A5[Manage users]
    A --> A6[Manage sessions]

    B[Driver] --> B1[Start trip]
    B --> B2[Send location]
    B --> B3[End trip]

    C[Passenger] --> C1[View active trips]
    C --> C2[Track trip]
    C --> C3[View stop arrivals]
    C --> C4[View ETA or dashboard]
```

---

## 6) Database ER Diagram (Conceptual)

```mermaid
erDiagram
    USER {
        string id
        string name
        string email
        string passwordHash
        enum role
        datetime createdAt
        datetime updatedAt
    }

    SESSION {
        string id
        string userId
        string refreshTokenHash
        string userAgent
        string ipAddress
        boolean isRevoked
        datetime expiresAt
        datetime createdAt
    }

    BUS {
        string id
        string busNumber
        string plateNumber
        string model
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    ROUTE {
        string id
        string name
        string code
        string startPoint
        string endPoint
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    STOP {
        string id
        string name
        float latitude
        float longitude
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    ROUTE_STOP {
        string id
        string routeId
        string stopId
        int stopOrder
        float distanceFromStart
    }

    SCHEDULE {
        string id
        string routeId
        string busId
        string driverId
        string departureTime
        string arrivalTime
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    TRIP {
        string id
        string busId
        string routeId
        string driverId
        string scheduleId
        enum status
        datetime startedAt
        datetime endedAt
        datetime createdAt
        datetime updatedAt
    }

    TRIP_LOCATION {
        string id
        string tripId
        float latitude
        float longitude
        float speed
        float heading
        datetime recordedAt
    }

    USER ||--o{ SESSION : has
    USER ||--o{ SCHEDULE : assigned_as_driver
    USER ||--o{ TRIP : drives

    BUS ||--o{ SCHEDULE : assigned_to
    BUS ||--o{ TRIP : used_in

    ROUTE ||--o{ ROUTE_STOP : contains
    STOP ||--o{ ROUTE_STOP : belongs_to

    ROUTE ||--o{ SCHEDULE : scheduled_for
    ROUTE ||--o{ TRIP : used_in

    SCHEDULE ||--o{ TRIP : generates
    TRIP ||--o{ TRIP_LOCATION : records
```

> This ER diagram is conceptual and should be aligned with your exact Prisma schema.

---

## 7) Deployment Architecture

```mermaid
flowchart TD
    A[Client Apps] --> B[Backend API Container]
    B --> C[(PostgreSQL / Neon)]
    B --> D[(Redis)]
    B --> E[Swagger Docs]
    B --> F[Health Endpoints]

    G[GitHub Repository] --> H[GitHub Actions CI]
    H --> I[Run Tests]
    I --> J[Ready for Deployment]
```

### Deployment Components

- **Backend API**: Node.js + Express + TypeScript
- **Database**: PostgreSQL / Neon
- **Cache / Realtime state**: Redis
- **CI**: GitHub Actions
- **Docs**: Swagger
- **Containerization**: Docker

---

## 8) Middleware Execution Order

```mermaid
flowchart LR
    A[Incoming Request] --> B[Request Context Middleware]
    B --> C[Origin / Security Middleware]
    C --> D[Body Parsers / Cookies]
    D --> E[Rate Limit Middleware]
    E --> F[Authentication Middleware]
    F --> G[Authorization Middleware]
    G --> H[Route Handler]
    H --> I[Controller]
    I --> J[Service]
    J --> K[Response]
    K --> L[Global Error Middleware]
```

### Middleware Responsibilities

- **Request Context**: traceability, correlation IDs, request metadata
- **Origin Middleware**: trusted origin / security handling
- **Rate Limit**: protect sensitive endpoints
- **Authentication**: identify user
- **Authorization**: verify role access
- **Error Middleware**: return safe structured errors

---

## 9) Example API Flows

### Register Passenger

```http
POST /api/v1/auth/register
Content-Type: application/json
```

```json
{
  "name": "Test Passenger",
  "email": "passenger@example.com",
  "password": "StrongPassword123!"
}
```

Example response:

```json
{
  "success": true,
  "message": "Passenger registered successfully",
  "data": {
    "user": {
      "id": "usr_123",
      "name": "Test Passenger",
      "email": "passenger@example.com",
      "role": "PASSENGER"
    }
  }
}
```

---

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "passenger@example.com",
  "password": "StrongPassword123!"
}
```

Example response:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "<jwt-access-token>",
    "user": {
      "id": "usr_123",
      "name": "Test Passenger",
      "email": "passenger@example.com",
      "role": "PASSENGER"
    }
  }
}
```

---

### Driver Starts Trip

```http
POST /api/v1/driver/trips/start
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "scheduleId": "sch_123"
}
```

Example response:

```json
{
  "success": true,
  "message": "Trip started successfully",
  "data": {
    "tripId": "trip_123",
    "status": "ACTIVE",
    "startedAt": "2026-03-13T08:00:00.000Z"
  }
}
```

---

### Driver Sends Location

```http
POST /api/v1/driver/trips/location
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "tripId": "trip_123",
  "latitude": 23.8103,
  "longitude": 90.4125,
  "speed": 34.5,
  "heading": 180
}
```

Example response:

```json
{
  "success": true,
  "message": "Location updated successfully"
}
```

---

### Passenger Views Active Trips

```http
GET /api/v1/passenger/trips/active
Authorization: Bearer <access-token>
```

Example response:

```json
{
  "success": true,
  "data": [
    {
      "tripId": "trip_123",
      "busId": "bus_001",
      "routeId": "route_001",
      "status": "ACTIVE"
    }
  ]
}
```

---

## 10) Non-Functional Goals

This project prioritizes the following non-functional requirements:

- **Scalability**  
  Layered design and Redis-backed state handling support growth.

- **Reliability**  
  Health endpoints, CI pipeline, and structured error handling improve stability.

- **Maintainability**  
  Clear separation of concerns makes the code easier to extend.

- **Security**  
  JWT auth, role checks, sessions, and rate limiting reduce risk.

- **Observability**  
  Request context and health checks support debugging and monitoring.

---

## 11) Engineering Highlights

Why this project is production-grade:

- versioned API structure
- layered architecture
- strict environment validation
- Redis for realtime trip state
- Prisma ORM with PostgreSQL
- secure auth/session handling
- Dockerized development support
- automated GitHub Actions CI
- integration testing with Vitest + Supertest

---

# 📈 Future Improvements

Planned enhancements:

- WebSocket live bus tracking
- geospatial ETA calculations
- route optimization
- passenger notifications
- fleet analytics
- driver performance metrics

---

# 🎓 Thesis Context

This backend is also part of a **B.Sc. CSE Final Year Thesis Project** focused on:

- scalable backend design
- real-time systems
- distributed caching
- transport management systems

---

# 📜 License

MIT License

---

# 👨‍💻 Author

**Md. Shishir Hossain**

Computer Science & Engineering  
NPI University of Bangladesh

Backend Developer | Software Engineer | System Architect
