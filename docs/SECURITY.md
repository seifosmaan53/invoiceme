# Security Documentation

## Overview

InvoiceMe implements comprehensive security measures to protect against common attacks and vulnerabilities. This document outlines all security features and best practices.

## Security Features Implemented

### 1. Authentication & Authorization

✅ **JWT-based Authentication**
- Access tokens with short expiration (15 minutes)
- Refresh tokens with longer expiration (7 days)
- Separate secrets for access and refresh tokens
- Token rotation on refresh

✅ **Password Security**
- Bcrypt hashing with salt rounds (10)
- Minimum password requirements enforced
- Password reset tokens with expiration (1 hour)
- Token invalidation after use

✅ **Account Protection**
- Rate limiting on login (5 attempts per 15 minutes)
- Rate limiting on registration (3 attempts per hour)
- Generic error messages to prevent user enumeration
- Email enumeration protection

### 2. Input Validation & Sanitization

✅ **Input Validation**
- Class-validator DTOs for all endpoints
- Whitelist validation (strips unknown properties)
- Forbid non-whitelisted properties
- Type transformation and validation
- Nested object validation

✅ **Input Sanitization**
- HTML sanitization to prevent XSS
- Filename sanitization to prevent path traversal
- Object recursive sanitization
- Special character removal

✅ **SQL Injection Protection**
- TypeORM parameterized queries (automatic)
- No raw SQL queries with user input
- Entity-based queries prevent injection

### 3. Rate Limiting & DDoS Protection

✅ **General API Rate Limiting**
- Configurable via `RATE_LIMIT_TTL` and `RATE_LIMIT_MAX`
- Default: 100 requests per 60 seconds
- Per-IP address tracking: the key is the client address from the
  trusted-proxy policy (below), the same value as `req.ip`; a client cannot
  pick a new key by sending its own `X-Forwarded-For`
- Counters are in memory, per process (not shared between instances); every
  IPv6 address is its own key
- Standard rate limit headers

✅ **Authentication Rate Limiting**
- Login: 5 attempts per 15 minutes
- Registration: 3 attempts per hour
- Password reset: Rate limited
- Prevents brute force attacks

✅ **Request Size Limits**
- JSON body: 10MB maximum
- URL-encoded: 10MB maximum
- File uploads: 10MB maximum
- Prevents DoS via large payloads

### 4. Security Headers (Helmet)

✅ **HTTP Security Headers**
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - XSS protection
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (production only)
- Removed `X-Powered-By` header

### 5. CORS Security

✅ **CORS Configuration**
- Never defaults to `*` in production
- Requires explicit domain configuration
- Credentials support for authenticated requests
- Configurable via `CORS_ORIGIN` environment variable
- Multiple domains supported (comma-separated)

⚠️ **Production Requirement:**
```bash
# NEVER use '*' in production
CORS_ORIGIN=https://app.yourdomain.com,https://mobile.yourdomain.com
```

### 6. File Upload Security

✅ **File Validation**
- File type whitelist (JPEG, PNG, GIF, PDF only)
- File size limit (10MB maximum)
- Filename sanitization (prevents path traversal)
- MIME type validation
- Double validation (interceptor + controller)

✅ **S3 Storage Security**
- Files stored as **private** (not public)
- Signed URLs for secure access (7-day expiration)
- No public ACL on uploaded files
- Prevents unauthorized file access

### 7. Error Handling Security

✅ **Information Leakage Prevention**
- Generic error messages in production
- Detailed errors only in development
- No stack traces in production responses
- No database error details exposed
- No file system paths exposed

✅ **Error Logging**
- Full error details logged server-side
- Includes IP address and user agent
- No sensitive data in logs
- Timestamped error logs

### 8. API Security

✅ **Swagger Documentation**
- Disabled by default in production
- Controlled via `ENABLE_SWAGGER` environment variable
- Only enabled when explicitly set to `true`
- Prevents API endpoint discovery

✅ **Webhook Security**
- Stripe webhook signature verification
- Raw body parsing for signature validation
- Request size limit (1MB for webhooks)
- Signature header validation

### 9. Environment Security

✅ **Secrets Management**
- All secrets in environment variables
- `.env` files never committed to git
- Separate secrets for dev/staging/production
- JWT secrets must be 32+ characters
- Different secrets for access/refresh tokens

