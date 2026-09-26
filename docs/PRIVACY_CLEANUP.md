# Privacy-opruimtaak Holwert

Hersteld in productie op 26 september 2026. De taak staat in proefstand en verwijdert niets.

## Bereik

- Verlopen records in `app_password_resets` en `org_password_resets`: `expires_at <= NOW()`.
- Meldingshistorie in `notification_history` ouder dan 28 dagen. Dit laat circa twee dagen marge tot het vastgestelde maximum van 30 dagen.
- Geen accounts, actuele herstelcodes, foto's, push-tokens, supportmails of back-ups. Voor die gegevens blijven de aparte processen en eerder vastgestelde aandachtspunten gelden.
- Per uitvoering maximaal 1000 verwijderingen per tabel. Een resterende achterstand of databasefout geeft HTTP 503 en moet worden opgevolgd. De taak belooft geen volledige afhandeling bij falende uitvoering of grote achterstand.

## Uitvoering

`GET /api/cron/privacy-cleanup` vereist altijd `Authorization: Bearer <CRON_SECRET>`. Zonder ingesteld geheim voert de route geen databasequery uit. Gebruik een bestaand veilig cron-geheim; zet geen waarde in broncode of documentatie. Een ontbrekend geheim moet door de beheerder via de normale geheimeninstellingen worden ingesteld.

`PRIVACY_CLEANUP_MODE` ontbrekend of `dry-run`: alleen aantallen. Alleen de expliciete waarde `delete` activeert verwijdering. Een HTTP-queryparameter kan verwijdering niet activeren. `?dry_run=1` forceert altijd een proefrun. Resultaten bevatten aantallen, geen accounts of herstelcodes. De taak zelf logt uitsluitend aantallen en vaste tabelnamen; de bestaande generieke databaseproxy heeft nog bredere logging die apart moet worden beperkt.

De taak telt eerst alle drie tabellen voordat hij verwijdert. Ontbrekende tabellen of proxyrechten leveren een fout op, geen stille overslag. De lokale PHP-proxywhitelist is aangevuld met `notification_history`; controleer vóór uitrol of de productieproxy deze tabel al toestaat en bestaat. Upload geen lokale credentials/fallbacks ongemerkt mee: pas zo nodig alleen de whitelist in de bestaande productieproxy aan.

## Planning en regio

`vercel.json` bevat Frankfurt (`fra1`) en een dagelijkse taak om 03:00 UTC, naast de bestaande afvalherinneringen. Frankfurt is tevens opgeslagen in het Vercel-dashboard; pas een nieuwe deployment verhuist de draaiende functies.

Hobby voert een dagelijkse cron uit binnen een tijdvenster van één uur. Daardoor kan tussen twee uitvoeringen bijna 25 uur zitten. Dit voldoet **niet gegarandeerd** aan de vastgestelde termijn van maximaal 24 uur voor het opruimen van verlopen herstelrecords. Laat de taak vóór definitieve activering minstens tweemaal per dag draaien via een geschikte scheduler (bijvoorbeeld na overstap naar een Vercel-plan dat deze frequentie ondersteunt: `0 */12 * * *`). Regel monitoring en opvolging van mislukte uitvoeringen. De dagelijkse Hobby-configuratie is nu uitsluitend een voorbereiding in proefstand; de beleidstermijn is niet aangepast.

## Uitrolvolgorde

1. Test: `node --test privacyCleanup.test.js`; syntax: `node --check server.js`.
2. Controleer productieproxy, tabellen en aanwezigheid van `CRON_SECRET`, zonder geheime waarden te publiceren.
3. Deploy met proefstand en controleer regio Frankfurt. Voer een geautoriseerde proefrun uit; bekijk uitsluitend aantallen en fouten.
4. Regel de frequentere planning en controleer de capaciteit: Hobby stond bij inspectie rond 99% van de team-CPU-limiet.
5. Leg de concrete proefresultaten en bovenstaande verwijdercategorieën ter bevestiging voor. Activeer pas daarna `PRIVACY_CLEANUP_MODE=delete` met een nieuwe deployment.
6. Controleer resultaat (`pending: false`) en blijf fouten/achterstand opvolgen. Mailbewaring, foto's, tokens en back-ups worden hierdoor niet automatisch geregeld.

Bron: [Vercel Cron Jobs – Hobby scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing#hobby-scheduling-limits).
