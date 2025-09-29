#!/bin/bash

# Server Setup Script - Run this ONCE on your server
# This script sets up the server environment for Holwert

echo "🚀 Holwert Server Setup"
echo "======================="
echo ""

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MySQL
echo "🗄️  Installing MySQL..."
sudo apt install mysql-server -y
sudo systemctl start mysql
sudo systemctl enable mysql

# Install Nginx
echo "🌐 Installing Nginx..."
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx

# Install PM2
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Create app directory
echo "📂 Creating application directory..."
sudo mkdir -p /var/www/holwert
sudo chown $USER:$USER /var/www/holwert

# Create uploads directory
sudo mkdir -p /var/www/holwert/uploads
sudo chown $USER:$USER /var/www/holwert/uploads

# Setup MySQL database
echo "🗄️  Setting up MySQL database..."
sudo mysql -e "CREATE DATABASE IF NOT EXISTS holwert_db;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'holwert_user'@'localhost' IDENTIFIED BY 'change_this_password';"
sudo mysql -e "GRANT ALL PRIVILEGES ON holwert_db.* TO 'holwert_user'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"

# Create Nginx configuration
echo "🌐 Creating Nginx configuration..."
sudo tee /etc/nginx/sites-available/holwert.appenvloed.com > /dev/null << 'EOF'
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
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/holwert.appenvloed.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# Create deployment script
echo "📝 Creating deployment script..."
cat > /var/www/holwert/deploy.sh << 'EOF'
#!/bin/bash
cd /var/www/holwert/current

# Install dependencies
npm install --production

# Initialize database if needed
if [ ! -f .db_initialized ]; then
    npm run init-db
    npm run create-superadmin
    touch .db_initialized
fi

# Restart application
pm2 restart holwert-backend
EOF

chmod +x /var/www/holwert/deploy.sh

echo ""
echo "✅ Server setup completed!"
echo ""
echo "📋 Next steps:"
echo "   1. Upload your application files to /var/www/holwert/current/"
echo "   2. Configure .env file with database credentials"
echo "   3. Run: cd /var/www/holwert/current && npm install"
echo "   4. Run: npm run init-db && npm run create-superadmin"
echo "   5. Run: pm2 start server.js --name holwert-backend"
echo "   6. Setup SSL certificate: sudo certbot --nginx -d holwert.appenvloed.com"
echo ""
echo "🔧 Database credentials:"
echo "   Database: holwert_db"
echo "   User: holwert_user"
echo "   Password: change_this_password (CHANGE THIS!)"
echo ""
echo "⚠️  Remember to:"
echo "   - Change database password"
echo "   - Configure .env file"
echo "   - Setup SSL certificate"
echo "   - Configure firewall (ports 80, 443, 22)"
