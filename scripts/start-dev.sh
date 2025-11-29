#!/bin/bash

# Invoice Maker - Development Startup Script
# This script ensures all services are running before starting the Flutter app

set -e

echo "🚀 Starting Invoice Maker Development Environment"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Check PostgreSQL
echo "📦 Step 1: Checking PostgreSQL..."
if nc -zv localhost 5432 2>/dev/null; then
    echo -e "${GREEN}✅ PostgreSQL is running${NC}"
else
    echo -e "${YELLOW}⚠️  PostgreSQL is not running. Starting it...${NC}"
    brew services start postgresql@14
    sleep 2
    if nc -zv localhost 5432 2>/dev/null; then
        echo -e "${GREEN}✅ PostgreSQL started successfully${NC}"
    else
        echo -e "${RED}❌ Failed to start PostgreSQL. Please check your installation.${NC}"
        exit 1
    fi
fi

# Step 2: Check Backend
echo ""
echo "🔧 Step 2: Checking Backend..."
BACKEND_DIR="$(dirname "$0")/../backend"
cd "$BACKEND_DIR"

# Check if backend is already running
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is already running${NC}"
else
    echo -e "${YELLOW}⚠️  Backend is not running. Starting it...${NC}"
    echo "   (This will run in the background)"
    npm run start:dev > /tmp/backend.log 2>&1 &
    BACKEND_PID=$!
    
    # Wait for backend to start (max 30 seconds)
    echo -n "   Waiting for backend to start"
    for i in {1..30}; do
        if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
            echo ""
            echo -e "${GREEN}✅ Backend started successfully${NC}"
            break
        fi
        echo -n "."
        sleep 1
    done
    
    if ! curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
        echo ""
        echo -e "${RED}❌ Backend failed to start. Check logs: tail -f /tmp/backend.log${NC}"
        exit 1
    fi
fi

# Step 3: Verify Backend Health
echo ""
echo "🏥 Step 3: Verifying Backend Health..."
HEALTH_RESPONSE=$(curl -s http://localhost:3000/api/health)
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✅ Backend is healthy${NC}"
    echo "   Database: $(echo "$HEALTH_RESPONSE" | grep -o '"database":"[^"]*"' | cut -d'"' -f4)"
    echo "   Cache: $(echo "$HEALTH_RESPONSE" | grep -o '"cache":"[^"]*"' | cut -d'"' -f4)"
else
    echo -e "${RED}❌ Backend health check failed${NC}"
    echo "   Response: $HEALTH_RESPONSE"
    exit 1
fi

# Step 4: Start Flutter Web App
echo ""
echo "📱 Step 4: Starting Flutter Web App..."
MOBILE_DIR="$(dirname "$0")/../mobile"
cd "$MOBILE_DIR"

echo "   Running: flutter run -d chrome --web-port=8080"
echo ""
echo -e "${GREEN}✅ All services are ready!${NC}"
echo ""
echo "💡 Tips:"
echo "   - Backend logs: tail -f /tmp/backend.log"
echo "   - Backend health: curl http://localhost:3000/api/health"
echo "   - Hard refresh browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)"
echo ""

flutter run -d chrome --web-port=8080

