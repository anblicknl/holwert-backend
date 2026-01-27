<?php
/**
 * Add privacy_policy and privacy_policy_url columns to organizations table
 * This allows organizations to have their own privacy statements
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

    echo "=== ADDING PRIVACY_POLICY COLUMNS TO ORGANIZATIONS TABLE ===\n\n";

    // Check if privacy_policy column already exists
    $stmt = $pdo->query("SHOW COLUMNS FROM organizations LIKE 'privacy_policy'");
    $privacyPolicyExists = $stmt->fetch();

    if ($privacyPolicyExists) {
        echo "⚠️  Column privacy_policy already exists!\n";
    } else {
        // Add privacy_policy column
        $pdo->exec("
            ALTER TABLE organizations 
            ADD COLUMN privacy_policy TEXT NULL
        ");
        echo "✅ Added privacy_policy column\n";
    }

    // Check if privacy_policy_url column already exists
    $stmt = $pdo->query("SHOW COLUMNS FROM organizations LIKE 'privacy_policy_url'");
    $privacyPolicyUrlExists = $stmt->fetch();

    if ($privacyPolicyUrlExists) {
        echo "⚠️  Column privacy_policy_url already exists!\n";
    } else {
        // Add privacy_policy_url column
        $pdo->exec("
            ALTER TABLE organizations 
            ADD COLUMN privacy_policy_url VARCHAR(500) NULL
        ");
        echo "✅ Added privacy_policy_url column\n";
    }

    // Show current structure
    echo "\n=== CURRENT ORGANIZATIONS TABLE STRUCTURE ===\n";
    $columns = $pdo->query("SHOW COLUMNS FROM organizations")->fetchAll();
    foreach ($columns as $column) {
        echo "  - {$column['Field']} ({$column['Type']})\n";
    }

    echo "\n=== DONE ===\n";

} catch (PDOException $e) {
    echo "❌ Database error: " . $e->getMessage() . "\n";
    exit(1);
}
