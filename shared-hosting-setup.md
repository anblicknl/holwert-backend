# Shared Hosting Setup Guide

## Voor Hosting Providers met Node.js Support

### Stap 1: Upload Bestanden
1. **Upload** alle bestanden naar je hosting via FTP/cPanel
2. **Zorg** dat Node.js enabled is in je hosting control panel
3. **Upload** naar de juiste directory (meestal `/public_html` of `/htdocs`)

### Stap 2: Database Setup
1. **Maak** MySQL database aan via cPanel
2. **Noteer** database credentials:
   - Host: `localhost` (meestal)
   - Database naam: `your_database_name`
   - Username: `your_username`
   - Password: `your_password`

### Stap 3: Environment Configuratie
1. **Bewerk** `.env` file met je database credentials:
```env
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=your_database_name
JWT_SECRET=your_super_secret_jwt_key_here
PORT=3000
NODE_ENV=production
API_BASE_URL=https://holwert.appenvloed.com/api
```

### Stap 4: Dependencies Installeren
**Via cPanel Terminal (als beschikbaar):**
```bash
cd /public_html/holwert-backend
npm install --production
```

**Of via hosting provider's interface:**
- Zoek naar "Node.js" of "Package Manager" in cPanel
- Upload `package.json`
- Klik "Install Dependencies"

### Stap 5: Database Initialiseren
**Via cPanel Terminal:**
```bash
npm run init-db
npm run create-superadmin
```

**Of handmatig via phpMyAdmin:**
1. Open phpMyAdmin
2. Importeer database schema (uit `scripts/init-db.js`)
3. Maak superadmin user aan

### Stap 6: Applicatie Starten
**Via cPanel:**
1. Ga naar "Node.js" sectie
2. Selecteer je app directory
3. Set start command: `npm start`
4. Klik "Start App"

**Of via hosting provider's interface:**
- Zoek naar "Process Manager" of "PM2"
- Start applicatie

## Hosting Providers met Node.js Support

### Goede Opties:
- **Hostinger** - Node.js support
- **A2 Hosting** - Node.js support
- **SiteGround** - Node.js support
- **Bluehost** - Node.js support
- **Namecheap** - Node.js support

### Alternatieven:
- **Heroku** - Gratis tier
- **Railway** - Moderne alternative
- **Vercel** - Goed voor Node.js
- **Netlify** - Met serverless functions

## Troubleshooting

### Probleem: "npm not found"
**Oplossing:** Vraag hosting provider om Node.js/npm te activeren

### Probleem: "Database connection failed"
**Oplossing:** Controleer database credentials in .env

### Probleem: "Port 3000 not accessible"
**Oplossing:** Hosting provider moet poort 3000 openen, of gebruik hun reverse proxy

### Probleem: "Permission denied"
**Oplossing:** Controleer file permissions via cPanel File Manager

## Custom Domain Setup

### Via cPanel:
1. Ga naar "Subdomains"
2. Maak subdomain: `api.holwert.appenvloed.com`
3. Point naar Node.js app directory
4. Configureer SSL certificate

### Via DNS:
1. Maak A record: `api.holwert.appenvloed.com`
2. Point naar hosting provider's IP
3. Configureer reverse proxy

## Monitoring

### Via cPanel:
- **Error Logs** - Bekijk applicatie errors
- **Access Logs** - Bekijk traffic
- **Resource Usage** - Monitor CPU/memory

### Via Applicatie:
- **Health Check** - `https://your-domain.com/api/health`
- **PM2 Status** - Via terminal (als beschikbaar)
