#!/bin/bash

echo "🚀 Node.js Installatie Script voor macOS"
echo "========================================"
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "📦 Homebrew niet gevonden. Installeren..."
    echo ""
    echo "⚠️  Dit script zal Homebrew installeren en daarna Node.js"
    echo "   Je wordt gevraagd om je wachtwoord in te voeren."
    echo ""
    read -p "Druk op Enter om door te gaan, of Ctrl+C om te annuleren..."
    
    # Install Homebrew
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    eval "$(/opt/homebrew/bin/brew shellenv)"
    
    echo "✅ Homebrew geïnstalleerd!"
    echo ""
else
    echo "✅ Homebrew al geïnstalleerd"
    echo ""
fi

# Check if Node.js is already installed
if command -v node &> /dev/null; then
    echo "✅ Node.js al geïnstalleerd: $(node --version)"
    echo "✅ npm al geïnstalleerd: $(npm --version)"
    echo ""
    read -p "Wil je Node.js opnieuw installeren? (y/N): " reinstall
    if [[ ! $reinstall =~ ^[Yy]$ ]]; then
        echo "Node.js installatie overgeslagen."
        exit 0
    fi
fi

echo "📦 Node.js installeren via Homebrew..."
brew install node

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Node.js succesvol geïnstalleerd!"
    echo "   Node.js versie: $(node --version)"
    echo "   npm versie: $(npm --version)"
    echo ""
    echo "🎉 Installatie voltooid!"
    echo ""
    echo "📋 Volgende stappen:"
    echo "   1. cd holwert-backend"
    echo "   2. npm install"
    echo "   3. cp env.example .env"
    echo "   4. Bewerk .env met je database credentials"
    echo "   5. npm run init-db"
    echo "   6. npm run create-superadmin"
    echo "   7. npm start"
    echo ""
else
    echo "❌ Node.js installatie mislukt!"
    echo "   Probeer handmatig: brew install node"
    exit 1
fi