✅ **Configuration Validation**
- Environment validation script
- Checks for required variables
- Validates secret strength
- Prevents insecure defaults

### 10. Database Security

✅ **Connection Security**
- SSL/TLS for production databases
- Parameterized queries (TypeORM)
- Connection pooling
- No raw SQL with user input
- Separate test database

## Security Best Practices

### Development

1. **Never commit `.env` files**
   ```bash
   # .env is in .gitignore
   # Always use .env.example as template
   ```

2. **Use strong secrets**
   ```bash
   # Generate secure secrets
   openssl rand -base64 32
   ```

3. **Enable Swagger only in development**
   ```bash
   ENABLE_SWAGGER=true  # Development only
   ```

4. **Use localhost CORS in development**
   ```bash
   CORS_ORIGIN=http://localhost:3000,http://localhost:8080
   ```

### Production

1. **Disable Swagger**
   ```bash
   ENABLE_SWAGGER=false
   ```

2. **Set specific CORS origins**
   ```bash
   CORS_ORIGIN=https://app.yourdomain.com
   # NEVER use '*'
   ```

3. **Use production secrets**
   ```bash
   # Generate new secrets for production
   # Never reuse development secrets
   ```

4. **Enable SSL/TLS**
   ```bash
   # Database
   DB_SSL=true
   
   # Application (via reverse proxy)
   # Use HTTPS only
   ```

5. **Set production logging**
   ```bash
   LOG_LEVEL=info  # Not 'debug'
   NODE_ENV=production
   ```

6. **Trust proxy for correct IP detection**
   ```bash
   TRUST_PROXY=10.0.0.0/24  # the load balancer's address/subnet; 'true' = same-machine proxy only
   ```

7. **Redirect target for plain HTTP**
   ```bash
   PUBLIC_ORIGIN=https://invoices.example.com   # or TRUSTED_HOSTS=..., or neither (403, no redirect)
   ```

### Trusted-proxy policy and HTTPS enforcement

One function (`forwardedHops` in `backend/src/core/https-enforcement.ts`)
decides both the client address and the scheme; `req.ip`, `req.protocol`
and `req.secure` are overridden to return its result, and HTTPS enforcement,
rate-limit keys, access logs, audit records and error logs all use it.

- **Trust.** `TRUST_PROXY` is compiled by Express into a trust function.
  unset/`false`: nothing is trusted and every `X-Forwarded-*` header is
  ignored. `true`: the loopback range (127.0.0.0/8, ::1). Otherwise the named
  addresses/subnets. Hop counts are refused.
- **Client address.** The chain is the socket peer followed by the
  `X-Forwarded-For` values from right to left. Hops are skipped while they
  are trusted proxies; the first untrusted hop is the client (the same result
  as Express/proxy-addr). A client can prepend any values it likes; they are
  never reached, because the proxy that appended the client's real address is
  the last trusted hop.
- **Scheme.** A TLS socket is `https`. Otherwise `X-Forwarded-Proto` is
  read only when the socket peer is trusted, and then at the position of the
  outermost trusted proxy counted from the right (each proxy appends the
  scheme it received), clamped to the values present, so a proxy that
  overwrites the header (one value) is read correctly. Values further left
  came from untrusted parties and are never read. Only exactly
  `http`/`https` (case-insensitive) is accepted; anything else is `http`.
  Before this change Express's own `req.secure`/`req.protocol` took the
  FIRST value while enforcement took the last, so for
  `X-Forwarded-Proto: https, http` they disagreed.
- **Requirements on the proxy.** It must overwrite or append to both
  headers, never pass a client's value through unchanged as its own.
  `X-Forwarded-Host` and RFC 7239 `Forwarded` are not used.
- **Enforcement (`NODE_ENV=production`).** Plain-HTTP requests get
  `403 {"error":"HTTPS required",...}`. A plain-HTTP GET is redirected (301)
  only to a validated destination: `PUBLIC_ORIGIN` if set, else
  `https://<Host>` when the Host header is listed in `TRUSTED_HOSTS`. With
  neither, there is no redirect. A Location is never built from an
  unvalidated Host header, and absolute-form request targets are never
  echoed. `PUBLIC_ORIGIN`/`TRUSTED_HOSTS` are validated at startup whenever
  they are set (a malformed value stops the backend); leaving them unset is
  valid.
