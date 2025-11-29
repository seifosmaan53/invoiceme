# 🔧 Environment Management Guide

Guide for managing different environments (development, staging, production).

---

## Environment Files

Create separate `.env` files for each environment:

- `.env.development` - Local development
- `.env.staging` - Staging/pre-production
- `.env.production` - Production

**⚠️ IMPORTANT:** Never commit `.env` files with real secrets to version control!

---

## Creating Environment Files

### Development

```bash
cd backend
cp .env.example .env.development
# Edit .env.development with development values
```

### Staging

```bash
cp .env.example .env.staging
# Edit .env.staging with staging values
```

### Production

```bash
cp .env.example .env.production
# Edit .env.production with production values
# Use secrets management (AWS Secrets Manager, HashiCorp Vault)
```

---

## Using Environment Files

### Local Development

```bash
# Use .env.development
cp .env.development .env
npm run start:dev
```

### Docker

```bash
# Development
docker-compose --env-file .env.development up

# Staging
docker-compose --env-file .env.staging up

# Production
docker-compose --env-file .env.production up
```

### CI/CD

Use GitHub Secrets or your CI/CD platform's secrets management:

```yaml
env:
  NODE_ENV: production
  DB_HOST: ${{ secrets.DB_HOST }}
  DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  # ... other secrets
```

---

## Environment-Specific Configuration

### Development
- Local database
- Test API keys
- Permissive CORS (`*`)
- Swagger enabled
- Debug logging

### Staging
- Staging database
- Test API keys
- Staging domain CORS
- Swagger optional
- Info logging

### Production
- Production database
- Live API keys
- Exact domain CORS (never `*`)
- Swagger disabled
- Info logging
- HTTPS required

---

## Secrets Management

### AWS Secrets Manager

```bash
aws secretsmanager get-secret-value --secret-id invoiceme/production
```

### HashiCorp Vault

```bash
vault kv get secret/invoiceme/production
```

### Environment Variables

```bash
export DB_PASSWORD="your-password"
export JWT_SECRET="your-secret"
```

---

## Best Practices

1. **Never commit secrets** - Use `.gitignore` for `.env*` files
2. **Rotate secrets regularly** - Every 90 days for JWT, 180 days for API keys
3. **Use different secrets per environment** - Never reuse production secrets
4. **Validate secrets** - Use validation scripts before deployment
5. **Audit access** - Track who has access to production secrets

---

**Last Updated:** January 2025

