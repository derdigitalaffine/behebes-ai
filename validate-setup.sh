#!/bin/bash

# OI App - Setup Validation Script
# Überprüft alle Voraussetzungen und Dateistrukturen

set -e

echo "🔍 OI App Setup Validation"
echo "================================"

# Farben für Ausgabe
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter
PASSED=0
FAILED=0

# Hilfsfunktion
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1"
        ((FAILED++))
    fi
}

# 1. Node.js & npm
echo ""
echo "📦 Checking Node.js and npm..."
node --version > /dev/null && check "Node.js installed" || echo -e "${RED}✗${NC} Node.js not found"
npm --version > /dev/null && check "npm installed" || echo -e "${RED}✗${NC} npm not found"

# 2. Projekt-Struktur
echo ""
echo "📁 Checking Project Structure..."
[ -d "backend" ] && check "backend/ directory exists" || echo -e "${RED}✗${NC} backend/ not found"
[ -d "frontend" ] && check "frontend/ directory exists" || echo -e "${RED}✗${NC} frontend/ not found"
[ -d "admin" ] && check "admin/ directory exists" || echo -e "${RED}✗${NC} admin/ not found"

# 3. Node-Module
echo ""
echo "📦 Checking Dependencies..."
[ -d "backend/node_modules" ] && check "backend/node_modules installed" || echo -e "${YELLOW}⚠${NC} backend/node_modules not found (run npm install)"
[ -d "frontend/node_modules" ] && check "frontend/node_modules installed" || echo -e "${YELLOW}⚠${NC} frontend/node_modules not found (run npm install)"
[ -d "admin/node_modules" ] && check "admin/node_modules installed" || echo -e "${YELLOW}⚠${NC} admin/node_modules not found (run npm install)"

# 4. Configuration Files
echo ""
echo "⚙️  Checking Configuration Files..."
[ -f "package.json" ] && check "Root package.json exists" || echo -e "${RED}✗${NC} package.json not found"
[ -f "backend/package.json" ] && check "backend/package.json exists" || echo -e "${RED}✗${NC} backend/package.json not found"
[ -f "frontend/package.json" ] && check "frontend/package.json exists" || echo -e "${RED}✗${NC} frontend/package.json not found"
[ -f "admin/package.json" ] && check "admin/package.json exists" || echo -e "${RED}✗${NC} admin/package.json not found"

# 5. TypeScript Config
echo ""
echo "📝 Checking TypeScript..."
[ -f "backend/tsconfig.json" ] && check "backend/tsconfig.json exists" || echo -e "${RED}✗${NC} backend/tsconfig.json not found"
[ -f "frontend/tsconfig.json" ] && check "frontend/tsconfig.json exists" || echo -e "${RED}✗${NC} frontend/tsconfig.json not found"
[ -f "admin/tsconfig.json" ] && check "admin/tsconfig.json exists" || echo -e "${RED}✗${NC} admin/tsconfig.json not found"

# 6. Tailwind CSS
echo ""
echo "🎨 Checking Tailwind CSS..."
[ -f "frontend/tailwind.config.js" ] && check "frontend/tailwind.config.js exists" || echo -e "${YELLOW}⚠${NC} frontend/tailwind.config.js not found"
[ -f "admin/tailwind.config.js" ] && check "admin/tailwind.config.js exists" || echo -e "${YELLOW}⚠${NC} admin/tailwind.config.js not found"
[ -f "frontend/postcss.config.js" ] && check "frontend/postcss.config.js exists" || echo -e "${YELLOW}⚠${NC} frontend/postcss.config.js not found"
[ -f "admin/postcss.config.js" ] && check "admin/postcss.config.js exists" || echo -e "${YELLOW}⚠${NC} admin/postcss.config.js not found"

# 7. Environment Files
echo ""
echo "🔐 Checking Environment Files..."
[ -f ".env.example" ] && check ".env.example exists" || echo -e "${YELLOW}⚠${NC} .env.example not found"
if [ -f ".env.local" ]; then
    echo -e "${GREEN}✓${NC} .env.local configured (good for local dev)"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} .env.local not found (create with: cp .env.example .env.local)"
fi

# 8. Docker
echo ""
echo "🐳 Checking Docker (optional)..."
if command -v docker &> /dev/null; then
    check "Docker installed"
    [ -f "docker-compose.yml" ] && check "docker-compose.yml exists" || echo -e "${RED}✗${NC} docker-compose.yml not found"
    [ -f "backend/Dockerfile" ] && check "backend/Dockerfile exists" || echo -e "${YELLOW}⚠${NC} backend/Dockerfile not found"
    [ -f "frontend/Dockerfile" ] && check "frontend/Dockerfile exists" || echo -e "${YELLOW}⚠${NC} frontend/Dockerfile not found"
    [ -f "admin/Dockerfile" ] && check "admin/Dockerfile exists" || echo -e "${YELLOW}⚠${NC} admin/Dockerfile not found"
else
    echo -e "${YELLOW}⚠${NC} Docker not installed (optional for local dev)"
fi

# 9. Git
echo ""
echo "📝 Checking Git..."
if [ -d ".git" ]; then
    echo -e "${GREEN}✓${NC} Git repository initialized"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} Git repository not initialized (run: git init)"
fi

# 10. Documentation
echo ""
echo "📚 Checking Documentation..."
[ -f "README.md" ] && check "README.md exists" || echo -e "${YELLOW}⚠${NC} README.md not found"
[ -f "QUICKSTART.md" ] && check "QUICKSTART.md exists" || echo -e "${YELLOW}⚠${NC} QUICKSTART.md not found"
[ -f "docs/versioning-and-updates.md" ] && check "docs/versioning-and-updates.md exists" || echo -e "${YELLOW}⚠${NC} docs/versioning-and-updates.md not found"
[ -f "docs/git-governance.md" ] && check "docs/git-governance.md exists" || echo -e "${YELLOW}⚠${NC} docs/git-governance.md not found"

# Summary
echo ""
echo "================================"
echo -e "✅ Passed: ${GREEN}${PASSED}${NC}"
echo -e "❌ Failed: ${RED}${FAILED}${NC}"
echo "================================"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✨ Setup looks good! Ready to develop.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. If needed: cp .env.example .env.local"
    echo "  2. Start development: npm run dev"
    echo "  3. Open in browser:"
    echo "     - Frontend: http://localhost:5173"
    echo "     - Admin: http://localhost:5174 (admin/admin123)"
    exit 0
else
    echo -e "${RED}⚠️  Some checks failed. Please fix them before continuing.${NC}"
    exit 1
fi
