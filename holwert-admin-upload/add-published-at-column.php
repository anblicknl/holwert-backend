<?php
/**
 * Script om published_at kolom toe te voegen aan news tabel
 * Upload dit bestand en bezoek het via de browser
 */

// Database configuratie
$db_config = [
    'host' => 'localhost',
    'port' => 3306,
    'dbname' => 'appenvlo_holwert',
    'user' => 'db_holwert',
    'password' => 'h0lwert.2026',
    'charset' => 'utf8mb4'
];

try {
    $pdo = new PDO(
        "mysql:host={$db_config['host']};port={$db_config['port']};dbname={$db_config['dbname']};charset={$db_config['charset']}",
        $db_config['user'],
        $db_config['password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]
    );
    
    echo "<h2>Published_at Kolom Toevoegen</h2>";
    
    // Check of kolom al bestaat
    $stmt = $pdo->query("SHOW COLUMNS FROM news LIKE 'published_at'");
    $columnExists = $stmt->rowCount() > 0;
    
    if ($columnExists) {
        echo "<p>✅ Kolom 'published_at' bestaat al!</p>";
    } else {
        // Voeg kolom toe
        $pdo->exec("
            ALTER TABLE news 
            ADD COLUMN published_at DATETIME NULL AFTER is_published
        ");
        
        echo "<p>✅ Kolom 'published_at' succesvol toegevoegd!</p>";
        
        // Update bestaande gepubliceerde artikelen: zet published_at = created_at
        $pdo->exec("
            UPDATE news 
            SET published_at = created_at 
            WHERE is_published = true AND published_at IS NULL
        ");
        
        $updated = $pdo->query("SELECT ROW_COUNT()")->fetchColumn();
        echo "<p>✅ {$updated} bestaande gepubliceerde artikelen bijgewerkt (published_at = created_at)</p>";
    }
    
    // Toon tabel structuur
    echo "<h3>Huidige tabel structuur:</h3>";
    $stmt = $pdo->query("DESCRIBE news");
    $columns = $stmt->fetchAll();
    
    echo "<table border='1' cellpadding='5'>";
    echo "<tr><th>Field</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th></tr>";
    foreach ($columns as $col) {
        $highlight = ($col['Field'] === 'published_at') ? " style='background-color: #90EE90;'" : "";
        echo "<tr{$highlight}>";
        echo "<td><strong>{$col['Field']}</strong></td>";
        echo "<td>{$col['Type']}</td>";
        echo "<td>{$col['Null']}</td>";
        echo "<td>{$col['Key']}</td>";
        echo "<td>{$col['Default']}</td>";
        echo "</tr>";
    }
    echo "</table>";
    
    echo "<h3>✅ Klaar!</h3>";
    echo "<p>De 'published_at' kolom is nu beschikbaar. Nieuws wordt nu gesorteerd op publicatiedatum in plaats van aanmaakdatum.</p>";
    
} catch (PDOException $e) {
    echo "<h2>❌ Fout!</h2>";
    echo "<p>Error: " . htmlspecialchars($e->getMessage()) . "</p>";
    echo "<p>Code: " . htmlspecialchars($e->getCode()) . "</p>";
}