- **Health probe.** `GET /api/v1/health` over plain HTTP is served only to a
  loopback peer that sends no `X-Forwarded-For`, `X-Forwarded-Proto` or
  `Forwarded` header (`backend/healthcheck.js` inside the container or on the
  same machine). The probe still requires a real 200 with `status: "ok"` and
  `database: "connected"`; redirects count as failure.
- **Development.** With `NODE_ENV` other than `production` nothing is
  enforced or redirected, so plain HTTP on localhost/LAN works as before.

**Limitation: loopback trust on a shared machine.** `TRUST_PROXY=true`
trusts every process that connects from the same machine, not only the
proxy. A local user (or any local program, e.g. a compromised service) who
connects to the backend port directly can claim any client address, which
defeats IP-based rate limits and corrupts logs and audit records, and can
claim HTTPS. `API_HOST=127.0.0.1` does not help against local users. On a
machine shared with untrusted users, or running untrusted software, put the
proxy on a dedicated address and name only that address
(`TRUST_PROXY=10.0.0.5`), with the backend port reachable only from it.
This is not tested here and remains the operator's responsibility.

**Compatibility.** Installations that relied on the old redirect of plain
HTTP GETs (to `https://<whatever Host was sent>`) now get 403 instead,
unless `PUBLIC_ORIGIN` or `TRUSTED_HOSTS` is set. API clients that already
use HTTPS, requests through a TLS proxy marked `https`, and the local health
check are unaffected. Nothing new is required for the backend to start.

## Reviews of 2026-10-25 and known gaps

Each report records what was proven with a failing test, what was fixed, how it was verified, and what was not checked. They describe specific checks, not a guarantee that the application is secure.

| Report | Covers |
|---|---|
| [sync-ownership](security/2026-10-25-sync-ownership.md), [review](security/2026-10-25-sync-ownership-REVIEW.md) | Per-user ownership in sync and REST |
| [historical-cross-owner](security/2026-10-25-historical-cross-owner.md) | Finding legacy cross-owner rows (read-only report) |
| [container-pdf](security/2026-10-25-container-pdf.md) | Container image and PDF rendering build |
| [payments-attachments](security/2026-10-25-payments-attachments.md) | `/pay` authorization, Stripe webhook, attachment URL format check |
| [pdf-keys-login](security/2026-10-25-pdf-keys-login.md) | PDF rendering network access, API-key scopes, login 500 |

Known gaps, not fixed:

- The attachment URL check validates format only; the server does not fetch attachment URLs, and the mobile app does not yet re-check cached URLs before opening them (needs a mobile release).
- The permission guard admits API keys on routes without a `@RequirePermission` decorator. Unit tests fail if the invoices or clients controller gains such a route; other controllers rely on review.
- Offline-sync conflicts: the server applies changes to the latest state and does not detect concurrent edits of the same field. A protocol is proposed in [proposals/sync-conflicts.md](proposals/sync-conflicts.md) and waits on the owner's decisions; it is not implemented.
- Payments: refunds and disputes are not handled; a refunded or disputed invoice stays `paid` (decision needed: [proposals/payments-refunds-disputes.md](proposals/payments-refunds-disputes.md)). Each `/pay` call creates a new PaymentIntent. Online payment is limited to USD, EUR, GBP, CAD and AUD, because amounts are converted as total × 100. `client_secret` is no longer stored, but rows created before that change still hold it (the proposal has a count query and an optional cleanup).
- `PdfCacheService.getBrowser()` returns a browser whose pages are not locked down (no caller in the application today).
- Per-IP rate limiting is in memory, so it is approximate across replicas.

---

## Security Checklist

Before deploying to production:

- [ ] `ENABLE_SWAGGER=false`
- [ ] `CORS_ORIGIN` set to specific domains (not '*')
- [ ] `NODE_ENV=production`
- [ ] `LOG_LEVEL=info` (not debug)
- [ ] JWT secrets are 32+ characters and unique
- [ ] Database uses SSL (`DB_SSL=true`)
- [ ] All secrets are strong and unique
- [ ] Rate limiting configured appropriately
- [ ] File upload size limits enforced
- [ ] Error messages don't leak information
- [ ] S3 files are private (not public)
- [ ] HTTPS enabled (via reverse proxy)
- [ ] `TRUST_PROXY` names only the proxy; `PUBLIC_ORIGIN` (or `TRUSTED_HOSTS`) set if plain-HTTP GETs should be redirected
- [ ] Security headers enabled (Helmet)
- [ ] Input validation on all endpoints
- [ ] Authentication required for protected routes

