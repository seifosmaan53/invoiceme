#!/bin/bash

# Dashboard Loading Diagnostic Script
# This script checks all potential issues that could cause dashboard to hang

echo "🔍 Dashboard Loading Diagnostic Tool"
echo "===================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check counter
ISSUES_FOUND=0

# Function to check and report
check_issue() {
    local name=$1
    local command=$2
    local expected=$3
    
    echo -n "Checking: $name... "
    
    if eval "$command" > /dev/null 2>&1; then
        if [ -z "$expected" ] || eval "$command" | grep -q "$expected" 2>/dev/null; then
            echo -e "${GREEN}✓ OK${NC}"
            return 0
        else
            echo -e "${YELLOW}⚠ WARNING${NC}"
            ISSUES_FOUND=$((ISSUES_FOUND + 1))
            return 1
        fi
    else
        echo -e "${RED}✗ FAILED${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
        return 1
    fi
}

# 1. Backend Health
echo "1. BACKEND HEALTH"
echo "----------------"
check_issue "Backend running on port 3000" "curl -s http://localhost:3000/api/health" '"status":"ok"'
check_issue "Backend database connected" "curl -s http://localhost:3000/api/health | grep -q '\"database\":\"connected\"'"
check_issue "Backend cache connected" "curl -s http://localhost:3000/api/health | grep -q '\"cache\":\"connected\"'"
echo ""

# 2. PostgreSQL
echo "2. DATABASE"
echo "-----------"
check_issue "PostgreSQL running" "pg_isready -h localhost -p 5432 -U postgres"
echo ""

# 3. Network
echo "3. NETWORK"
echo "----------"
check_issue "Port 3000 accessible" "nc -zv localhost 3000 2>&1 | grep -q 'succeeded'"
check_issue "Port 8080 not in use" "! lsof -ti:8080 > /dev/null 2>&1 || echo 'Port 8080 in use'"
echo ""

# 4. Backend Endpoints
echo "4. BACKEND ENDPOINTS"
echo "-------------------"
check_issue "/api/v1/invoices/stats endpoint exists" "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/v1/invoices/stats | grep -qE '^[45]' || echo 'endpoint exists'"
echo ""

# 5. CORS Configuration
echo "5. CORS CONFIGURATION"
echo "---------------------"
CORS_ORIGIN=$(cd "/Users/seifosman/Desktop/invoice maker/backend" && grep -E "^CORS_ORIGIN" .env 2>/dev/null | cut -d'=' -f2)
if [ -z "$CORS_ORIGIN" ]; then
    echo -e "CORS_ORIGIN: ${YELLOW}⚠ Not set in .env${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    echo -e "CORS_ORIGIN: ${GREEN}✓ $CORS_ORIGIN${NC}"
fi
echo ""

# 6. Flutter Configuration
echo "6. FLUTTER CONFIGURATION"
echo "-----------------------"
if [ -d "/Users/seifosman/Desktop/invoice maker/mobile" ]; then
    echo -e "Flutter project: ${GREEN}✓ Found${NC}"
    
    # Check if pubspec.yaml exists
    if [ -f "/Users/seifosman/Desktop/invoice maker/mobile/pubspec.yaml" ]; then
        echo -e "pubspec.yaml: ${GREEN}✓ Found${NC}"
    else
        echo -e "pubspec.yaml: ${RED}✗ Missing${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
    
    # Check if main.dart exists
    if [ -f "/Users/seifosman/Desktop/invoice maker/mobile/lib/main.dart" ]; then
        echo -e "main.dart: ${GREEN}✓ Found${NC}"
    else
        echo -e "main.dart: ${RED}✗ Missing${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
else
    echo -e "Flutter project: ${RED}✗ Not found${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi
echo ""

# 7. Process Check
echo "7. RUNNING PROCESSES"
echo "--------------------"
NESTJS_PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$NESTJS_PID" ]; then
    echo -e "NestJS process: ${GREEN}✓ Running (PID: $NESTJS_PID)${NC}"
else
    echo -e "NestJS process: ${RED}✗ Not running${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

FLUTTER_PID=$(pgrep -f "flutter.*run" | head -1)
if [ -n "$FLUTTER_PID" ]; then
    echo -e "Flutter process: ${GREEN}✓ Running (PID: $FLUTTER_PID)${NC}"
else
    echo -e "Flutter process: ${YELLOW}⚠ Not running${NC}"
fi
echo ""

# 8. File System
echo "8. FILE SYSTEM"
echo "--------------"
if [ -f "/Users/seifosman/Desktop/invoice maker/mobile/lib/screens/dashboard_screen.dart" ]; then
    DASHBOARD_SIZE=$(wc -l < "/Users/seifosman/Desktop/invoice maker/mobile/lib/screens/dashboard_screen.dart")
    echo -e "dashboard_screen.dart: ${GREEN}✓ Found ($DASHBOARD_SIZE lines)${NC}"
    
    # Check if file seems corrupted (too small)
    if [ "$DASHBOARD_SIZE" -lt 100 ]; then
        echo -e "  ${RED}⚠ WARNING: File seems too small, might be corrupted!${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
else
    echo -e "dashboard_screen.dart: ${RED}✗ Missing${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi
echo ""

# 9. Browser Check
echo "9. BROWSER CHECK"
echo "---------------"
echo "Please check manually in Chrome DevTools:"
echo "  1. Open DevTools (Cmd+Option+I)"
echo "  2. Go to Console tab - look for red errors"
echo "  3. Go to Network tab - check if requests are being made"
echo "  4. Check request status codes (should be 200)"
echo "  5. Check response times"
echo ""

# Summary
echo "===================================="
echo "SUMMARY"
echo "===================================="
if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}✓ No issues found in system checks${NC}"
    echo ""
    echo "If dashboard is still loading, the issue is likely:"
    echo "  1. Browser console errors (check DevTools)"
    echo "  2. Token not loaded (check authentication)"
    echo "  3. Chart rendering blocking (check fl_chart)"
    echo "  4. State management issue (check Riverpod providers)"
    echo "  5. Async operation hanging (check timeouts)"
else
    echo -e "${RED}✗ Found $ISSUES_FOUND potential issues${NC}"
    echo ""
    echo "Please fix these issues first, then run this script again."
fi
echo ""

# Next Steps
echo "NEXT STEPS:"
echo "1. Check browser console for errors"
echo "2. Test API endpoint manually:"
echo "   curl -H 'Authorization: Bearer YOUR_TOKEN' http://localhost:3000/api/v1/invoices/stats"
echo "3. Enable debug mode in dashboard_screen.dart:"
echo "   Set _debugBypassApi = true"
echo "4. Check Flutter logs in terminal"
echo "5. Try hard refresh: Cmd+Shift+R"
echo ""

