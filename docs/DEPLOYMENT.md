# 🚀 InvoiceMe - Deployment Guide

## Quick Start

### Option 1: One-Click Deployment Script

```bash
# Make script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

### Option 2: Manual Deployment

Follow the steps below for manual deployment.

---

## Production Environment Configuration

### Overview

This section covers environment-based configuration strategy for deploying InvoiceMe across different environments (development, staging, production). Proper configuration ensures security, performance, and maintainability.

### Environment Strategy

**Development:**
- Local services (PostgreSQL, MinIO)
- Test API keys (Stripe test keys)
- Permissive CORS (`*` or localhost)
- Debug logging enabled
- Swagger documentation enabled

**Staging:**
- Separate staging database
- Test API keys (Stripe test keys)
- Staging domain CORS configuration
- Info-level logging
- Swagger optional

**Production:**
- Production database with backups
- Live API keys (Stripe live keys)
- Exact domain CORS (never `*`)
- Info-level logging (not debug)
- Swagger disabled
- HTTPS/SSL required
- Rate limiting enabled
- Monitoring configured

### Security Principles

1. **Never commit secrets** - Use environment variables, never hardcode
2. **Use secrets management** - AWS Secrets Manager, HashiCorp Vault, etc.
3. **Rotate secrets regularly** - JWT secrets every 90 days, API keys every 180 days
4. **Different secrets per environment** - Never reuse production secrets in development
5. **Validate secrets** - Use validation scripts before deployment
6. **Audit access** - Track who has access to production secrets

---

## Mobile App Production Configuration

### Flutter Build with Environment Variables

The mobile app uses `--dart-define` to configure the API URL at build time. This ensures the correct API endpoint is compiled into each build.

**Web Production Build:**
```bash
flutter build web --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

**Android Production Build:**
```bash
flutter build apk --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

**iOS Production Build:**
```bash
flutter build ios --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

### Environment-Specific Builds

Create different builds for each environment:

**Development:**
```bash
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

**Staging:**
```bash
flutter build web --release --dart-define=API_BASE_URL=https://staging-api.yourdomain.com/api/v1
```

**Production:**
```bash
flutter build web --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

### Verification

After building, verify the API URL is correctly configured:

1. **Check Network Logs**: Open browser DevTools → Network tab → Look for API requests
2. **Test Login**: Attempt to log in and verify the request goes to the correct domain
3. **Inspect Build**: For web builds, check the compiled JavaScript for the API URL
4. **Flutter DevTools**: Use Flutter DevTools to inspect network requests

---

## Backend CORS Configuration for Mobile Apps

### Understanding CORS

CORS (Cross-Origin Resource Sharing) controls which domains can make requests to your API. This is critical for web builds of the Flutter app, but native mobile apps (iOS/Android) don't require CORS configuration.

### Development CORS

For local development, you can use permissive settings:

```env
# Allow all origins (development only)
CORS_ORIGIN=*

# Or specify localhost ports
CORS_ORIGIN=http://localhost:3000,http://localhost:8080
```

### Production CORS

**⚠️ NEVER use `*` in production** - Always specify exact domains:

**Single Domain:**
```env
CORS_ORIGIN=https://app.yourdomain.com
```

**Multiple Domains (web + mobile web):**
```env
CORS_ORIGIN=https://app.yourdomain.com,https://mobile.yourdomain.com
```

**With Subdomains:**
```env
CORS_ORIGIN=https://*.yourdomain.com
```

### Mobile Native Apps

Native iOS and Android apps don't need CORS configuration because they don't run in a browser. CORS only applies to:
- Web builds of Flutter apps
- Browser-based applications
- API calls from web pages

### Testing CORS

Test CORS configuration with curl:

```bash
curl -H "Origin: https://app.yourdomain.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     https://api.yourdomain.com/api/v1/auth/login
```

Expected response should include:
- `Access-Control-Allow-Origin: https://app.yourdomain.com`
- `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, PUT`
- `Access-Control-Allow-Headers: Content-Type, Authorization`

### Common CORS Errors

**Error: "CORS policy: No 'Access-Control-Allow-Origin' header"**
- **Solution**: Add your domain to `CORS_ORIGIN` in backend `.env`

**Error: "CORS policy: Credentials flag is true, but 'Access-Control-Allow-Credentials' is not set"**
- **Solution**: Ensure backend CORS configuration includes `credentials: true`

**Error: "CORS policy: Method POST is not allowed"**
- **Solution**: Add POST (and other methods) to `Access-Control-Allow-Methods`

---

## Production Secrets Management

### JWT Secrets

**Requirements:**
- Minimum 32 characters
- Must be cryptographically random
- Must be different for `JWT_SECRET` and `JWT_REFRESH_SECRET`
- Never reuse across environments

**Generation:**
```bash
# Generate secure JWT secret
openssl rand -base64 32

# Generate refresh secret (must be different)
openssl rand -base64 32
```

