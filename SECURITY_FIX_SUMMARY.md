# Security Fix - Hardcoded Credentials Verwijderd

## ✅ Wat is gedaan:

1. **Alle hardcoded credentials verwijderd uit de code:**
   - Admin email/password uit `server.js`
   - Database passwords uit alle PHP bestanden
   - API keys uit `db-proxy.php`
   - Hardcoded waarden uit `login.html`

2. **Environment variables toegevoegd in Vercel:**
   - ✅ `ADMIN_EMAIL` = admin@holwert.nl (alle environments)
   - ✅ `ADMIN_PASSWORD` = VrVmP5H1JrrsbUhXzkUy (alle environments)
   - ✅ `PHP_PROXY_API_KEY` = (al aanwezig)
   - ✅ `DB_PASSWORD` = (al aanwezig)
   - ✅ `JWT_SECRET` = (al aanwezig)

3. **Code aangepast om environment variables te gebruiken:**
   - Alle bestanden lezen nu credentials uit environment variables
   - Fallback naar lege string (niet meer hardcoded defaults)

## ⚠️ BELANGRIJK - Wat je nog moet doen:

### 1. Admin Wachtwoord Wijzigen
Het nieuwe admin wachtwoord is: **VrVmP5H1JrrsbUhXzkUy**

**Log in met:**
- Email: admin@holwert.nl
- Password: VrVmP5H1JrrsbUhXzkUy

**En wijzig het wachtwoord direct na inloggen!**

### 2. PHP Server Environment Variables
Voor je PHP bestanden op de FTP server moet je environment variables instellen via je hosting control panel, of een `.env` bestand aanmaken (niet committen!).

**Voor `db-proxy.php` en andere PHP bestanden:**
- `DB_PASSWORD` = je database wachtwoord
- `PHP_PROXY_API_KEY` = dezelfde waarde als in Vercel (haal op via `vercel env pull`)

### 3. Git History Opschonen (Optioneel maar Aanbevolen)
De oude credentials staan nog in de Git geschiedenis. Om deze volledig te verwijderen:

```bash
# Gebruik BFG Repo-Cleaner (aanbevolen) of git filter-branch
# Dit verwijdert de credentials uit de hele Git geschiedenis
```

### 4. Database Wachtwoord Wijzigen (Aanbevolen)
Overweeg om het database wachtwoord te wijzigen, omdat het ook exposed was.

## 📝 Nieuwe Admin Account Aanmaken (optioneel)

Als je een nieuwe admin account wilt aanmaken met het nieuwe wachtwoord:

1. Ga naar: `https://holwert-backend.vercel.app/api/setup-admin`
2. Dit maakt/update de admin user met de credentials uit environment variables
3. Je krijgt een JWT token terug om in te loggen

## ✅ Status

- ✅ Code is veilig (geen hardcoded credentials meer)
- ✅ Vercel environment variables zijn ingesteld
- ⚠️ PHP server environment variables moeten nog ingesteld worden
- ⚠️ Admin wachtwoord moet gewijzigd worden na eerste login
