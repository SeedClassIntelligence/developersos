# DeveloperOS — Security Implementation

## What Is Secured

### 1. Authentication & Tenant Membership
Every API route except `/health`, `/api/auth/login`, and `/api/invitations/accept` requires a valid JWT token and an authorized organization context.
- Tokens expire in 8 hours (configurable via `JWT_EXPIRES_IN`)
- Invalid or expired tokens return 401
- Public self-registration is disabled (`/api/auth/register` returns 403); organization onboarding requires an authorized invitation token (`/api/invitations/accept`)
- Tenant context is resolved dynamically from `X-Organization-Id` header or authenticated token and validated against PostgreSQL `memberships` table
- Permission checks (`requirePermission(...)`) and resource-level isolation (`authorizeResource(...)`) enforce multi-tenant separation across all domain endpoints

### 2. Password Security (bcrypt)
- Passwords hashed with bcrypt (cost factor 10 to 12 depending on legacy fixture origin; new hashes created with factor 12)
- Plain text passwords NEVER stored or logged
- Timing-safe comparison prevents user enumeration attacks

### 3. Security Headers (helmet)
Every response includes:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (prevents clickjacking)
- `Strict-Transport-Security` (forces HTTPS)
- `Content-Security-Policy` (blocks XSS)
- `X-XSS-Protection`

### 4. CORS Whitelist
Only allowed origins can call the API.
Set `FRONTEND_URL` in `.env` — all other origins are blocked.

### 5. Rate Limiting
- General API: 100 requests per 15 minutes per IP (10,000 in test mode)
- Auth endpoints: 10 attempts per 15 minutes per IP (1,000 in test mode)
- Prevents brute force attacks and API abuse

### 6. Input Sanitization & Payload Controls
- Script tags and javascript: URIs stripped via input sanitization middleware
- Request body size limited to 10KB (prevents large payload attacks)
- Database persistence backed by parameterized SQL queries and PostgreSQL CHECK/FK constraints

### 7. Production Binding
In production, the server binds to `127.0.0.1` only.
The API is NEVER directly exposed to the internet — nginx proxies it.

### 8. No Stack Traces in Production
Error responses in production return generic error messages — never expose stack traces or DB internals.

### 9. Logging
All requests logged to `logs/access.log` in production for audit trail.

---

## Deployment Security Checklist

Before going live, complete every item:

- [ ] Generate JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- [ ] Set JWT_SECRET in `.env` — never use a simple word
- [ ] Set FRONTEND_URL to your exact domain (no trailing slash)
- [ ] Set NODE_ENV=production
- [ ] Verify `.env` is in `.gitignore` — NEVER push to GitHub
- [ ] Configure nginx to proxy port 3000 (never expose Node directly)
- [ ] Enable HTTPS with Let's Encrypt: `sudo certbot --nginx`
- [ ] Set up PM2: `pm2 start server.js --name developeros-api`
- [ ] Enable PM2 auto-restart: `pm2 startup && pm2 save`
- [ ] Set up firewall — only allow ports 80, 443, 22:
  ```
  sudo ufw allow 22
  sudo ufw allow 80
  sudo ufw allow 443
  sudo ufw enable
  sudo ufw deny 3000   # Block direct Node access
  ```
- [ ] Rotate initial database seed credentials before deploying to production
- [ ] Create logs directory: `mkdir logs`

---

## Nginx Config (HTTPS + Proxy)

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Strong SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    # Security headers
    add_header X-Frame-Options "DENY";
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "strict-origin-when-cross-origin";

    # Serve frontend
    root /var/www/developeros;
    index index.html;

    # Proxy API to Node.js (localhost only)
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Architecture Status
- **Phase EF-1 (PostgreSQL Relational Persistence)**: COMPLETE. Active PostgreSQL engine with 15 relational tables, exact monetary precision `numeric(15,2)`, and foreign key constraints.
- **Phase EF-2 (Multi-Tenant Authorization & RBAC)**: COMPLETE. PostgreSQL-backed roles, permissions, dynamic membership resolution, tenant-scoped resource isolation, and invitation workflows.
- **Phase EF-3 (Audit Ledger & Compliance Trail)**: COMPLETE. Transactionally coupled change capture, append-only tenant chains, current-authority reads, secret redaction, rollback and concurrency acceptance.

### Phase 3: Full audit trail
Every data change logged with: who, what, when, from what IP.
Required for real estate development compliance.