**Storage:**
- Store in environment variables (never hardcode)
- Use secrets management service in production (AWS Secrets Manager, HashiCorp Vault)
- Rotate every 90 days
- Never log or include in error messages

### Stripe Keys

**Development:**
- Use test keys: `sk_test_...`
- Safe to commit to version control (test keys only)

**Production:**
- Use live keys: `sk_live_...`
- **NEVER commit live keys to git**
- Rotate if compromised
- Configure webhook secret for production endpoint: `https://your-domain.com/api/v1/webhooks/stripe`

**Best Practices:**
- Use separate Stripe accounts for dev/staging/production
- Monitor Stripe dashboard for suspicious activity
- Set up webhook endpoints in Stripe dashboard
- Test webhooks with Stripe CLI before production

### S3 Credentials

**IAM Roles (Recommended):**
- Use IAM roles when possible (AWS ECS, EC2)
- No credentials to manage
- Automatic rotation
- Minimal permissions principle

**IAM Users (Alternative):**
- Create dedicated IAM user with minimal permissions
- Required S3 permissions: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`
- Enable bucket versioning for production
- Configure bucket CORS for web uploads

**Bucket Policy Example (Public Read Access):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

### Database Credentials

**Requirements:**
- Strong passwords (16+ characters, mixed case, numbers, symbols)
- Enable SSL/TLS for database connections in production
- Use connection pooling (TypeORM handles this automatically)
- Restrict database access by IP if possible

**Cloud Provider Examples:**
- **AWS RDS**: Use IAM database authentication when possible
- **Heroku Postgres**: Credentials in `DATABASE_URL`
- **DigitalOcean**: Use connection pooling and SSL

---

## Email/SMTP Configuration

The InvoiceMe application sends transactional emails for password resets and invoice notifications. Proper email configuration is essential for reliable delivery and user experience.

### Development SMTP Setup

For development, use test SMTP services to avoid sending emails to real users. This is crucial for testing email functionality without spamming customers.

#### Mailtrap Setup (Recommended)

**Mailtrap** is the recommended service for development email testing. It provides a safe environment to test emails without risk of sending to real users.

**Steps:**

1. **Sign up**: Create a free account at [https://mailtrap.io](https://mailtrap.io)
   - Free tier includes 500 emails/month
   - No credit card required

2. **Create an inbox**: 
   - After signing up, create a new inbox
   - Choose a name like "InvoiceMe Development"

3. **Get SMTP credentials**:
   - Go to inbox settings
   - Select "SMTP Settings" tab
   - Choose "SMTP" option (not API)
   - Copy the SMTP credentials

4. **Configure `.env` file**:
   ```env
   SMTP_HOST=sandbox.smtp.mailtrap.io
   SMTP_PORT=2525
   SMTP_USER=your-mailtrap-username
   SMTP_PASS=your-mailtrap-password
   EMAIL_FROM=noreply@invoiceme.com
   FRONTEND_URL=http://localhost:8080
   SUPPORT_EMAIL=support@invoiceme.com
   ```

5. **Test email sending**:
   - Trigger a password reset or send an invoice
   - Check your Mailtrap inbox to view the email
   - Verify email content, styling, and links work correctly

6. **View emails**:
   - All test emails appear in your Mailtrap inbox
   - Inspect HTML content, headers, and attachments
   - Test email rendering across different clients

**Benefits:**
- No risk of sending test emails to real users
- View all emails in web interface
- Test email rendering across clients
- Inspect email headers and content
- Free tier sufficient for development

#### Ethereal Email Setup (Alternative)

**Ethereal Email** provides instant email accounts for testing without signup.

**Steps:**

1. **Generate account**: Visit [https://ethereal.email](https://ethereal.email)
   - Click "Create Ethereal Account"
   - No signup required - generates instantly

2. **Copy credentials**:
   - Copy SMTP settings from the generated account page
   - Credentials are displayed immediately

3. **Configure `.env` file**:
   ```env
   SMTP_HOST=smtp.ethereal.email
   SMTP_PORT=587
   SMTP_USER=your-ethereal-username
   SMTP_PASS=your-ethereal-password
   EMAIL_FROM=noreply@invoiceme.com
   FRONTEND_URL=http://localhost:8080
   SUPPORT_EMAIL=support@invoiceme.com
   ```

4. **View emails**:
   - Click the provided URL to view received emails
   - Emails are stored temporarily (typically 24 hours)

**Benefits:**
- Instant setup, no signup required
- Good for quick testing
- Temporary accounts (auto-expire)

**Note:** For long-term development, Mailtrap is recommended as it provides persistent inboxes and better features.

### Production SMTP Setup

For production, use a transactional email service with verified domain and proper DNS configuration. Personal email services (Gmail, Outlook) are **not recommended** for production use.

#### Recommended Services

**SendGrid** (Recommended for most use cases)
- Generous free tier (100 emails/day)
- Excellent deliverability
- Easy domain verification
- Good documentation and support
- Pricing: Free tier, then $19.95/month for 50k emails

**Mailgun**
- Good for high-volume sending
- Strong deliverability
- Advanced analytics
- Pricing: Free tier (5k emails/month), then pay-as-you-go

**AWS SES**
- Cost-effective ($0.10 per 1000 emails)
- Requires AWS account
- Good for AWS-integrated applications
- Must move out of "sandbox" mode for production

**Postmark**
- Excellent deliverability
- Fast delivery
- Great for transactional emails
- Pricing: 100 emails/month free, then $15/month for 10k emails

#### SendGrid Setup (Detailed)

**Steps:**

1. **Sign up**: Create an account at [https://sendgrid.com](https://sendgrid.com)
   - Use the free tier to get started
   - Verify your email address

2. **Verify sender**:
   - Go to Settings → Sender Authentication
   - Choose "Single Sender Verification" for testing
   - For production, use "Domain Authentication" (recommended)

3. **Create API key**:
   - Go to Settings → API Keys
   - Click "Create API Key"
   - Name it "InvoiceMe Production"
   - Select "Full Access" or "Mail Send" permissions
   - Copy the API key immediately (shown only once)

4. **Configure production `.env`**:
   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASS=your-sendgrid-api-key-here
   EMAIL_FROM=noreply@yourdomain.com
   FRONTEND_URL=https://app.yourdomain.com
   SUPPORT_EMAIL=support@yourdomain.com
   ```

