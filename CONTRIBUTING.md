# Contributing Guide

Thank you for your interest in contributing to the **Real-Time Bus Tracking Backend API**.

This project is designed as a **production-grade backend architecture** and also serves as a **CSE final year thesis project** focused on scalable backend systems, real-time data processing, and modern DevOps practices.

We welcome contributions that improve the reliability, maintainability, and performance of the system.

---

# Project Philosophy

This repository follows several core engineering principles:

- **Clean architecture**
- **Separation of concerns**
- **Security-first design**
- **Scalable backend structure**
- **Testable services**

Contributors should avoid large structural changes unless absolutely necessary.

---

# Architecture Overview

The backend follows a **layered architecture**.

```
Routes
   ↓
Controllers
   ↓
Services
   ↓
Database / Redis
```

Responsibilities:

| Layer       | Responsibility                    |
| ----------- | --------------------------------- |
| Routes      | Define API endpoints              |
| Controllers | Handle request and response logic |
| Services    | Business logic and domain rules   |
| Prisma      | Database access                   |
| Redis       | Real-time state and caching       |

Keep controllers thin and place business logic inside **services**.

---

# Tech Stack

Backend technologies used in this project:

- Node.js
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Redis
- Zod validation
- Swagger OpenAPI
- Vitest
- Supertest
- Docker
- GitHub Actions

---

# Getting Started

## 1. Clone the repository

```
git clone https://github.com/your-username/bus-tracking-backend.git
cd bus-tracking-backend
```

---

## 2. Install dependencies

```
npm install
```

---

## 3. Setup environment variables

Copy the example environment file.

```
cp .env.example .env
```

Then update the variables according to your environment.

---

## 4. Generate Prisma Client

```
npx prisma generate
```

---

## 5. Run database migrations

```
npx prisma migrate dev
```

---

## 6. Start the development server

```
npm run dev
```

Server will start at:

```
http://localhost:5000
```

Swagger documentation:

```
http://localhost:5000/docs
```

---

# Running Tests

This project uses **Vitest** and **Supertest** for integration testing.

Run tests:

```
npm run test
```

Watch mode:

```
npm run test:watch
```

Test coverage:

```
npm run test:coverage
```

Make sure **all tests pass before submitting a pull request**.

---

# Development Guidelines

Follow these guidelines when contributing.

### Code Structure

Keep files aligned with the current structure.

```
src/
  controllers/
  services/
  routes/
  middlewares/
  config/
```

Avoid mixing responsibilities across layers.

---

### Naming Conventions

Use clear and consistent naming.

Examples:

```
auth.controller.ts
trip.service.ts
tracking.routes.ts
```

Functions should describe behavior clearly.

Examples:

```
createUserSession()
startDriverTrip()
updateTripLocation()
calculateETA()
```

---

### Controller Rules

Controllers should only:

- validate request input
- call service methods
- return responses

Avoid heavy business logic in controllers.

---

### Service Rules

Services contain:

- business logic
- database interactions
- Redis interactions
- domain rules

Services should be easy to test.

---

### Validation

All request validation must use **Zod schemas**.

Example:

```
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
})
```

Never trust raw request input.

---

### Error Handling

Use centralized error middleware.

Avoid returning raw errors directly.

Always return structured API responses.

---

# Commit Message Guidelines

Use meaningful commit messages.

Recommended format:

```
type: description
```

Examples:

```
feat: add trip location update endpoint
fix: correct refresh token rotation bug
docs: update API documentation
test: add auth session tests
ci: improve prisma migration step
```

Common types:

| Type     | Purpose           |
| -------- | ----------------- |
| feat     | new feature       |
| fix      | bug fix           |
| docs     | documentation     |
| test     | testing updates   |
| refactor | code improvements |
| ci       | CI/CD updates     |

---

# Pull Request Guidelines

Before opening a pull request:

1. Ensure tests pass
2. Keep changes focused
3. Update documentation if necessary
4. Do not commit secrets
5. Do not commit `.env` files

A good pull request should include:

- clear description
- reason for change
- testing information
- screenshots or logs if applicable

---

# Security Guidelines

Do not commit sensitive information.

Never commit:

- `.env`
- database credentials
- JWT secrets
- Redis credentials
- API keys

All secrets must remain in environment variables.

---

# Reporting Issues

When reporting issues, please include:

- clear description
- expected behavior
- reproduction steps
- logs or screenshots
- environment information

Example:

```
Node version
Database type
Operating system
Steps to reproduce
```

---

# Branch Strategy

Recommended workflow:

```
main
 └── feature/*
 └── fix/*
```

Examples:

```
feature/trip-eta-calculation
fix/auth-refresh-bug
```

Merge through pull requests only.

---

# Coding Style

General style rules:

- Prefer TypeScript strict types
- Avoid `any` where possible
- Write readable functions
- Use descriptive variable names
- Keep functions small and focused

---

# Code of Conduct

All contributors should:

- be respectful
- communicate clearly
- focus on improving the project
- help maintain a professional environment

---

# Thank You

Thank you for contributing to this project and helping improve a real-world **transport tracking backend system**.

Your contributions help build a more reliable and scalable backend architecture.
