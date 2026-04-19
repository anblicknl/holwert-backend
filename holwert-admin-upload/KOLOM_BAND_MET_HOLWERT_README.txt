KOLOM "relationship_with_holwert" TOEVOEGEN
============================================

Als het PHP-script een blanco pagina geeft, voert de server waarschijnlijk
geen PHP uit in de /admin-map. Gebruik dan onderstaande methode.

VIA PHPMYADMIN (altijd bruikbaar)
---------------------------------
1. Log in op phpMyAdmin (zelfde plek waar je je database beheert).
2. Selecteer je Holwert-database (bijv. appenvlo_holwert).
3. Klik op het tabblad "SQL".
4. Plak deze regel in het tekstvak:

   ALTER TABLE users ADD COLUMN relationship_with_holwert VARCHAR(50) NULL;

5. Klik op "Start" / "Uitvoeren".
6. Als de kolom al bestond, krijg je een foutmelding; dat is geen probleem.
   Anders zie je dat 1 rij is aangepast / de structuur is bijgewerkt.

Daarna kan "Band met Holwert" in het adminpanel gewoon worden opgeslagen.

OPTIONEEL: PHP TESTEN
--------------------
Upload test_php.php naar dezelfde /admin-map en open in de browser:
  https://holwert.appenvloed.com/admin/test_php.php

- Zie je "PHP werkt op deze server." → PHP draait wél; dan kun je
  add_relationship_with_holwert_column.php gebruiken (met juiste DB-gegevens).
- Blijft de pagina blanco → PHP draait niet in /admin; gebruik phpMyAdmin (boven).
