# ✅ Fixed JWT Authentication Strategy Error

## 🐛 Problem:

The backend was returning a **500 error** when trying to load invoices:
```
Unknown authentication strategy "jwt"
```

## 🔍 Root Cause:

The `JwtStrategy` was **not registered** in the `AuthModule` providers. Passport needs the strategy to be registered to use `AuthGuard('jwt')`.

## ✅ Fix Applied:

Added `JwtStrategy` to the `AuthModule` providers:

**Before:**
```typescript
providers: [AuthService, LocalStrategy],  // Missing JwtStrategy!
```

**After:**
```typescript
providers: [AuthService, LocalStrategy, JwtStrategy],  // ✅ Now includes JwtStrategy
```

Also added the import:
```typescript
import { JwtStrategy } from '../core/strategies/jwt.strategy';
```

## 🚀 Next Steps:

1. **Backend should restart automatically** - wait a few seconds
2. **Try loading invoices again** in the Flutter app
3. **Expected result**: ✅ Invoices load successfully (empty list if none exist)

## 🔍 What Changed:

The `JwtStrategy` was already created in `backend/src/core/strategies/jwt.strategy.ts`, but it wasn't registered as a provider in the `AuthModule`, so Passport couldn't find it when `JwtAuthGuard` tried to use it.

**Try loading invoices again now!**

