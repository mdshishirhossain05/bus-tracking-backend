# Security Policy

## Supported Versions

This project is currently under active development.
Security fixes will be applied to the latest maintained version.

| Version        | Supported |
| -------------- | --------- |
| Latest         | ✅        |
| Older versions | ❌        |

---

# Reporting a Vulnerability

If you discover a security vulnerability, please **do not disclose it publicly**.

Instead, report it privately by opening a **security issue** or contacting the repository maintainer.

Please include the following information:

- Description of the vulnerability
- Steps to reproduce
- Possible impact
- Suggested fix (if known)

---

# Security Scope

Please report issues related to:

- Authentication flaws
- Authorization bypass
- Token handling
- Session management
- Input validation
- Rate limiting bypass
- Redis locking/idempotency
- Database access issues
- Sensitive data exposure

---

# Security Practices Used in This Project

This backend follows several security practices:

- JWT authentication
- refresh token rotation
- session tracking
- role-based authorization
- strict environment validation using Zod
- rate limiting on sensitive endpoints
- centralized error handling
- secrets stored in environment variables
- Dockerized environment isolation

---

# Sensitive Data Rules

Never commit:

- `.env`
- database credentials
- JWT secrets
- Redis credentials
- API keys
- private certificates

Always use environment variables instead.

---

# Security Acknowledgement

Security reports are taken seriously and will be reviewed as soon as possible.
