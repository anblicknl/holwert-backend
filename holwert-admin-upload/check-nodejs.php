<?php
/**
 * Check if Node.js is available on this server
 */

echo "<h2>🔍 Server Capabilities Check</h2>";

// Check PHP version
echo "<h3>PHP Info:</h3>";
echo "<p>PHP Version: " . phpversion() . "</p>";

// Check if exec is available
echo "<h3>System Commands:</h3>";
if (function_exists('exec')) {
    echo "<p>✅ exec() is available</p>";
    
    // Try to find node
    $output = [];
    $return_var = 0;
    exec('which node 2>&1', $output, $return_var);
    
    if ($return_var === 0 && !empty($output)) {
        echo "<p>✅ Node.js gevonden: " . htmlspecialchars($output[0]) . "</p>";
        
        // Check node version
        exec('node --version 2>&1', $nodeVersion, $return_var);
        if ($return_var === 0) {
            echo "<p>Node.js versie: " . htmlspecialchars($nodeVersion[0]) . "</p>";
        }
    } else {
        echo "<p>❌ Node.js niet gevonden</p>";
    }
    
    // Check if we can run shell commands
    exec('php --version 2>&1', $phpVersion, $return_var);
    if ($return_var === 0) {
        echo "<p>✅ PHP CLI werkt</p>";
    }
} else {
    echo "<p>❌ exec() is niet beschikbaar</p>";
}

// Check database connection
echo "<h3>Database Connection:</h3>";
try {
    $pdo = new PDO(
        "mysql:host=localhost;dbname=appenvlo_holwert;charset=utf8mb4",
        'db_holwert',
        $_ENV['DB_PASSWORD'] ?? getenv('DB_PASSWORD') ?: ''
    );
    echo "<p>✅ MySQL connectie werkt!</p>";
} catch (PDOException $e) {
    echo "<p>❌ MySQL connectie faalt: " . htmlspecialchars($e->getMessage()) . "</p>";
}

echo "<hr>";
echo "<h3>Conclusie:</h3>";
echo "<p>Als Node.js niet beschikbaar is, gebruik dan de PHP API proxy oplossing.</p>";
?>

