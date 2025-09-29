# Holwert Dorpsapp Backend

Backend API voor de Holwert Dorpsapp - een community platform voor het dorp Holwert.

## 🚀 Features

### Gebruikersrollen
- **Superadmin**: Volledige toegang tot alle functionaliteiten
- **Admin**: Beheer van eigen organisatie content
- **User**: Consumptie van content en basis interacties

### Hoofdfunctionaliteiten
- **Nieuwsbeheer**: Artikelen maken, bewerken en publiceren
- **Evenementen**: Agenda beheer met RSVP functionaliteit
- **Organisaties**: Volgen en beheren van lokale organisaties
- **Gevonden/Verloren**: Meldingen voor gevonden en verloren voorwerpen
- **Content Moderatatie**: Superadmin goedkeuring voor alle content
- **Push Notificaties**: Meldingen voor nieuwe content en evenementen

## 🛠 Technische Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL
- **Authenticatie**: JWT tokens
- **Security**: Helmet, CORS, Rate limiting
- **File Upload**: Multer

## 📁 Project Structuur

```
holwert-backend/
├── config/
│   └── database.js          # Database configuratie en initialisatie
├── middleware/
│   └── auth.js              # Authenticatie middleware
├── routes/
│   ├── auth.js              # Authenticatie routes
│   ├── admin.js             # Superadmin routes
│   ├── users.js             # Gebruiker routes
│   ├── organizations.js     # Organisatie routes
│   ├── news.js              # Nieuws routes
│   ├── events.js            # Evenement routes
│   └── foundLost.js         # Gevonden/Verloren routes
├── server.js                # Hoofdserver bestand
├── package.json             # Dependencies
└── env.example              # Environment variabelen voorbeeld
```

## 🚀 Installatie

1. **Clone de repository**
   ```bash
   git clone <repository-url>
   cd holwert-backend
   ```

2. **Installeer dependencies**
   ```bash
   npm install
   ```

3. **Configureer environment variabelen**
   ```bash
   cp env.example .env
   # Bewerk .env met je database credentials
   ```

4. **Setup database**
   - Maak een MySQL database aan
   - Update de database credentials in `.env`
   - De database tabellen worden automatisch aangemaakt bij eerste start

5. **Start de server**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## 🔧 Environment Variabelen

```env
# Database
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=holwert_db

# JWT
JWT_SECRET=your_super_secret_jwt_key_here

# Server
PORT=3000
NODE_ENV=development

# API
API_BASE_URL=https://holwert.appenvloed.com/api

# File Upload
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=5242880

# Push Notifications
FIREBASE_SERVER_KEY=your_firebase_server_key
```

## 📚 API Endpoints

### Authenticatie
- `POST /api/auth/register` - Registreer nieuwe gebruiker
- `POST /api/auth/login` - Inloggen
- `GET /api/auth/me` - Huidige gebruiker profiel
- `PUT /api/auth/me` - Update profiel
- `PUT /api/auth/change-password` - Wijzig wachtwoord

### Superadmin
- `GET /api/admin/users` - Alle gebruikers
- `POST /api/admin/users` - Nieuwe gebruiker aanmaken
- `PUT /api/admin/users/:id` - Gebruiker bijwerken
- `DELETE /api/admin/users/:id` - Gebruiker verwijderen
- `GET /api/admin/organizations` - Alle organisaties
- `POST /api/admin/organizations` - Nieuwe organisatie
- `GET /api/admin/moderation/pending` - Pending content
- `POST /api/admin/moderation/approve/:type/:id` - Content goedkeuren
- `GET /api/admin/dashboard/stats` - Dashboard statistieken

### Nieuws
- `GET /api/news` - Alle gepubliceerde artikelen
- `GET /api/news/:id` - Specifiek artikel
- `POST /api/news` - Nieuw artikel (Admin)
- `PUT /api/news/:id` - Artikel bijwerken (Admin)
- `POST /api/news/:id/save` - Artikel opslaan/verwijderen

### Evenementen
- `GET /api/events` - Alle evenementen
- `GET /api/events/:id` - Specifiek evenement
- `POST /api/events` - Nieuw evenement (Admin)
- `POST /api/events/:id/rsvp` - RSVP voor evenement

### Organisaties
- `GET /api/organizations` - Alle organisaties
- `GET /api/organizations/:id` - Specifieke organisatie
- `POST /api/organizations/:id/follow` - Organisatie volgen/ontvolgen

### Gevonden/Verloren
- `GET /api/found-lost` - Alle items
- `POST /api/found-lost` - Nieuw item melden
- `GET /api/found-lost/user/my-items` - Eigen items

## 🔐 Authenticatie

De API gebruikt JWT tokens voor authenticatie. Voeg de token toe aan de Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## 🛡 Security Features

- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing
- **Rate Limiting**: 100 requests per 15 minuten per IP
- **Password Hashing**: bcrypt met 12 salt rounds
- **Input Validation**: Server-side validatie van alle inputs

## 📱 Frontend Integratie

Deze backend is ontworpen om te werken met:
- React Native (iOS/Android app)
- Web frontend (admin panel)
- Push notificaties via Firebase

## 🚀 Deployment

Voor deployment op `holwert.appenvloed.com`:

1. **Server Setup**
   - Node.js 18+ geïnstalleerd
   - MySQL database beschikbaar
   - PM2 voor process management

2. **Environment**
   ```bash
   NODE_ENV=production
   PORT=3000
   ```

3. **Database**
   - Maak productie database aan
   - Update connection string
   - Run database initialisatie

4. **Start**
   ```bash
   npm install --production
   npm start
   ```

## 📝 Database Schema

### Hoofdtabellen
- `users` - Gebruikers met rollen
- `organizations` - Lokale organisaties
- `news_articles` - Nieuwsartikelen
- `events` - Evenementen
- `found_lost_items` - Gevonden/verloren items
- `user_follows_organization` - Volg relaties
- `user_saved_articles` - Opgeslagen artikelen
- `event_attendees` - Evenement aanmeldingen

## 🤝 Contributing

1. Fork het project
2. Maak een feature branch
3. Commit je wijzigingen
4. Push naar de branch
5. Open een Pull Request

## 📄 License

Dit project is eigendom van Anblick en is bedoeld voor de Holwert Dorpsapp.

## 📞 Support

Voor vragen of ondersteuning, neem contact op met het ontwikkelteam.
