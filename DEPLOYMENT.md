# Nirmaan WaterTech Solutions CRM - Production Deployment & Backup Guide

This document provides production deployment instructions, backup and recovery procedures, and external integration configuration for the **Nirmaan WaterTech Solutions CRM**.

---

## 1. System Architecture Overview

The system runs as an integrated three-tier architecture:
1. **Next.js Web Application** (Port 3000): Handles HTTP requests, server-side RBAC, SSR pages, API routes, and PDF/XLSX generation.
2. **PostgreSQL 16 Relational Database** (Port 5432): Manages relational schema, foreign keys, indexes, decimal monetary precision, and audit logs.
3. **Background Worker**: An independent Node.js process (`npm run worker`) running every minute: follow-up alerts (30 minutes before and when due), each person's morning summary at their chosen time, directors' updates, and overdue escalations. Never depends on the browser remaining open.

---

## 2. Environment Variables Configuration

Create a production `.env` file from `.env.example`:

```bash
cp .env.example .env
```

| Variable | Description | Production Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://nirmaan:STRONG_PASSWORD@postgres:5432/nirmaan_crm?schema=public` |
| `AUTH_SECRET` | 32-byte random hex string for JWT sessions | Run `openssl rand -hex 32` |
| `SESSION_MAX_AGE_SECONDS` | Cookie expiration in seconds | `604800` (7 days) |
| `TZ` | System Timezone | `Asia/Kolkata` |
| `NEXT_PUBLIC_TIMEZONE` | Client Timezone display | `Asia/Kolkata` |
| `NEXT_PUBLIC_CURRENCY` | Currency representation | `INR` |
| `SMTP_HOST` | Transactional email provider host | `smtp.sendgrid.net` or `smtp.postmarkapp.com` |
| `SMTP_PORT` | SMTP port | `587` or `465` |
| `SMTP_USER` | SMTP username | `apikey` |
| `SMTP_PASS` | SMTP password / API token | `your_smtp_key` |
| `SMTP_FROM` | Sender email address | `notifications@nirmaanwater.com` |
| `ENABLE_EMAIL_DISPATCH` | Enable live email delivery | `true` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Keys for phone (web push) notifications; generate once with `npx web-push generate-vapid-keys` and set on both the app and the worker. Phone notifications need the site on HTTPS | — |
| `VAPID_SUBJECT` | Contact address sent to push services | `mailto:notifications@nirmaanwater.com` |
| `OVERDUE_ESCALATION_HOURS` | Delay before escalating overdue tasks to directors | `24` |

---

## 3. Docker Production Deployment

### Step A: Build & Launch Containers
```bash
docker compose up -d --build
```

### Step B: Run Database Push & Seed (Initial Setup)
```bash
docker compose exec app npx prisma db push
docker compose exec app npm run seed
```

### Step C: Verify Services
```bash
docker compose ps
docker compose logs -f worker
```

---

## 4. Bare-Metal / Ubuntu Server Deployment (Systemd)

If deploying directly to a Linux VM:

### 1. Database Setup
```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib nodejs npm
sudo -u postgres psql -c "CREATE USER nirmaan WITH PASSWORD 'STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE nirmaan_crm OWNER nirmaan;"
```

### 2. Application Setup
```bash
git clone <repository_url> /var/www/nirmaan-crm
cd /var/www/nirmaan-crm
npm install --legacy-peer-deps
npx prisma db push
npm run seed
npm run build
```

### 3. Setup Systemd Service for Next.js App (`/etc/systemd/system/nirmaan-crm.service`)
```ini
[Unit]
Description=Nirmaan WaterTech CRM Web App
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/var/www/nirmaan-crm
ExecStart=/usr/bin/npm run start
Restart=on-failure
Environment=NODE_ENV=production
EnvironmentFile=/var/www/nirmaan-crm/.env

[Install]
WantedBy=multi-user.target
```

### 4. Setup Systemd Service for Background Reminder Worker (`/etc/systemd/system/nirmaan-worker.service`)
```ini
[Unit]
Description=Nirmaan WaterTech CRM Reminder Worker
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/var/www/nirmaan-crm
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=10
EnvironmentFile=/var/www/nirmaan-crm/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nirmaan-crm nirmaan-worker
```

---

## 5. Database Backup and Restore Procedures

### Automated Daily Backup Script (`backup.sh`)
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/nirmaan_crm"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

# Execute pg_dump
docker exec nirmaan-postgres pg_dump -U nirmaan -F c -b -v -f "/var/lib/postgresql/data/backup_${TIMESTAMP}.dump" nirmaan_crm
docker cp nirmaan-postgres:"/var/lib/postgresql/data/backup_${TIMESTAMP}.dump" "$BACKUP_DIR/"
docker exec nirmaan-postgres rm "/var/lib/postgresql/data/backup_${TIMESTAMP}.dump"

# Retain only last 30 days of backups
find "$BACKUP_DIR" -type f -name "*.dump" -mtime +30 -exec rm {} +

echo "Backup completed successfully: $BACKUP_DIR/backup_${TIMESTAMP}.dump"
```

### Full Restore Procedure
To restore from a `.dump` backup file:
```bash
# 1. Stop web application to prevent concurrent transactions
docker compose stop app worker

# 2. Copy dump file into container and restore
docker cp /path/to/backup.dump nirmaan-postgres:/tmp/restore.dump
docker exec -it nirmaan-postgres pg_restore -U nirmaan -d nirmaan_crm --clean --if-exists /tmp/restore.dump

# 3. Restart application
docker compose start app worker
```

---

## 6. External Services Requiring Credentials

1. **Transactional SMTP Email Provider**:
   - Provider: SendGrid, Postmark, AWS SES, or Mailtrap.
   - Credentials needed: Host, Port, Username, Password.
2. **Domain SSL / Reverse Proxy**:
   - Nginx or Cloudflare with SSL certificate for `https://crm.nirmaanwater.com`.
