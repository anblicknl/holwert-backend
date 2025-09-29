#!/bin/bash

echo "🚀 Holwert Backend Setup Script"
echo "================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js first:"
    echo "  - Via Homebrew: brew install node"
    echo "  - Via NVM: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo ""
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo "✅ npm found: $(npm --version)"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
    echo "⚠️  Please edit .env with your database credentials!"
    echo ""
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies!"
    exit 1
fi

echo "✅ Dependencies installed successfully!"
echo ""

# Check if database is configured
echo "🗄️  Database setup..."
echo "Please make sure:"
echo "  1. MySQL is running"
echo "  2. Database 'holwert_db' exists"
echo "  3. .env file has correct database credentials"
echo ""

read -p "Press Enter when database is ready, or Ctrl+C to exit..."

# Initialize database
echo "🗄️  Initializing database..."
npm run init-db

if [ $? -ne 0 ]; then
    echo "❌ Database initialization failed!"
    echo "Please check your database connection and try again."
    exit 1
fi

echo "✅ Database initialized successfully!"
echo ""

# Create superadmin
echo "👤 Creating superadmin user..."
npm run create-superadmin

if [ $? -ne 0 ]; then
    echo "❌ Failed to create superadmin!"
    exit 1
fi

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "  1. Start the backend: npm start"
echo "  2. Open webinterface: holwert-web/index.html"
echo "  3. Log in with: admin@holwert.nl / admin123"
echo ""
echo "⚠️  Remember to change the default password!"
echo ""
