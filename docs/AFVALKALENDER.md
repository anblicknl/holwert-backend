# Afvalkalender – datums zelf aanpassen

De app toont op **Praktisch** en in **Weer-tips** de afvalkalender. De datums komen van de backend en kun je als beheerder aanpassen.

## API

- **GET** `/api/app/afvalkalender` (publiek)  
  Geeft de actuele kalender + berekende datums + of vandaag oud-papier/containerdag is.

- **GET** `/api/admin/afvalkalender` (admin, token verplicht)  
  Geeft alleen de opgeslagen config (om te bewerken).

- **PUT** `/api/admin/afvalkalender` (admin, token verplicht)  
  Slaat de config op. Body (JSON):

```json
{
  "oudPapier": {
    "type": "recurring",
    "weekday": 2,
    "interval_weeks": 6,
    "first_date": "2025-02-04"
  },
  "containers": {
    "weekday": 5,
    "extra_dates": ["2025-07-04", "2025-08-15"]
  }
}
```

### Oud papier

- **type `recurring`** (herhaling):
  - `weekday`: 0 = zo, 1 = ma, **2 = di**, 3 = wo, 4 = do, 5 = vr, 6 = za.
  - `interval_weeks`: aantal weken tussen twee ophaaldagen (bijv. **6** voor “eens in de 6 weken”).
  - `first_date`: eerste ophaaldatum (YYYY-MM-DD), daarna wordt elke N weken een datum berekend.

- **type `dates`** (vaste lijst datums):
  - `dates`: array van datums in YYYY-MM-DD, bijv. `["2025-02-04", "2025-03-18", "2025-05-06"]`.

### Containers

- `weekday`: standaard **5** (vrijdag). Elke vrijdag wordt berekend; om de week groen, om de week grijs (op basis van weeknummer).
- `extra_dates`: optionele extra ophaaldagen (bijv. zomer), array van YYYY-MM-DD. Deze krijgen het label “extra” in de app.

## Voorbeeld (curl)

Eerst inloggen en token gebruiken:

```bash
# Inloggen (zet JWT in variabele)
TOKEN=$(curl -s -X POST https://holwert-backend.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@voorbeeld.nl","password":"wachtwoord"}' | jq -r '.token')

# Config zetten: oud papier elke dinsdag, eens in de 6 weken; containers elke vrijdag + 1 extra dag
curl -X PUT https://holwert-backend.vercel.app/api/admin/afvalkalender \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "oudPapier": {
      "type": "recurring",
      "weekday": 2,
      "interval_weeks": 6,
      "first_date": "2025-02-04"
    },
    "containers": {
      "weekday": 5,
      "extra_dates": ["2025-07-04"]
    }
  }'
```

## Standaard als er nog niets is opgeslagen

- Oud papier: **dinsdag**, eens in de **6** weken (eerste dinsdag van de huidige maand als start).
- Containers: **vrijdag**, geen extra datums.

De tabel `afvalkalender_config` wordt bij start van de server aangemaakt (CREATE TABLE IF NOT EXISTS).

**Vercel + PHP proxy:** Als de backend via de PHP database-proxy praat, voeg dan `afvalkalender_config` toe aan de proxy-whitelist (zie o.a. `docs/DB_PROXY_PUSH_MUTES.md`). Anders vallen GET/PUT afvalkalender terug op de standaardconfig (geen 500).
