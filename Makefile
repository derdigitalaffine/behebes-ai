# OI App - Makefile für komfortable Entwicklung

.PHONY: help install dev dev-all dev-backend dev-frontend dev-admin build test clean validate docker-build docker-up docker-down

# Farben für Output
BLUE := \033[0;34m
GREEN := \033[0;32m
NC := \033[0m # No Color

help:
	@echo "$(BLUE)OI App - Development Commands$(NC)"
	@echo ""
	@echo "Installation:"
	@echo "  make install              Install all dependencies"
	@echo "  make validate             Validate setup"
	@echo ""
	@echo "Development:"
	@echo "  make dev                  Start all services (recommended)"
	@echo "  make dev-backend          Start backend only"
	@echo "  make dev-frontend         Start frontend only"
	@echo "  make dev-admin            Start admin only"
	@echo ""
	@echo "Building:"
	@echo "  make build                Build all projects"
	@echo "  make build-backend        Build backend only"
	@echo "  make build-frontend       Build frontend only"
	@echo "  make build-admin          Build admin only"
	@echo ""
	@echo "Testing & Quality:"
	@echo "  make test                 Run all tests"
	@echo "  make lint                 Lint all projects"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build         Build Docker images"
	@echo "  make docker-up            Start all containers"
	@echo "  make docker-down          Stop all containers"
	@echo "  make docker-logs          View container logs"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean                Clean all build artifacts"
	@echo "  make db-reset             Reset database (⚠️ destructive)"
	@echo "  make env-setup            Setup .env.local file"

# Installation
install:
	@echo "$(GREEN)Installing dependencies...$(NC)"
	npm install
	@echo "$(GREEN)✓ Installation complete$(NC)"

validate:
	@bash validate-setup.sh

env-setup:
	@if [ ! -f .env.local ]; then \
		cp .env.example .env.local; \
		echo "$(GREEN)✓ .env.local created$(NC)"; \
		echo "⚠️  Please edit .env.local and set OpenAI credentials"; \
	else \
		echo ".env.local already exists"; \
	fi

# Development
dev:
	@echo "$(GREEN)Starting all services...$(NC)"
	npm run dev

dev-backend:
	@echo "$(GREEN)Starting backend (port 3001)...$(NC)"
	npm run dev:backend

dev-frontend:
	@echo "$(GREEN)Starting frontend (port 5173)...$(NC)"
	npm run dev:frontend

dev-admin:
	@echo "$(GREEN)Starting admin (port 5174)...$(NC)"
	npm run dev:admin

# Building
build:
	@echo "$(GREEN)Building all projects...$(NC)"
	npm run build

build-backend:
	@echo "$(GREEN)Building backend...$(NC)"
	npm run build --workspace=backend

build-frontend:
	@echo "$(GREEN)Building frontend...$(NC)"
	npm run build --workspace=frontend

build-admin:
	@echo "$(GREEN)Building admin...$(NC)"
	npm run build --workspace=admin

# Testing
test:
	@echo "$(GREEN)Running tests...$(NC)"
	npm run test

lint:
	@echo "$(GREEN)Linting projects...$(NC)"
	npm run lint

# Docker
docker-build:
	@echo "$(GREEN)Building Docker images...$(NC)"
	docker-compose build

docker-up:
	@echo "$(GREEN)Starting containers...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)✓ Services running:$(NC)"
	@echo "  - Frontend: http://localhost:5173"
	@echo "  - Admin: http://localhost:5174"
	@echo "  - Backend: ${VITE_API_URL}/api"

docker-down:
	@echo "$(GREEN)Stopping containers...$(NC)"
	docker-compose down

docker-logs:
	docker-compose logs -f

# Database
db-reset:
	@read -p "⚠️  This will delete all data. Continue? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		rm -f data/oi_app.db; \
		echo "$(GREEN)✓ Database reset$(NC)"; \
	fi

# Cleanup
clean:
	@echo "$(GREEN)Cleaning build artifacts...$(NC)"
	rm -rf backend/dist admin/dist frontend/dist
	rm -rf backend/node_modules admin/node_modules frontend/node_modules node_modules
	rm -rf backend/.vite admin/.vite frontend/.vite
	@echo "$(GREEN)✓ Clean complete$(NC)"

# Info
info:
	@echo "$(BLUE)OI App Project Info$(NC)"
	@echo ""
	@echo "Services:"
	@echo "  - Frontend: $(BLUE)http://localhost:5173$(NC) (Mobile-First PWA)"
	@echo "  - Admin: $(BLUE)http://localhost:5174$(NC) (Desktop Dashboard, admin/admin123)"
	@echo "  - Backend: $(BLUE)${VITE_API_URL}/api$(NC) (REST API)"
	@echo ""
	@echo "Documentation:"
	@echo "  - README.md - Project overview"
	@echo "  - QUICKSTART.md - Runtime quick start"
	@echo "  - docs/versioning-and-updates.md - Update process"
	@echo "  - docs/git-governance.md - Git and release governance"
	@echo ""
	@echo "Database:"
	@echo "  - Location: data/oi_app.db (SQLite)"
	@echo "  - Auto-initialized on first run"
	@echo ""

# Default
.DEFAULT_GOAL := help
