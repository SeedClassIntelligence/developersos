# DeveloperOS Backend — Deployment Guide

## STEP 1 — Upload to VPS

```bash
# On your local machine
scp -r developeros-backend/ user@YOUR_VPS_IP:~/developeros-backend/

# On VPS
cd ~/developeros-backend
```

## STEP 2 — Install Node.js (if not installed)

```bash
sudo apt update
sudo apt install nodejs npm -y
node -v   # should be 18+
npm -v
```

## STEP 3 — Install dependencies

```bash
cd ~/developeros-backend
npm install
```

## STEP 4 — Set environment variables

```bash
cp .env.example .env
nano .env
# Set FRONTEND_URL to your actual domain or VPS IP
```

## STEP 5 — Start the server

```bash
# Development (auto-restart on changes)
npm run dev

# Production
node server.js
```

## STEP 6 — Verify it works

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/projects
curl http://localhost:3000/api/alerts
```

## STEP 7 — Keep it running with PM2

```bash
npm install -g pm2
pm2 start server.js --name developeros-api
pm2 save
pm2 startup   # auto-start on reboot
```

## STEP 8 — Wire frontend to backend

1. Copy `api.js` into `developeros/assets/js/api.js`
2. Add to `index.html` BEFORE `app.js`:
   ```html
   <script src="assets/js/api.js"></script>
   ```
3. In `app.js`, replace `enterApp()` with:
   ```javascript
   async function enterApp() {
     state.isAuthenticated = true;
     document.getElementById('landing-page').style.display = 'none';
     document.getElementById('app-shell').style.display = 'flex';
     document.getElementById('app-shell').style.flexDirection = 'column';
     renderTopbar();
     renderSidebar();
     // Try API first, fall back to mock data
     await loadAllDataFromAPI();
     navigate('portfolio');
   }
   ```

## STEP 9 — Nginx proxy (serve both frontend + backend)

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    # Serve frontend
    root /var/www/developeros;
    index index.html;

    # Proxy API calls to Node.js
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /health {
        proxy_pass http://localhost:3000;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## API ENDPOINTS REFERENCE

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Server health check |
| GET | /api/projects | All projects |
| GET | /api/projects/:id | Single project |
| POST | /api/projects | Create project |
| PUT | /api/projects/:id | Update project |
| GET | /api/tasks?projectId=p1 | Tasks for project |
| PUT | /api/tasks/:id | Update task |
| PATCH | /api/tasks/:id/status | Update task status |
| GET | /api/contracts?projectId=p1 | Contracts for project |
| POST | /api/contracts/:id/execute | Execute a contract |
| GET | /api/permits?projectId=p1 | Permits for project |
| PATCH | /api/permits/:id/status | Update permit status |
| GET | /api/capital/:projectId | Capital stack |
| GET | /api/messages/channels | All channels |
| GET | /api/messages/channels/:id/messages | Channel messages |
| POST | /api/messages/channels/:id/messages | Send message |
| GET | /api/alerts?projectId=p1 | AI-generated alerts |
| GET | /api/admin/stats | Platform stats |

---

## UPGRADE ROADMAP

### Phase 2 — Database
Replace in-memory arrays with PostgreSQL:
```bash
npm install pg
```
Each route file has upgrade comments showing exactly where to add DB queries.

### Phase 2 — Authentication
```bash
npm install jsonwebtoken bcryptjs
```
Add auth middleware to protect routes.

### Phase 3 — Real AI (Claude API)
```bash
npm install @anthropic-ai/sdk
```
Replace `generateAlerts()` in `routes/alerts.js` with a Claude API call
that analyzes the full project state and returns intelligent recommendations.

### Phase 4 — Real-time
```bash
npm install socket.io
```
Add WebSocket events for live task updates and messages.
