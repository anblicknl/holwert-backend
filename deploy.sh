#!/bin/bash

# Holwert Backend - Automated Deployment Script
# Usage: ./deploy.sh [server-ip] [username] [ssh-key-path]

set -e

# Configuration
SERVER_IP=${1:-"your-server-ip"}
USERNAME=${2:-"root"}
SSH_KEY=${3:-"~/.ssh/id_rsa"}
APP_DIR="/var/www/holwert"
APP_NAME="holwert-backend"

echo "🚀 Holwert Backend - Automated Deployment"
echo "=========================================="
echo "Server: $USERNAME@$SERVER_IP"
echo "App Directory: $APP_DIR"
echo ""

# Check if required tools are installed
if ! command -v ssh &> /dev/null; then
    echo "❌ SSH client not found. Please install OpenSSH."
    exit 1
fi

if ! command -v rsync &> /dev/null; then
    echo "❌ rsync not found. Please install rsync."
    exit 1
fi

# Create deployment package
echo "📦 Creating deployment package..."
tar -czf holwert-backend.tar.gz \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=.github \
    --exclude=*.log \
    --exclude=deploy.sh \
    .

echo "✅ Package created: holwert-backend.tar.gz"
echo ""

# Upload and deploy
echo "🌐 Uploading to server..."
scp -i "$SSH_KEY" holwert-backend.tar.gz "$USERNAME@$SERVER_IP:/tmp/"

echo "⚙️  Setting up application on server..."
ssh -i "$SSH_KEY" "$USERNAME@$SERVER_IP" << 'EOF'
    set -e
    
    # Create app directory
    sudo mkdir -p /var/www/holwert
    cd /var/www/holwert
    
    # Backup current version
    if [ -d "current" ]; then
        echo "📦 Backing up current version..."
        sudo mv current "backup-$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Create new deployment directory
    sudo mkdir -p current
    cd current
    
    # Extract new version
    echo "📂 Extracting new version..."
    sudo tar -xzf /tmp/holwert-backend.tar.gz
    sudo rm /tmp/holwert-backend.tar.gz
    
    # Install Node.js if not present
    if ! command -v node &> /dev/null; then
        echo "📦 Installing Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get update
        sudo apt-get install -y nodejs
    fi
    
    echo "✅ Node.js version: $(node --version)"
    echo "✅ npm version: $(npm --version)"
    
    # Install dependencies
    echo "📦 Installing dependencies..."
    sudo npm install --production
    
    # Setup environment
    if [ ! -f .env ]; then
        echo "⚙️  Setting up environment..."
        sudo cp env.example .env
        echo "⚠️  Please configure .env file manually!"
    fi
    
    # Install PM2 if not present
    if ! command -v pm2 &> /dev/null; then
        echo "📦 Installing PM2..."
        sudo npm install -g pm2
    fi
    
    # Initialize database (if not exists)
    if [ ! -f .db_initialized ]; then
        echo "🗄️  Initializing database..."
        sudo npm run init-db
        sudo npm run create-superadmin
        sudo touch .db_initialized
    fi
    
    # Start/restart application
    echo "🚀 Starting application..."
    sudo pm2 stop holwert-backend || true
    sudo pm2 start server.js --name "holwert-backend"
    sudo pm2 startup
    sudo pm2 save
    
    echo "✅ Application started successfully!"
    echo "📊 PM2 Status:"
    sudo pm2 status
EOF

# Cleanup local package
rm holwert-backend.tar.gz

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Configure .env file on server: sudo nano $APP_DIR/current/.env"
echo "   2. Setup Nginx reverse proxy"
echo "   3. Configure SSL certificate"
echo "   4. Test application: curl http://$SERVER_IP:3000/api/health"
echo ""
echo "🔧 Useful commands:"
echo "   SSH to server: ssh -i $SSH_KEY $USERNAME@$SERVER_IP"
echo "   View logs: sudo pm2 logs holwert-backend"
echo "   Restart app: sudo pm2 restart holwert-backend"
echo "   Check status: sudo pm2 status"
