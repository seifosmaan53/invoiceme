# 🔌 API Endpoints Reference

## Base URL
```
http://localhost:3000/api
```

## Health Check
```bash
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-23T14:08:57.989Z",
  "uptime": 123,
  "database": "connected",
  "version": "1.0.0",
  "environment": "development"
}
```

---

## Authentication
```bash
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

---

## API Documentation (Swagger)
```bash
GET /api/docs
```

**Note:** Only available if `ENABLE_SWAGGER=true` in `.env`

---

## Common Endpoints

### Invoices
- `GET /api/v1/invoices` - List invoices
- `POST /api/v1/invoices` - Create invoice
- `GET /api/v1/invoices/:id` - Get invoice
- `PATCH /api/v1/invoices/:id` - Update invoice
- `DELETE /api/v1/invoices/:id` - Delete invoice

### Clients
- `GET /api/v1/clients` - List clients
- `POST /api/v1/clients` - Create client
- `GET /api/v1/clients/:id` - Get client
- `PATCH /api/v1/clients/:id` - Update client
- `DELETE /api/v1/clients/:id` - Delete client

### Payments
- `GET /api/v1/payments` - List payments
- `POST /api/v1/payments` - Create payment
- `GET /api/v1/payments/:id` - Get payment

### Sync (Mobile)
- `POST /api/v1/sync/push` - Push changes
- `POST /api/v1/sync/pull` - Pull changes

---

## Quick Test Commands

```bash
# Health check
curl http://localhost:3000/api/health

# With pretty JSON
curl http://localhost:3000/api/health | python3 -m json.tool

# Check if backend is running
curl -I http://localhost:3000/api/health
```

---

## Important Notes

1. **Global prefix is `/api`** - All routes start with `/api`
2. **Version prefix is `/v1`** - Most routes are under `/api/v1/`
3. **Health endpoint is `/api/health`** - No version prefix
4. **Swagger is at `/api/docs`** - If enabled

