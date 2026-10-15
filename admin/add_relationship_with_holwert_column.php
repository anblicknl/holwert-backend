<?php
/**
 * Eenmalig hulpscript om de kolom `relationship_with_holwert`
 * toe te voegen aan de `users`-tabel in de Holwert-database.
 *
 * Gebruik:
 * 1. Vul hieronder je eigen database-gegevens in.
 * 2. Upload dit bestand naar de server (zelfde map als admin).
 * 3. Ga in je browser naar de URL van dit script.
 * 4. Verwijder dit bestand daarna direct van de server.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: text/html; charset=utf-8');

// Meteen iets tonen, zodat je nooit een blanco pagina ziet
echo "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Holwert DB-script</title>";
echo "<style>body{font-family:system-ui,sans-serif;padding:1.5rem;background:#f5f5f7;} pre{background:#fff;padding:1rem;border-radius:6px;border:1px solid #ddd;white-space:pre-wrap;}</style>";
echo "</head><body><h1>Kolom <code>relationship_with_holwert</code></h1><pre>\n";

// Databasegegevens (zoals in TECHNISCH_RAPPORT.md / server.js)
// Wachtwoord staat niet in de repo; haal uit Vercel (DB_PASSWORD) of hosting-panel.
$dbHost = 'localhost';
$dbPort = 3306;
$dbUser = 'db_holwert';
$dbName = 'appenvlo_holwert';
$dbPass = 'VUL_HIER_JE_DB_WACHTWOORD_IN';  // ← Vercel env "DB_PASSWORD" of hosting MySQL-wachtwoord

if (!extension_loaded('mysqli')) {
    echo "❌ De PHP-extensie 'mysqli' is niet geladen. Vraag je hoster om mysqli in te schakelen.\n";
    echo "</pre></body></html>";
    exit;
}

// Verbinding maken
$mysqli = @new mysqli($dbHost, $dbUser, $dbPass, $dbName, $dbPort);

if ($mysqli->connect_error) {
    echo "❌ Kon geen verbinding maken met de database.\n";
    echo "Fout: " . htmlspecialchars($mysqli->connect_error) . "\n";
    echo "\nControleer of je bovenaan het script de juiste DB-gegevens hebt ingevuld (dbUser, dbPass, dbName).\n";
    echo "</pre></body></html>";
    exit;
}

echo "✅ Verbonden met database: {$dbName}\n";

// Bestaat de kolom al?
$sqlCheck = "
    SELECT COUNT(*) AS cnt
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'relationship_with_holwert'
";

if (!$result = $mysqli->query($sqlCheck)) {
    echo "❌ Fout bij controleren van kolom:\n";
    echo htmlspecialchars($mysqli->error) . "\n";
    $mysqli->close();
    echo "</pre></body></html>";
    exit;
}

$row = $result->fetch_assoc();
if (!empty($row['cnt']) && (int)$row['cnt'] > 0) {
    echo "ℹ️  Kolom relationship_with_holwert bestaat al in users. Niets te doen.\n";
    $mysqli->close();
    echo "</pre></body></html>";
    exit;
}

echo "ℹ️  Kolom `relationship_with_holwert` bestaat nog niet, wordt nu aangemaakt...\n";

$alterSql = "ALTER TABLE users ADD COLUMN relationship_with_holwert VARCHAR(50) NULL";

if (!$mysqli->query($alterSql)) {
    echo "❌ Fout bij toevoegen van kolom:\n";
    echo htmlspecialchars($mysqli->error) . "\n";
    $mysqli->close();
    echo "</pre></body></html>";
    exit;
}

echo "✅ Kolom relationship_with_holwert is succesvol toegevoegd aan users.\n";
echo "👍 Verwijder dit bestand nu van de server.\n";

$mysqli->close();
echo "</pre></body></html>";

