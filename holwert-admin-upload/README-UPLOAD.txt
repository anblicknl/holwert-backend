# Holwert Admin Panel - FTP Upload Instructies

Dit zijn de bestanden die je moet uploaden naar de `/admin` map op je FTP server.

## 📤 TE UPLOADEN NAAR FTP (UPDATE 28 DEC 2024):

1. ✅ **`index.html`** (Hoofd admin interface)
2. ✅ **`admin-panel.js`** (Alle JavaScript logic - NIEUW!)
3. ✅ **`styles.css`** (Sober zwart-wit styling)

## 🗑️ VERWIJDER VAN FTP:

- **`app.js`** - Oude versie, moet WEG!

## ℹ️ NEGEER DEZE:

- `app.js` - Backup versie, gebruik admin-panel.js
- `dashboard.html` - Dit is nu een redirect naar `index.html`
- `login.html` - Standalone login pagina (optioneel)
- `_alternative/` map - Backup bestanden
- `_dont-use/` map - Test bestanden

---

**BELANGRIJK NA UPLOADEN:**

1. **VERWIJDER `app.js` VAN JE FTP SERVER!**
2. Upload `admin-panel.js` en `index.html`
3. **HARD REFRESH** in Firefox: Shift + F5
4. Of gebruik een **private window**: Cmd + Shift + P

**PROBLEEM OPGELOST:**
- Dubbele `editNews` functie verwijderd (was op regel 1867 EN 1543)
- Oude functies verwijderd die conflicteerden (showEditNewsModal, toggleCustomCategory, saveNewsChanges)
- Bewerken van nieuws zou nu moeten werken!
