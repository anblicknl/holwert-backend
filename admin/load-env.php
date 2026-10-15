<?php
/**
 * Helper functie om .env bestand te laden op shared hosting
 * 
 * PHP heeft geen ingebouwde .env loader zoals Node.js.
 * Deze functie laadt een .env bestand en zet de variabelen in $_ENV en getenv().
 * 
 * Gebruik: require_once 'load-env.php'; aan het begin van je PHP bestanden
 */

function loadEnvFile($filePath = __DIR__ . '/.env') {
    if (!file_exists($filePath)) {
        return false;
    }
    
    $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    
    foreach ($lines as $line) {
        // Skip comments
        if (strpos(trim($line), '#') === 0) {
            continue;
        }
        
        // Parse KEY=VALUE format
        if (strpos($line, '=') !== false) {
            list($key, $value) = explode('=', $line, 2);
            $key = trim($key);
            $value = trim($value);
            
            // Remove quotes if present
            if ((substr($value, 0, 1) === '"' && substr($value, -1) === '"') ||
                (substr($value, 0, 1) === "'" && substr($value, -1) === "'")) {
                $value = substr($value, 1, -1);
            }
            
            // Set in both $_ENV and putenv for compatibility
            $_ENV[$key] = $value;
            putenv("$key=$value");
        }
    }
    
    return true;
}

// Auto-load .env if it exists
if (file_exists(__DIR__ . '/.env')) {
    loadEnvFile(__DIR__ . '/.env');
}