5. **Configure DNS records** (Domain Authentication - Recommended):
   - SPF Record: `v=spf1 include:sendgrid.net ~all`
   - DKIM Records: Provided by SendGrid in domain settings
   - DMARC Record: `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`

6. **Test email sending**:
   - Test password reset email
   - Test invoice email
   - Verify emails are delivered (check spam folder initially)
   - Monitor SendGrid dashboard for bounces/complaints

#### Domain Verification

Domain verification is **critical** for production email delivery. Unverified domains may:
- Have emails marked as spam
- Be rejected by email providers
- Experience poor deliverability rates

**Verification Process:**
1. Verify your domain in your email service provider
2. Add DNS records (SPF, DKIM, DMARC) to your domain
3. Wait for DNS propagation (typically 1-24 hours)
4. Confirm verification status in your email service dashboard

**Provider-Specific Guides:**
- **SendGrid**: [Domain Authentication Guide](https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication)
- **Mailgun**: [Domain Verification Guide](https://documentation.mailgun.com/en/latest/user_manual.html#verifying-your-domain)
- **AWS SES**: [Domain Verification Guide](https://docs.aws.amazon.com/ses/latest/dg/verify-domain-procedure.html)

#### DNS Configuration

Proper DNS records improve email deliverability and prevent spam filtering.

**SPF Record** (Sender Policy Framework):
```
TXT @ v=spf1 include:sendgrid.net ~all
```
- Authorizes SendGrid to send emails on behalf of your domain
- Prevents email spoofing

**DKIM Record** (DomainKeys Identified Mail):
- Provided by your email service provider
- Verifies email authenticity
- Typically includes selector (e.g., `s1._domainkey.yourdomain.com`)

**DMARC Record** (Domain-based Message Authentication):
```
TXT _dmarc v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com
```
- Start with `p=none` for monitoring
- Gradually move to `p=quarantine` then `p=reject`
- Provides reporting on email authentication

### Testing Email Functionality

Before deploying to production, thoroughly test email functionality in your environment.

#### Password Reset Email Test

1. **Start backend** with SMTP configured
2. **Request password reset**:
   - Use API endpoint: `POST /api/v1/auth/password-reset-request`
   - Or use frontend password reset form
3. **Check inbox**:
   - Development: Check Mailtrap/Ethereal inbox
   - Production: Check target email inbox (including spam folder)
4. **Verify email content**:
   - Email subject: "Reset Your Password - InvoiceMe"
   - Reset button/link is present
   - Link contains reset token
   - Styling renders correctly
5. **Test reset link**:
   - Click reset link
   - Verify redirects to frontend reset password page
   - Verify token is passed correctly

#### Invoice Email Test

1. **Create test invoice** with client email address
2. **Send invoice**:
   - Use API endpoint: `POST /api/v1/invoices/:id/send`
   - Or use frontend "Send Invoice" button
3. **Check inbox**:
   - Development: Check Mailtrap/Ethereal inbox
   - Production: Check client email inbox
4. **Verify email content**:
   - Email subject: "Invoice #INV-001 from YourCompany"
   - Invoice summary (number, amount, due date) is correct
   - "View Invoice" button/link works
   - "Download PDF" button/link works (if PDF generated)
   - Styling matches brand
5. **Test links**:
   - View invoice link redirects correctly
   - PDF download link works

#### Connection Verification

1. **Health check endpoint**:
   - Use `/api/health` endpoint to check SMTP connection
   - Verify email service status

2. **Backend logs**:
   - Check logs for email sending errors
   - Look for SMTP connection issues
   - Verify retry logic is working

3. **Manual SMTP test**:
   - Test SMTP connection using telnet:
     ```bash
     telnet smtp.sendgrid.net 587
     ```
   - Or use online SMTP tester tools

4. **Test retry logic**:
   - Temporarily break SMTP configuration
   - Trigger email send
   - Verify retries occur (check logs)
   - Fix configuration and verify success

### Email Troubleshooting

Common email issues and solutions:

#### Connection Refused
**Error:** `Connection refused` or `ECONNREFUSED`

**Causes:**
- Incorrect `SMTP_HOST` or `SMTP_PORT`
- Firewall blocking SMTP port
- Network connectivity issues

**Solutions:**
- Verify `SMTP_HOST` and `SMTP_PORT` in `.env`
- Check firewall allows outbound SMTP (port 587/465)
- Test SMTP connection with telnet or online tools
- Try alternative port (587 vs 465)

#### Authentication Failed
**Error:** `Invalid login` or `Authentication failed`

**Causes:**
- Incorrect `SMTP_USER` or `SMTP_PASS`
- API key expired or revoked
- Account suspended or disabled

**Solutions:**
- Verify credentials in `.env` file
- Regenerate API key in email service dashboard
- Check account status in email service dashboard
- For SendGrid, ensure using `apikey` as username

#### Sender Not Verified
**Error:** `Sender email not verified` or emails marked as spam

**Causes:**
- Domain/email not verified in email service
- DNS records not configured
- Using unverified sender address

**Solutions:**
- Verify domain/email in email service provider
- Add SPF, DKIM, DMARC DNS records
- Use verified email address in `EMAIL_FROM`
- Wait for DNS propagation (up to 24 hours)

#### Emails Not Received
**Symptoms:** Emails sent but not appearing in inbox

**Causes:**
- Emails in spam folder
- Email service rate limiting
- Email address is invalid
- Domain reputation issues

**Solutions:**
- Check spam/junk folder
- Verify email address is correct
- Check email service dashboard for bounces
- Review email service logs for delivery status
- Wait and retry (rate limits may apply)

#### Template Not Found
**Error:** `Email template not found`

**Causes:**
- Template files missing from `backend/src/core/templates/`
- Incorrect file paths
- Build process not copying templates

**Solutions:**
- Verify template files exist: `password-reset.html`, `invoice-email.html`
- Check file paths in email service code
- Ensure templates are copied during build
- Check file permissions

#### Debugging Tips

1. **Enable debug logging**:
   ```env
   LOG_LEVEL=debug
   ```
   - Check backend logs for detailed email errors
   - Verify SMTP configuration is loaded

2. **Inspect email content**:
   - Use Mailtrap to view email HTML source
   - Check for template variable replacement issues
   - Verify links are correctly formatted

3. **Test SMTP connection manually**:
   ```bash
   # Test SMTP connection
   telnet smtp.sendgrid.net 587
   
   # Or use online SMTP tester
   # https://www.mail-tester.com/
   ```

4. **Verify environment variables**:
   ```bash
   # In backend directory
   node -e "require('dotenv').config(); console.log(process.env.SMTP_HOST)"
   ```

5. **Check email service dashboard**:
   - Review delivery statistics
   - Check bounce and complaint rates
   - Review email logs for specific failures

### Email Security Best Practices

1. **Never commit SMTP credentials to git**
   - Use `.env` files (already in `.gitignore`)
   - Store production credentials in secrets manager

2. **Use different credentials for each environment**
   - Development: Mailtrap/Ethereal
   - Staging: Separate test account
   - Production: Verified domain with proper credentials

3. **Rotate credentials regularly**
   - Change SMTP passwords every 90 days
   - Regenerate API keys if compromised
   - Update credentials in secrets manager

4. **Use environment-specific EMAIL_FROM addresses**
   - Development: `noreply@invoiceme.com` (test)
   - Production: `noreply@yourdomain.com` (verified domain)

5. **Configure SPF, DKIM, and DMARC for production**
   - Prevents email spoofing
   - Improves deliverability
   - Builds domain reputation

6. **Monitor bounce rates and spam complaints**
   - Set up alerts in email service dashboard
   - Investigate high bounce rates
   - Remove invalid email addresses

7. **Implement rate limiting for email sending**
   - Prevents abuse
   - Reduces risk of account suspension
   - Consider using email service rate limits

8. **Validate recipient email addresses**
   - Verify email format before sending
   - Check for disposable/temporary email addresses
   - Implement email verification for new accounts

9. **Use TLS/SSL for SMTP connections**
   - Always use port 587 (TLS) or 465 (SSL)
   - Never use unencrypted port 25
   - Verify TLS certificate in production

10. **Keep email service libraries updated**
    - Update `nodemailer` regularly
    - Monitor security advisories
    - Test updates in development first

---

## Environment-Specific Configuration Checklist

### Development

- [ ] `NODE_ENV=development`
- [ ] `CORS_ORIGIN=*` or `http://localhost:*`
- [ ] Stripe test keys (`sk_test_...`)
- [ ] Local database (PostgreSQL on localhost)
- [ ] MinIO for S3 (docker-compose)
- [ ] Swagger enabled (`ENABLE_SWAGGER=true`)
- [ ] Debug logging (`LOG_LEVEL=debug`)

### Staging

- [ ] `NODE_ENV=staging`
- [ ] `CORS_ORIGIN=https://staging.yourdomain.com`
- [ ] Stripe test keys (`sk_test_...`)
- [ ] Staging database (separate from prod)
- [ ] Cloud S3 (separate bucket from prod)
- [ ] Swagger enabled (optional)
- [ ] Info logging (`LOG_LEVEL=info`)

### Production

- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN=https://app.yourdomain.com` (exact domains, not `*`)
- [ ] Stripe live keys (`sk_live_...`)
- [ ] Production database with backups
- [ ] Cloud S3 with versioning
- [ ] Swagger disabled (`ENABLE_SWAGGER=false`)
- [ ] HTTPS/SSL enabled
- [ ] Rate limiting enabled (`RATE_LIMIT_TTL`, `RATE_LIMIT_MAX`)
- [ ] Monitoring/logging configured
- [ ] Info logging (`LOG_LEVEL=info`, not debug)
- [ ] `TRUST_PROXY=true` (if behind load balancer)

---

## Secrets Validation Script

Use the provided validation script to check your environment configuration before deployment:

```bash
# Validate current environment variables
./backend/scripts/validate-env.sh

# Validate specific .env file
./backend/scripts/validate-env.sh backend/.env
```

The script checks:
- JWT secret length (must be 32+ characters)
- CORS is not wildcard in production
- Stripe key type (warns if using test key in production)
- NODE_ENV is set correctly
- Required variables are not empty
- Database configuration is complete
- S3 configuration is complete

See `backend/scripts/validate-env.sh` for full validation logic.

---

## Docker Deployment (Recommended)

Docker provides a consistent environment across development, testing, and production. The project includes a multi-stage Dockerfile optimized for production and a docker-compose setup for local development.

### Multi-Stage Dockerfile

The `backend/Dockerfile` uses a multi-stage build process to create an optimized production image:

**Stage 1 - Production Dependencies:**
- Installs only production dependencies to minimize image size
- Uses `node:20-alpine` for minimal footprint

**Stage 2 - Dev Dependencies:**
- Installs all dependencies including devDependencies needed for building

**Stage 3 - Build:**
- Compiles TypeScript to JavaScript
- Copies source code and build configuration
- Runs `npm run build` to create the `dist/` directory

**Stage 4 - Production:**
- Creates final minimal image with only production dependencies
- Includes health check using curl
- Runs as non-root user for security
- Exposes port 3000

### Build & Run Docker Image

```bash
cd backend
docker build -t invoiceme-backend .
docker run -p 3000:3000 --env-file .env invoiceme-backend
```

### Production Deployment with Docker

For deploying the Docker image to production:

**On a VPS:**
```bash
# Pull the image (if pushed to registry)
docker pull username/invoiceme-backend:latest

# Run with environment variables
docker run -d \
  --name invoiceme-backend \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  username/invoiceme-backend:latest

# Set up reverse proxy (nginx) for HTTPS
# Configure systemd service for auto-restart
```

**Cloud Providers:**
- **AWS ECS**: Use the Docker image in ECS task definitions
- **Google Cloud Run**: Deploy container directly
- **Azure Container Instances**: Run container with environment variables
- **DigitalOcean App Platform**: Connect Docker registry and deploy

---

## Docker Compose for Local Development

The `docker-compose.yml` file provides a complete local development environment with all required services.

### Prerequisites

- Docker and Docker Compose installed
- `backend/.env` file created (copy from `backend/env.example`)

### Quick Start

1. **Copy environment file:**
```bash
cp backend/env.example backend/.env
# Edit backend/.env with your configuration
```

2. **Start all services:**
```bash
docker-compose up -d
```

3. **View logs:**
```bash
docker-compose logs -f backend
```

4. **Run database migrations:**
```bash
docker-compose exec backend npm run migration:run
```

5. **Stop services:**
```bash
docker-compose down
```

6. **Clean up (⚠️ deletes all data):**
```bash
docker-compose down -v
```

### Services Included

The docker-compose setup includes:

- **PostgreSQL**: Database server running on port 5432
  - Data persisted in `postgres_data` volume
  - Health checks ensure database is ready before backend starts

- **MinIO**: S3-compatible storage running on ports 9000 (API) and 9001 (Console UI)
  - Data persisted in `minio_data` volume
  - Access console at http://localhost:9001 (default: minioadmin/minioadmin)
  - Bucket `invoiceme` is automatically created by the init container

- **Backend**: NestJS API running on port 3000
  - Built from `backend/Dockerfile`
  - Waits for PostgreSQL and MinIO to be healthy before starting
  - Access API at http://localhost:3000/api
  - For hot-reload development, uncomment volume mount in docker-compose.yml

- **MinIO Init**: Initialization container that creates the S3 bucket
  - Runs automatically after MinIO is ready
  - Sets bucket permissions for public read access

All services communicate via the `invoiceme-network` Docker network, using service names (e.g., `postgres`, `minio`) instead of `localhost`.

---

## Health Check Endpoint

The backend includes a health check endpoint at `/api/health` for monitoring and container orchestration.

### Usage

```bash
# Check health status
curl http://localhost:3000/api/health
```

### Response Format

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "database": "connected",
  "version": "1.0.0",
  "environment": "production"
}
```

### Use Cases

- **Docker Health Checks**: Automatically monitors container health
- **Load Balancer Probes**: Kubernetes, AWS ALB, etc. can use this endpoint
- **Monitoring Tools**: Integrate with Prometheus, Datadog, etc.
- **CI/CD**: Verify deployment success

### Docker Compose Health Check Example

The Dockerfile includes a health check that uses this endpoint:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1
```

---

## CI/CD Pipeline

The project includes a comprehensive GitHub Actions workflow (`.github/workflows/ci.yml`) that automates testing, building, and deployment.

### Workflow Overview

**Triggers:**
- Push to `main` branch
- Pull requests to `main` branch

**Jobs:**

1. **backend-test**: Runs on Node.js 18 and 20
   - Installs dependencies
   - Runs linter
   - Runs unit tests
   - Runs e2e tests
   - Generates coverage reports
   - Uploads coverage artifacts

2. **backend-build**: Builds the application (only on push to main)
   - Compiles TypeScript
   - Uploads build artifacts

3. **backend-docker**: Builds and pushes Docker image (only on push to main)
   - Builds Docker image using multi-stage Dockerfile
   - Pushes to Docker Hub (if credentials configured)
   - Uses layer caching for faster builds

4. **mobile-build**: Builds Flutter web app (only on push to main)
   - Runs Flutter analyzer
   - Runs Flutter tests
   - Builds web release
   - Uploads build artifacts

5. **deploy**: Deployment job (customize based on target)
   - Placeholder for deployment steps
   - Can be configured for AWS, Render, Railway, Netlify, Vercel, etc.

### Required GitHub Secrets

Configure these in GitHub: **Settings → Secrets and variables → Actions → New repository secret**

- `JWT_SECRET`: JWT secret for running tests (minimum 32 characters)
- `JWT_REFRESH_SECRET`: JWT refresh secret for running tests (minimum 32 characters)
- `DOCKER_USERNAME`: Docker Hub username (optional, for Docker push)
- `DOCKER_TOKEN`: Docker Hub access token (optional, for Docker push)
- `API_BASE_URL`: Production API URL for Flutter web builds (optional)

### Status Badges

Add to your README.md:

```markdown
![CI/CD Pipeline](https://github.com/username/invoiceme/actions/workflows/ci.yml/badge.svg)
```

---

## Backend Deployment

### Prerequisites

- Node.js 20+ installed
- PostgreSQL database (local or cloud)
- AWS S3 bucket (or S3-compatible storage)
- Stripe account (for payments)

### Step 1: Environment Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Copy environment file:
```bash
cp env.example .env
```

3. Edit `.env` with your configuration:
```env
# Database
# Note: DATABASE_URL is optional - the application uses DB_* variables below
# DATABASE_URL=postgresql://user:password@localhost:5432/invoiceme
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=your_user
DB_PASSWORD=your_password
DB_DATABASE=invoiceme

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this-in-production
JWT_REFRESH_EXPIRES_IN=7d

# Server
API_PORT=3000
NODE_ENV=production

# S3 Storage (AWS S3 or compatible)
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET=your-bucket-name

# Stripe (for payments)
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

### Step 2: Install Dependencies & Run Migrations

```bash
npm install
npm run migration:run
```

### Step 3: Start Backend

**Development:**
```bash
npm run start:dev
```

**Production:**
```bash
npm run build
npm run start:prod
```

**Using PM2 (Recommended):**
```bash
npm install -g pm2
pm2 start dist/main.js --name invoiceme-backend
pm2 save
pm2 startup
```

---

## Mobile App Deployment

### Prerequisites

- Flutter SDK installed
- Android Studio / Xcode (for mobile builds)
- Chrome (for web build)

### Step 1: Configure API URL

**For Production:**

Use `--dart-define` to configure the API URL at build time (recommended):

```bash
# Web production build
flutter build web --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1

# Android production build
flutter build apk --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1

# iOS production build
flutter build ios --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

**Verification:**
1. After building, check network requests in browser DevTools (for web builds)
2. Test login functionality to verify API connection
3. Check compiled JavaScript for web builds to confirm API URL is embedded

**Multiple Environments:**
For different environments, use different `--dart-define` values:

```bash
# Development
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1

# Staging
flutter build web --release --dart-define=API_BASE_URL=https://staging-api.yourdomain.com/api/v1

# Production
flutter build web --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

**CI/CD Integration (GitHub Actions):**
```yaml
- name: Build Flutter Web
  run: |
    flutter build web --release \
      --dart-define=API_BASE_URL=${{ secrets.API_BASE_URL_PROD }}
```

### Step 2: Build App

**Web (Production):**
```bash
cd mobile
flutter build web --release
```

**Android:**
```bash
flutter build apk --release
# or for app bundle (Play Store)
flutter build appbundle --release
```

**iOS:**
```bash
flutter build ios --release
```

### Step 3: Deploy Web Build

Copy the `mobile/build/web/` directory to your web server:

```bash
# Example: Deploy to server
scp -r mobile/build/web/* user@your-server.com:/var/www/invoiceme/

# Or use CI/CD (GitHub Actions, GitLab CI, etc.)
```

---

## Cloud Deployment Options

### Backend

**Render.com:**
1. Connect your GitHub repo
2. Select backend directory
3. Set environment variables
4. Deploy

**Railway.app:**
1. New Project → Deploy from GitHub
2. Select backend directory
3. Add PostgreSQL database
4. Set environment variables
5. Deploy

**AWS/Heroku/DigitalOcean:**
- Follow standard Node.js deployment guides
- Ensure PostgreSQL database is accessible
- Configure environment variables

### Mobile Web

**Netlify:**
1. Connect GitHub repo
2. Build command: `cd mobile && flutter build web`
3. Publish directory: `mobile/build/web`
4. Deploy

**Vercel:**
1. Connect GitHub repo
2. Framework: Other
3. Build command: `cd mobile && flutter build web`
4. Output directory: `mobile/build/web`
5. Deploy

**Firebase Hosting:**
```bash
cd mobile
flutter build web
firebase deploy
```

---

## Environment Variables Checklist

### Backend (.env)

**Database:**
- [ ] DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE (preferred)
- [ ] Note: DATABASE_URL is optional - if your platform requires it (e.g., Heroku), you can set it, but the app primarily uses DB_* variables as shown in env.example
- [ ] DB_SSL=true (for production cloud databases)
- [ ] DB_SSL_REJECT_UNAUTHORIZED=false (for cloud databases with self-signed certs)

**JWT & Authentication:**
- [ ] JWT_SECRET (32+ characters, cryptographically random)
- [ ] JWT_REFRESH_SECRET (32+ characters, different from JWT_SECRET)
- [ ] JWT_EXPIRES_IN
- [ ] JWT_REFRESH_EXPIRES_IN

**Server:**
- [ ] API_PORT
- [ ] NODE_ENV=production (for production)
- [ ] TRUST_PROXY=true (if behind load balancer)

**S3/Storage:**
- [ ] S3_ENDPOINT
- [ ] S3_REGION
- [ ] S3_ACCESS_KEY_ID
- [ ] S3_SECRET_ACCESS_KEY
- [ ] S3_BUCKET

**Stripe:**
- [ ] STRIPE_SECRET_KEY (live key for production: `sk_live_...`)
- [ ] STRIPE_WEBHOOK_SECRET

**Email/SMTP:**
- [ ] SMTP_HOST (production email service, not Mailtrap/Ethereal)
- [ ] SMTP_PORT (587 for TLS, 465 for SSL)
- [ ] SMTP_USER (SendGrid: 'apikey', Mailgun: SMTP username)
- [ ] SMTP_PASS (SendGrid: API key, Mailgun: SMTP password)
- [ ] EMAIL_FROM (verified domain email address for production)
- [ ] FRONTEND_URL (HTTPS production domain for email links)
- [ ] SUPPORT_EMAIL (support email for email footers)

**CORS & Security:**
- [ ] CORS_ORIGIN (exact domains, not `*` in production)
- [ ] RATE_LIMIT_TTL
- [ ] RATE_LIMIT_MAX
- [ ] LOG_LEVEL=info (for production)
- [ ] ENABLE_SWAGGER=false (for production)

**Validation:**
- [ ] Run validation script: `./backend/scripts/validate-env.sh backend/.env`
- [ ] All secrets are 32+ characters
- [ ] CORS_ORIGIN specifies exact domains (not `*`)

**Note:** For Docker deployments, ensure `.env` file exists in `backend/` directory. Docker Compose will automatically load it. When using Docker, set `DB_HOST=postgres` (service name) instead of `localhost`.

### Mobile App

- [ ] API_BASE_URL (production API endpoint)

---

## Post-Deployment Checklist

**Backend:**
- [ ] Backend is running and accessible
- [ ] Database migrations completed
- [ ] API endpoints responding (check `/api/health`)
- [ ] Health check endpoint returns `status: "ok"` and `database: "connected"`

**Email Configuration:**
- [ ] SMTP connection verified (check health endpoint)
- [ ] Domain verified in email service provider
- [ ] SPF and DKIM records configured in DNS
- [ ] Test password reset email sent successfully
- [ ] Test invoice email sent successfully
- [ ] Email templates rendering correctly
- [ ] Email links working (password reset, invoice view)
- [ ] Emails not going to spam folder
- [ ] Email service dashboard shows successful deliveries

**Secrets & Security:**
- [ ] JWT secrets are 32+ characters and cryptographically random
- [ ] JWT_SECRET and JWT_REFRESH_SECRET are different
- [ ] CORS_ORIGIN specifies exact production domains (not `*`)
- [ ] Stripe live keys configured (not test keys: `sk_live_...`)
- [ ] S3 bucket has proper IAM permissions
- [ ] Database uses SSL/TLS connections
- [ ] Secrets not committed to git (check `.env` in `.gitignore`)
- [ ] Environment variables validated with script

**Storage:**
- [ ] S3 bucket accessible and configured
- [ ] S3 bucket versioning enabled (production)
- [ ] S3 bucket CORS configured (for web uploads)

**Payments:**
- [ ] Stripe webhooks configured (if using payments)
- [ ] Webhook endpoint: `https://your-domain.com/api/v1/webhooks/stripe`
- [ ] Webhook secret configured in Stripe dashboard

**Mobile App:**
- [ ] Mobile app built with production API URL
- [ ] API URL verified in mobile app (test login)
- [ ] CORS tested from production mobile domain

**Infrastructure:**
- [ ] SSL/HTTPS enabled for production
- [ ] Docker images built successfully (if using Docker)
- [ ] Docker containers running (check with `docker ps`)
- [ ] Docker volumes created for data persistence
- [ ] MinIO bucket created and accessible (if using docker-compose)

**CI/CD:**
- [ ] GitHub Actions workflow runs successfully
- [ ] All tests pass in CI
- [ ] Docker image pushed to registry (if configured)
- [ ] GitHub secrets configured

---

## Troubleshooting

### Backend won't start
- Check database connection
- Verify all environment variables are set
- Check logs: `pm2 logs invoiceme-backend` or `docker-compose logs backend`

### Mobile app can't connect
- Verify API_BASE_URL is correct
- Check CORS settings on backend
- Verify backend is accessible from mobile device

### File uploads fail
- Verify S3 credentials
- Check S3 bucket permissions
- Verify bucket exists

### Docker Troubleshooting

**Container won't start:**
- Check logs: `docker-compose logs backend`
- Verify `.env` file exists and is properly configured
- Check service dependencies: `docker-compose ps`

**Port conflicts:**
- Change ports in `docker-compose.yml` if 3000, 5432, 9000, or 9001 are already in use
- Example: Change `"3000:3000"` to `"3001:3000"` for backend

**Permission issues:**
- Check file ownership: `ls -la backend/`
- Ensure Docker has permissions to access the directory
- On Linux, may need to add user to docker group: `sudo usermod -aG docker $USER`

**Database connection issues:**
- Verify service names in `.env`: Use `postgres` not `localhost` when using docker-compose
- Check PostgreSQL health: `docker-compose exec postgres pg_isready`
- Verify database credentials match docker-compose.yml

**MinIO bucket not created:**
- Check minio-init container logs: `docker-compose logs minio-init`
- Manually create bucket: `docker-compose exec minio-init mc mb myminio/invoiceme`

### CI/CD Troubleshooting

**Tests fail in CI but pass locally:**
- Check environment variables in workflow file
- Verify database setup (test database created)
- Check Node.js version matches local environment
- Review test logs in GitHub Actions

**Docker build fails:**
- Check Dockerfile syntax
- Verify build context is correct (`./backend`)
- Check for missing files in `.dockerignore`
- Review build logs in GitHub Actions

**Secrets not working:**
- Verify secret names match workflow file exactly
- Check secret values are set in GitHub Settings
- Ensure secrets are not empty
- Review workflow logs for secret-related errors

---

## Security Notes

1. **Never commit `.env` files** to version control
2. **Use strong JWT_SECRET** in production (32+ characters, cryptographically random)
3. **Enable HTTPS** for production
4. **Configure CORS** properly (never use `*` in production)
5. **Use environment-specific secrets** (different secrets for each environment)
6. **Enable rate limiting** on backend
7. **Use database connection pooling** (TypeORM handles this)
8. **Set up monitoring** (Sentry, LogRocket, etc.)
9. **Run containers as non-root user** (Dockerfile already configured)
10. **Use secrets management** for production (AWS Secrets Manager, HashiCorp Vault, etc.)
11. **Rotate secrets regularly** - JWT secrets every 90 days, API keys every 180 days
12. **Never log secrets** or include in error messages
13. **Use environment variables** - never hardcode secrets
14. **Audit secret access** - track who has access to production secrets
15. **Validate secrets before deployment** - use validation scripts

---

## Support

For issues or questions:
- Check logs first
- Review error messages
- Verify environment variables
- Check network connectivity
- Review Docker logs if using containers
- Check GitHub Actions workflow logs for CI/CD issues

**Happy Deploying! 🚀**
