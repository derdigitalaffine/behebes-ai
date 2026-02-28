# Production Deployment Guide

## Overview

The OI App production setup uses Docker Compose with Nginx as a reverse proxy. This provides:

- ✅ Multi-service orchestration (Backend, Frontend, Admin)
- ✅ Nginx reverse proxy for routing
- ✅ Gzip compression
- ✅ Static file caching
- ✅ Health checks
- ✅ Automatic restart policies

## Architecture

```
┌─────────────────────────────────────────────┐
│              Client / Browser               │
└─────────────────┬───────────────────────────┘
                  │ HTTP/HTTPS (Port 80/443)
┌─────────────────▼───────────────────────────┐
│         Nginx Reverse Proxy (Alpine)        │
│  • Route / → Frontend                       │
│  • Route /admin → Admin Panel              │
│  • Route /api → Backend API                │
│  • Gzip compression                        │
│  • Static caching                          │
└────┬──────────────┬───────────────────┬────┘
     │              │                   │
     ▼              ▼                   ▼
┌────────┐  ┌──────────┐  ┌───────────────┐
│Frontend│  │  Admin   │  │   Backend     │
│  SPA   │  │  Panel   │  │   API Server  │
│(React)│  │ (React)  │  │  (Express)    │
└────────┘  └──────────┘  └───┬───────────┘
                              │
                              ▼
                         ┌─────────────┐
                         │ SQLite DB   │
                         └─────────────┘
```

## Quick Start

### 1. Build Docker Images

```bash
./dev-manager.sh --docker-build
# or
docker-compose -f docker-compose.prod.yml build
```

### 2. Start Services

```bash
./dev-manager.sh --docker-up
# or
docker-compose -f docker-compose.prod.yml up -d
```

The app will be available at:
- **Frontend**: http://localhost
- **Admin Panel**: http://localhost/admin
- **API**: http://localhost/api

### 3. View Logs

```bash
./dev-manager.sh --docker-logs
# or
docker-compose -f docker-compose.prod.yml logs -f
```

### 4. Stop Services

```bash
./dev-manager.sh --docker-down
# or
docker-compose -f docker-compose.prod.yml down
```

## Configuration

### Environment Variables

Create a `.env.prod` file (copy from `.env.example`):

```bash
# Critical for production
JWT_SECRET=your-super-secret-jwt-key-here

# Email (SMTP)
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD=your-password
SMTP_FROM_EMAIL=noreply@example.com
SMTP_FROM_NAME="OI App"

# OpenAI/AskCodi (if used)
OPENAI_CLIENT_ID=your-client-id
OPENAI_CLIENT_SECRET=your-client-secret

# AskCodi Integration
ASKCODI_API_KEY=your-askcodi-key
```

Then run:
```bash
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### Nginx Configuration

Edit `nginx/conf.d/default.conf`:

- **API Base URL**: The frontend communicates with backend via `/api` proxy
- **Static Files**: Served with long-term caching headers
- **Health Check**: Available at `/health`
- **Security Headers**: X-Frame-Options, X-Content-Type-Options, etc.

## SSL/HTTPS Setup

1. Generate or obtain SSL certificates:
```bash
# Self-signed (development only)
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/key.pem \
  -out nginx/ssl/cert.pem
```

2. Uncomment the HTTPS section in `nginx/conf.d/default.conf`

3. Rebuild and restart:
```bash
./dev-manager.sh --docker-build
./dev-manager.sh --docker-down
./dev-manager.sh --docker-up
```

## Monitoring

### Health Check Endpoint

```bash
curl http://localhost/health
# Returns: OK
```

### Backend Health

```bash
curl http://localhost/api/health
# Returns: {"status":"healthy"}
```

### View Container Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

### View Service Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f backend
docker-compose -f docker-compose.prod.yml logs -f nginx
```

## Performance Optimization

### Already Included

- ✅ Gzip compression for all text assets
- ✅ Long-term caching for static assets (1 year)
- ✅ No-cache for index.html
- ✅ Multi-worker Nginx
- ✅ Connection pooling to backend
- ✅ 60s timeouts for long-running requests

### Database Optimization

For production with many users:

1. **Use PostgreSQL** instead of SQLite
2. **Add indexes** on frequently queried fields
3. **Enable query logging** to identify slow queries
4. **Regular backups**: `docker-compose exec backend npm run db:backup`

## Troubleshooting

### Frontend can't reach API

1. Check Nginx logs: `docker-compose -f docker-compose.prod.yml logs nginx`
2. Verify backend health: `curl http://localhost/api/health`
3. Check CORS: Backend should allow `/api` requests from frontend origin

### High memory usage

```bash
# Check container memory
docker stats

# Reduce Node.js memory limit in docker-compose.prod.yml:
# environment:
#   NODE_OPTIONS: "--max_old_space_size=256"
```

### Slow builds

- Use `.dockerignore` to exclude `node_modules`, `.git`, etc.
- Consider using Docker BuildKit: `DOCKER_BUILDKIT=1 docker build`

## Deployment to Production Server

### 1. Copy files to server

```bash
rsync -avz --exclude '.git' --exclude 'node_modules' \
  ./ user@server:/app/oi_app/
```

### 2. Set production env variables

```bash
ssh user@server
cd /app/oi_app
nano .env.prod  # Configure production settings
```

### 3. Pull latest images and start

```bash
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 4. Setup reverse proxy (optional)

If running multiple apps on one server, use another Nginx instance:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;
    
    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Backup & Restore

### Database Backup

```bash
docker-compose -f docker-compose.prod.yml exec backend sqlite3 /app/data/oi_app.db .dump > backup.sql
```

### Database Restore

```bash
docker-compose -f docker-compose.prod.yml exec backend sqlite3 /app/data/oi_app.db < backup.sql
```

## Updates

To update services:

```bash
# Pull latest code
git pull

# Rebuild images
./dev-manager.sh --docker-build

# Restart services
./dev-manager.sh --docker-down
./dev-manager.sh --docker-up

# Verify
curl http://localhost/health
```

## Security Notes

- ⚠️ Change `JWT_SECRET` in production
- ⚠️ Use strong `SMTP_PASSWORD`
- ⚠️ Enable HTTPS in production
- ⚠️ Keep Docker images updated: `docker pull nginx:alpine`
- ⚠️ Use `.env.prod` (add to `.gitignore`)
- ⚠️ Implement firewall rules
- ⚠️ Setup log monitoring and alerting
