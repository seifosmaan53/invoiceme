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
- Per-IP address tracking
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
   TRUST_PROXY=true  # When behind load balancer
   ```

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

