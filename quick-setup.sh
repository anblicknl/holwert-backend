#!/bin/bash

echo "🚀 Holwert Backend - Quick Setup"
echo "================================"
echo ""

# Add NVM to shell profile
echo "📝 Adding NVM to shell profile..."
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.zshrc
echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.zshrc

# Source NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "✅ NVM configured"
echo ""

# Install Node.js
echo "📦 Installing Node.js..."
nvm install node
nvm use node

echo "✅ Node.js installed: $(node --version)"
echo "✅ npm installed: $(npm --version)"
echo ""

# Install dependencies
echo "📦 Installing project dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies!"
    exit 1
fi

echo "✅ Dependencies installed successfully!"
echo ""

# Create .env file
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp env.example .env
    echo "⚠️  Please edit .env with your database credentials!"
    echo ""
fi

echo "🎉 Setup completed!"
echo ""
echo "📋 Next steps:"
echo "  1. Edit .env file with your database credentials"
echo "  2. Make sure MySQL is running"
echo "  3. Run: npm run init-db"
echo "  4. Run: npm run create-superadmin"
echo "  5. Run: npm start"
echo ""
echo "🌐 Then open: holwert-web/index.html"
echo "   Login: admin@holwert.nl / admin123"
echo ""