## Common Attacks Prevented

### ✅ SQL Injection
- **Protection:** TypeORM parameterized queries
- **Status:** Protected

### ✅ XSS (Cross-Site Scripting)
- **Protection:** Input sanitization, CSP headers
- **Status:** Protected

### ✅ CSRF (Cross-Site Request Forgery)
- **Protection:** SameSite cookies, CORS restrictions
- **Status:** Protected (for API, consider CSRF tokens for web forms)

### ✅ Brute Force Attacks
- **Protection:** Rate limiting on auth endpoints
- **Status:** Protected

### ✅ DDoS Attacks
- **Protection:** Rate limiting, request size limits
- **Status:** Protected (basic, consider WAF for production)

### ✅ Path Traversal
- **Protection:** Filename sanitization
- **Status:** Protected

### ✅ Information Disclosure
- **Protection:** Generic error messages in production
- **Record existence:** per-record routes for clients, invoices, invoice
  templates and API keys look the record up scoped to the caller, so another
  user's id gets the same `404` and body (`"X not found"`,
  `NOT_FOUND_ERROR`) as an id that does not exist
  (`backend/test/non-disclosure.e2e-spec.ts`). `403` remains for callers
  who may know the resource exists but lack a permission (e.g. an API key
  without the required scope). Response timing is not equalised.
- **Status:** Protected

### ✅ Unauthorized File Access
- **Protection:** Private S3 files, signed URLs
- **Status:** Protected

### ✅ API Endpoint Discovery
- **Protection:** Swagger disabled in production
- **Status:** Protected

## Security Monitoring

### Recommended Monitoring

1. **Failed Login Attempts**
   - Monitor rate limit triggers
   - Alert on suspicious patterns

2. **Error Rates**
   - Monitor 500 errors
   - Alert on spikes

3. **Rate Limit Violations**
   - Track IPs hitting rate limits
   - Block persistent offenders

4. **File Upload Patterns**
   - Monitor upload sizes
   - Alert on unusual activity

5. **Database Connection Errors**
   - Monitor connection failures
   - Alert on potential attacks

## Incident Response

If a security incident occurs:

1. **Immediate Actions**
   - Rotate all secrets (JWT, database, S3, Stripe)
   - Review access logs
   - Check for unauthorized access

2. **Investigation**
   - Review error logs
   - Check audit logs
   - Identify attack vector

3. **Remediation**
   - Patch vulnerabilities
   - Update security measures
   - Notify affected users (if required)

4. **Prevention**
   - Update security documentation
   - Implement additional protections
   - Review security checklist

## Additional Security Recommendations

### For Production Deployment

1. **Use a Web Application Firewall (WAF)**
   - AWS WAF
   - Cloudflare
   - Other WAF solutions

2. **Implement DDoS Protection**
   - Cloudflare DDoS protection
   - AWS Shield
   - Other DDoS mitigation services

3. **Regular Security Audits**
   - Dependency vulnerability scanning
   - Code security reviews
   - Penetration testing

4. **Secrets Management**
   - Use AWS Secrets Manager
   - Use HashiCorp Vault
   - Never hardcode secrets

5. **Monitoring & Alerting**
   - Set up security alerts
   - Monitor failed login attempts
   - Track unusual API usage

6. **Backup & Recovery**
   - Regular database backups
   - Encrypted backups
   - Test recovery procedures

## Security Updates

Keep dependencies updated:

```bash
# Check for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix

# Update dependencies
npm update
```

## Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** create a public issue
2. Contact the maintainers privately
3. Provide detailed information
4. Allow time for remediation before disclosure

## Compliance

This application implements security measures aligned with:

- OWASP Top 10 protection
- Common security best practices
- Industry-standard authentication
- Data protection measures

For specific compliance requirements (GDPR, HIPAA, etc.), additional measures may be required.

