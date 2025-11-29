#!/bin/bash
# validate-env.sh - Validate production environment variables
# Usage: ./scripts/validate-env.sh [path-to-env-file]
# If no path provided, validates current environment variables
# Environment variable STRICT controls whether errors cause exit 1:
#   STRICT=true (default): Exit 1 on any errors (suitable for production checks)
#   STRICT=false: Only warn on errors, exit 0 (suitable for informational checks in CI)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Load environment file if provided
if [ -n "$1" ]; then
  if [ -f "$1" ]; then
    echo "Loading environment from: $1"
    # Export variables from .env file
    set -a
    source "$1"
    set +a
  else
    echo -e "${RED}❌ File not found: $1${NC}"
    exit 1
  fi
fi

echo "Validating environment configuration..."
echo ""

# Validation functions
validate_jwt_secret() {
  if [ -z "$JWT_SECRET" ]; then
    echo -e "${RED}❌ JWT_SECRET is not set${NC}"
    ((ERRORS++))
    return
  fi
  
  if [ ${#JWT_SECRET} -lt 32 ]; then
    echo -e "${RED}❌ JWT_SECRET must be at least 32 characters (current: ${#JWT_SECRET})${NC}"
    ((ERRORS++))
  else
    echo -e "${GREEN}✅ JWT_SECRET length is valid (${#JWT_SECRET} characters)${NC}"
  fi
}

validate_jwt_refresh_secret() {
  if [ -z "$JWT_REFRESH_SECRET" ]; then
    echo -e "${RED}❌ JWT_REFRESH_SECRET is not set${NC}"
    ((ERRORS++))
    return
  fi
  
  if [ ${#JWT_REFRESH_SECRET} -lt 32 ]; then
    echo -e "${RED}❌ JWT_REFRESH_SECRET must be at least 32 characters (current: ${#JWT_REFRESH_SECRET})${NC}"
    ((ERRORS++))
  else
    echo -e "${GREEN}✅ JWT_REFRESH_SECRET length is valid (${#JWT_REFRESH_SECRET} characters)${NC}"
  fi
  
  # Check if JWT_SECRET and JWT_REFRESH_SECRET are different
  if [ "$JWT_SECRET" = "$JWT_REFRESH_SECRET" ]; then
    echo -e "${RED}❌ JWT_SECRET and JWT_REFRESH_SECRET must be different${NC}"
    ((ERRORS++))
  else
    echo -e "${GREEN}✅ JWT_SECRET and JWT_REFRESH_SECRET are different${NC}"
  fi
}

validate_cors() {
  if [ -z "$CORS_ORIGIN" ]; then
    echo -e "${YELLOW}⚠️  CORS_ORIGIN is not set${NC}"
    ((WARNINGS++))
    return
  fi
  
  if [ "$CORS_ORIGIN" = "*" ]; then
    if [ "$NODE_ENV" = "production" ]; then
      echo -e "${RED}❌ CORS_ORIGIN must not be '*' in production${NC}"
      ((ERRORS++))
    else
      echo -e "${YELLOW}⚠️  CORS_ORIGIN is '*' (acceptable for development)${NC}"
      ((WARNINGS++))
    fi
  else
    echo -e "${GREEN}✅ CORS_ORIGIN is configured: $CORS_ORIGIN${NC}"
  fi
}

validate_stripe() {
  if [ -z "$STRIPE_SECRET_KEY" ]; then
    echo -e "${YELLOW}⚠️  STRIPE_SECRET_KEY is not set${NC}"
    ((WARNINGS++))
    return
  fi
  
  if [[ "$STRIPE_SECRET_KEY" == sk_test_* ]]; then
    if [ "$NODE_ENV" = "production" ]; then
      echo -e "${RED}❌ Using Stripe test key in production (must use sk_live_...)${NC}"
      ((ERRORS++))
    else
      echo -e "${GREEN}✅ Using Stripe test key (appropriate for development)${NC}"
    fi
  elif [[ "$STRIPE_SECRET_KEY" == sk_live_* ]]; then
    if [ "$NODE_ENV" = "production" ]; then
      echo -e "${GREEN}✅ Using Stripe live key (appropriate for production)${NC}"
    else
      echo -e "${YELLOW}⚠️  Using Stripe live key in non-production environment${NC}"
      ((WARNINGS++))
    fi
  else
    echo -e "${YELLOW}⚠️  STRIPE_SECRET_KEY format is unexpected${NC}"
    ((WARNINGS++))
  fi
}

validate_node_env() {
  if [ -z "$NODE_ENV" ]; then
    echo -e "${YELLOW}⚠️  NODE_ENV is not set${NC}"
    ((WARNINGS++))
  elif [ "$NODE_ENV" = "production" ]; then
    echo -e "${GREEN}✅ NODE_ENV is set to 'production'${NC}"
  else
    echo -e "${YELLOW}⚠️  NODE_ENV is set to '$NODE_ENV' (expected 'production' for production)${NC}"
    ((WARNINGS++))
  fi
}

validate_database() {
  local missing=0
  
  if [ -z "$DB_HOST" ]; then
    echo -e "${RED}❌ DB_HOST is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ -z "$DB_PORT" ]; then
    echo -e "${RED}❌ DB_PORT is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ -z "$DB_USERNAME" ]; then
    echo -e "${RED}❌ DB_USERNAME is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ -z "$DB_PASSWORD" ]; then
    echo -e "${RED}❌ DB_PASSWORD is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ -z "$DB_DATABASE" ]; then
    echo -e "${RED}❌ DB_DATABASE is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ $missing -eq 0 ]; then
    echo -e "${GREEN}✅ Database configuration is complete${NC}"
    
    # Check SSL for production
    if [ "$NODE_ENV" = "production" ]; then
      if [ "$DB_SSL" != "true" ]; then
        echo -e "${YELLOW}⚠️  DB_SSL is not set to 'true' (recommended for production)${NC}"
        ((WARNINGS++))
      else
        echo -e "${GREEN}✅ DB_SSL is enabled${NC}"
      fi
    fi
  fi
}

validate_s3() {
  local missing=0
  
  if [ -z "$S3_REGION" ]; then
    echo -e "${RED}❌ S3_REGION is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ -z "$S3_ACCESS_KEY_ID" ]; then
    echo -e "${RED}❌ S3_ACCESS_KEY_ID is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ -z "$S3_SECRET_ACCESS_KEY" ]; then
    echo -e "${RED}❌ S3_SECRET_ACCESS_KEY is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ -z "$S3_BUCKET" ]; then
    echo -e "${RED}❌ S3_BUCKET is not set${NC}"
    ((ERRORS++))
    missing=1
  fi
  
  if [ $missing -eq 0 ]; then
    echo -e "${GREEN}✅ S3 configuration is complete${NC}"
  fi
}

validate_required() {
  local required_vars=(
    "API_PORT"
    "JWT_EXPIRES_IN"
    "JWT_REFRESH_EXPIRES_IN"
  )
  
  for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
      echo -e "${YELLOW}⚠️  $var is not set${NC}"
      ((WARNINGS++))
    fi
  done
}

# Run all validations
echo "=== JWT Secrets ==="
validate_jwt_secret
validate_jwt_refresh_secret
echo ""

echo "=== CORS Configuration ==="
validate_cors
echo ""

echo "=== Stripe Configuration ==="
validate_stripe
echo ""

echo "=== Environment ==="
validate_node_env
echo ""

echo "=== Database Configuration ==="
validate_database
echo ""

echo "=== S3 Configuration ==="
validate_s3
echo ""

echo "=== Required Variables ==="
validate_required
echo ""

# Summary
echo "=========================================="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✅ All validations passed!${NC}"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}⚠️  Validation completed with $WARNINGS warning(s)${NC}"
  exit 0
else
  echo -e "${RED}❌ Validation failed with $ERRORS error(s) and $WARNINGS warning(s)${NC}"
  # Only exit 1 when STRICT is true (default behavior)
  # When STRICT=false, treat errors as warnings for informational runs
  if [ "${STRICT:-true}" = "false" ]; then
    echo -e "${YELLOW}⚠️  STRICT=false: Errors treated as warnings, exiting 0${NC}"
    exit 0
  else
    exit 1
  fi
fi

