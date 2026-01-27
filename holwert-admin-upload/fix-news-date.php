<?php
/**
 * Script om published_at datum te updaten voor een specifiek nieuws artikel
 * Upload dit bestand en bezoek het via de browser
 */

// Database configuratie
$db_config = [
    'host' => 'localhost',
    'port' => 3306,
    'dbname' => 'appenvlo_holwert',
    'user' => 'db_holwert',
    'password' => $_ENV['DB_PASSWORD'] ?? getenv('DB_PASSWORD') ?: '',
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
    
    echo "<h2>Nieuws Datum Fix</h2>";
    
    // Zoek artikel van "The Sound" met titel "Het nieuwe jaar!"
    $stmt = $pdo->prepare("
        SELECT n.id, n.title, n.published_at, n.created_at, o.name as org_name
        FROM news n
        LEFT JOIN organizations o ON n.organization_id = o.id
        WHERE o.name = 'The Sound' AND n.title LIKE '%nieuwe jaar%'
        ORDER BY n.id DESC
        LIMIT 1
    ");
    $stmt->execute();
    $article = $stmt->fetch();
    
    if (!$article) {
        echo "<p>❌ Geen artikel gevonden van 'The Sound' met titel 'Het nieuwe jaar!'</p>";
        echo "<p>Beschikbare artikelen:</p>";
        $allStmt = $pdo->query("
            SELECT n.id, n.title, n.published_at, n.created_at, o.name as org_name
            FROM news n
            LEFT JOIN organizations o ON n.organization_id = o.id
            ORDER BY n.id DESC
            LIMIT 10
        ");
        $all = $allStmt->fetchAll();
        echo "<table border='1' cellpadding='5'>";
        echo "<tr><th>ID</th><th>Titel</th><th>Organisatie</th><th>Published At</th><th>Created At</th></tr>";
        foreach ($all as $a) {
            echo "<tr>";
            echo "<td>{$a['id']}</td>";
            echo "<td>{$a['title']}</td>";
            echo "<td>{$a['org_name']}</td>";
            echo "<td>{$a['published_at']}</td>";
            echo "<td>{$a['created_at']}</td>";
            echo "</tr>";
        }
        echo "</table>";
        exit;
    }
    
    echo "<p>✅ Artikel gevonden:</p>";
    echo "<ul>";
    echo "<li>ID: {$article['id']}</li>";
    echo "<li>Titel: {$article['title']}</li>";
    echo "<li>Organisatie: {$article['org_name']}</li>";
    echo "<li>Huidige published_at: {$article['published_at']}</li>";
    echo "<li>Created_at: {$article['created_at']}</li>";
    echo "</ul>";
    
    // Update naar 31 december 2025 12:00:00
    $newDate = '2025-12-31 12:00:00';
    $updateStmt = $pdo->prepare("
        UPDATE news 
        SET published_at = STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')
        WHERE id = ?
    ");
    $updateStmt->execute([$newDate, $article['id']]);
    
    echo "<p>✅ Published_at bijgewerkt naar: {$newDate}</p>";
    
    // Verifieer
    $verifyStmt = $pdo->prepare("SELECT id, title, published_at FROM news WHERE id = ?");
    $verifyStmt->execute([$article['id']]);
    $verified = $verifyStmt->fetch();
    
    echo "<p>✅ Verificatie:</p>";
    echo "<ul>";
    echo "<li>ID: {$verified['id']}</li>";
    echo "<li>Titel: {$verified['title']}</li>";
    echo "<li>Published_at: {$verified['published_at']}</li>";
    echo "</ul>";
    
} catch (PDOException $e) {
    echo "<p>❌ Fout: " . $e->getMessage() . "</p>";
}
?>

