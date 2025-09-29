# Holwert Backend - Installatie Guide

## 🚀 Lokale Installatie (macOS)

### Stap 1: Node.js Installeren

**Optie A: Via Homebrew (Aanbevolen)**
```bash
# Installeer Homebrew (als je het nog niet hebt)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Installeer Node.js
brew install node

# Controleer installatie
node --version
npm --version
```

**Optie B: Direct Download**
1. Ga naar https://nodejs.org/
2. Download de LTS versie voor macOS
3. Installeer het .pkg bestand
4. Herstart je terminal

**Optie C: Via NVM (Node Version Manager)**
```bash
# Installeer NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Herstart terminal of run:
source ~/.zshrc

# Installeer Node.js
nvm install node
nvm use node
```

### Stap 2: MySQL Database

**Optie A: Via Homebrew**
```bash
# Installeer MySQL
brew install mysql

# Start MySQL service
brew services start mysql

# Maak database aan
mysql -u root -p
CREATE DATABASE holwert_db;
```

**Optie B: Via XAMPP/MAMP**
1. Download XAMPP of MAMP van hun website
2. Installeer en start MySQL service
3. Open phpMyAdmin (http://localhost/phpmyadmin)
4. Maak database `holwert_db` aan

**Optie C: MySQL Workbench**
1. Download MySQL Workbench
2. Installeer en configureer
3. Maak database `holwert_db` aan

### Stap 3: Backend Setup

1. **Open Terminal en ga naar de backend directory:**
```bash
cd "/Users/dojaro/Projecten/A/ App & Vloed/Dorpenapp/Holwert/holwert-backend"
```

2. **Kopieer environment file:**
```bash
cp env.example .env
```

3. **Bewerk .env met je database credentials:**
```bash
# Open .env in je favoriete editor
nano .env
# of
code .env
# of
open -e .env
```

**Vul deze waarden in:**
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=holwert_db
JWT_SECRET=your_super_secret_jwt_key_here_make_it_long_and_random
PORT=3000
NODE_ENV=development
```

4. **Installeer dependencies:**
```bash
npm install
```

5. **Initialiseer database:**
```bash
npm run init-db
```

6. **Maak eerste superadmin aan:**
```bash
npm run create-superadmin
```

7. **Start de backend:**
```bash
npm start
```

### Stap 4: Webinterface Testen

1. **Open de webinterface:**
```bash
open holwert-web/index.html
```

2. **Log in met:**
- Email: `admin@holwert.nl`
- Password: `admin123`

## 🌐 Online Deployment (holwert.appenvloed.com)

### Stap 1: Server Voorbereiden

**Vereisten:**
- VPS of dedicated server
- Ubuntu 20.04+ of CentOS 8+
- Root of sudo toegang
- Domain naam: holwert.appenvloed.com

### Stap 2: Server Software Installeren

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MySQL
sudo apt install mysql-server -y

# Install Nginx
sudo apt install nginx -y

# Install PM2 (Process Manager)
sudo npm install -g pm2
```

### Stap 3: Database Setup

```bash
# Secure MySQL installation
sudo mysql_secure_installation

# Create database
sudo mysql -u root -p
CREATE DATABASE holwert_db;
CREATE USER 'holwert_user'@'localhost' IDENTIFIED BY 'strong_password_here';
GRANT ALL PRIVILEGES ON holwert_db.* TO 'holwert_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### Stap 4: Application Deployment

```bash
# Create application directory
sudo mkdir -p /var/www/holwert
sudo chown $USER:$USER /var/www/holwert

# Upload your code (via git, scp, or file manager)
cd /var/www/holwert
git clone your-repository-url .
# or upload files manually

# Install dependencies
npm install --production

# Setup environment
cp env.example .env
nano .env  # Configure for production
```

**Production .env:**
```env
DB_HOST=localhost
DB_USER=holwert_user
DB_PASSWORD=strong_password_here
DB_NAME=holwert_db
JWT_SECRET=very_long_and_secure_jwt_secret_for_production
PORT=3000
NODE_ENV=production
API_BASE_URL=https://holwert.appenvloed.com/api
```

### Stap 5: Initialize Application

```bash
# Initialize database
npm run init-db

# Create superadmin
npm run create-superadmin

# Start with PM2
pm2 start server.js --name "holwert-backend"
pm2 startup
pm2 save
```

### Stap 6: Nginx Configuration

```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/holwert.appenvloed.com
```

**Nginx config:**
```nginx
server {
    listen 80;
    server_name holwert.appenvloed.com;

    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Frontend files
    location / {
        root /var/www/holwert/holwert-web;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Static files
    location /uploads {
        alias /var/www/holwert/uploads;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/holwert.appenvloed.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Stap 7: SSL Certificate

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate
sudo certbot --nginx -d holwert.appenvloed.com
```

## 🔧 Troubleshooting

### Node.js Issues
```bash
# Check Node.js version
node --version

# Check npm version
npm --version

# Clear npm cache
npm cache clean --force
```

### Database Issues
```bash
# Check MySQL status
sudo systemctl status mysql

# Restart MySQL
sudo systemctl restart mysql

# Check database connection
mysql -u root -p -e "SHOW DATABASES;"
```

### Application Issues
```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs holwert-backend

# Restart application
pm2 restart holwert-backend
```

### Nginx Issues
```bash
# Check Nginx status
sudo systemctl status nginx

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## 📞 Support

Als je problemen ondervindt:
1. Check de logs: `pm2 logs holwert-backend`
2. Controleer database connectie
3. Verificeer environment variabelen
4. Check Nginx configuratie

## 🎯 Next Steps

Na succesvolle installatie:
1. Wijzig default wachtwoord
2. Maak organisaties aan
3. Configureer push notificaties
4. Setup backup procedures
5. Monitor performance
