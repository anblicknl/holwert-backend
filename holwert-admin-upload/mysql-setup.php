<?php
/**
 * MySQL Database Setup Script
 * 
 * Dit script richt automatisch de MySQL database in.
 * Draait op de shared hosting server zelf, dus kan via localhost verbinden.
 * 
 * Gebruik: Upload naar /admin/mysql-setup.php en open in browser
 */

// Database credentials - SECURITY: Use environment variables only!
$db_host = $_ENV['DB_HOST'] ?? getenv('DB_HOST') ?: 'localhost';
$db_port = (int)($_ENV['DB_PORT'] ?? getenv('DB_PORT') ?: 3306);
$db_user = $_ENV['DB_USER'] ?? getenv('DB_USER') ?: 'db_holwert';
$db_password = $_ENV['DB_PASSWORD'] ?? getenv('DB_PASSWORD') ?: '';
$db_name = $_ENV['DB_NAME'] ?? getenv('DB_NAME') ?: 'appenvlo_holwert';

// SECURITY: Fail if password is not set via environment variable
if (empty($db_password)) {
    die('ERROR: Database password not configured. Set DB_PASSWORD environment variable.');
}

// Error handling
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Connectie maken
try {
    $pdo = new PDO(
        "mysql:host=$db_host;port=$db_port;dbname=$db_name;charset=utf8mb4",
        $db_user,
        $db_password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]
    );
    
    echo "<h2>✅ Verbonden met database!</h2>";
    
    $results = [
        'created' => [],
        'skipped' => [],
        'errors' => []
    ];
    
    // Helper functie om te checken of tabel bestaat
    function tableExists($pdo, $tableName) {
        $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?");
        $stmt->execute([$tableName]);
        $result = $stmt->fetch();
        return $result['count'] > 0;
    }
    
    // Users tabel
    if (!tableExists($pdo, 'users')) {
        $pdo->exec("
            CREATE TABLE users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                role VARCHAR(20) DEFAULT 'user',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_users_email (email),
                INDEX idx_users_role (role),
                INDEX idx_users_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $results['created'][] = 'users';
    } else {
        $results['skipped'][] = 'users';
    }
    
    // Organizations tabel
    if (!tableExists($pdo, 'organizations')) {
        $pdo->exec("
            CREATE TABLE organizations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                category VARCHAR(50),
                description TEXT,
                bio TEXT,
                website VARCHAR(255),
                email VARCHAR(255),
                phone VARCHAR(20),
                whatsapp VARCHAR(20),
                address TEXT,
                facebook VARCHAR(255),
                instagram VARCHAR(255),
                twitter VARCHAR(255),
                linkedin VARCHAR(255),
                brand_color VARCHAR(7),
                logo_url TEXT,
                is_approved BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_organizations_name (name),
                INDEX idx_organizations_category (category),
                INDEX idx_organizations_approved (is_approved)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $results['created'][] = 'organizations';
    } else {
        $results['skipped'][] = 'organizations';
    }
    
    // News tabel
    if (!tableExists($pdo, 'news')) {
        $pdo->exec("
            CREATE TABLE news (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                excerpt TEXT,
                image_url TEXT,
                category VARCHAR(50),
                custom_category VARCHAR(100),
                author_id INT NOT NULL,
                organization_id INT,
                is_published BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
                INDEX idx_news_author (author_id),
                INDEX idx_news_organization (organization_id),
                INDEX idx_news_published (is_published),
                INDEX idx_news_created (created_at DESC),
                INDEX idx_news_category (category)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $results['created'][] = 'news';
    } else {
        $results['skipped'][] = 'news';
    }
    
    // Events tabel
    if (!tableExists($pdo, 'events')) {
        $pdo->exec("
            CREATE TABLE events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                event_date DATETIME NOT NULL,
                event_end_date DATETIME,
                location VARCHAR(255),
                location_details TEXT,
                organizer_id INT NOT NULL,
                organization_id INT,
                category VARCHAR(50) DEFAULT 'evenement',
                price DECIMAL(10,2) DEFAULT 0.00,
                max_attendees INT,
                image_url TEXT,
                status VARCHAR(20) DEFAULT 'scheduled',
                published_at DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
                INDEX idx_events_organizer (organizer_id),
                INDEX idx_events_organization (organization_id),
                INDEX idx_events_date (event_date),
                INDEX idx_events_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $results['created'][] = 'events';
    } else {
        $results['skipped'][] = 'events';
    }
    
    // Bookmarks tabel
    if (!tableExists($pdo, 'bookmarks')) {
        $pdo->exec("
            CREATE TABLE bookmarks (
                user_id INT NOT NULL,
                news_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, news_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
                INDEX idx_bookmarks_user (user_id),
                INDEX idx_bookmarks_news (news_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $results['created'][] = 'bookmarks';
    } else {
        $results['skipped'][] = 'bookmarks';
    }
    
    // Follows tabel
    if (!tableExists($pdo, 'follows')) {
        $pdo->exec("
            CREATE TABLE follows (
                user_id INT NOT NULL,
                organization_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, organization_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
                INDEX idx_follows_user (user_id),
                INDEX idx_follows_organization (organization_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $results['created'][] = 'follows';
    } else {
        $results['skipped'][] = 'follows';
    }
    
    // Push tokens tabel
    if (!tableExists($pdo, 'push_tokens')) {
        $pdo->exec("
            CREATE TABLE push_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                token VARCHAR(255) UNIQUE NOT NULL,
                device_type VARCHAR(50),
                device_name VARCHAR(255),
                notification_preferences JSON DEFAULT ('{\"news\":true,\"agenda\":true,\"organizations\":true,\"weather\":true}'),
                is_active BOOLEAN DEFAULT true,
                last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_push_tokens_user_id (user_id),
                INDEX idx_push_tokens_token (token),
                INDEX idx_push_tokens_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $results['created'][] = 'push_tokens';
    } else {
        $results['skipped'][] = 'push_tokens';
    }
    
    // Notification history tabel
    if (!tableExists($pdo, 'notification_history')) {
        $pdo->exec("
            CREATE TABLE notification_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                push_token_id INT,
                notification_type VARCHAR(50),
                title VARCHAR(255),
                body TEXT,
                data JSON,
                status VARCHAR(50),
                error_message TEXT,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                delivered_at TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (push_token_id) REFERENCES push_tokens(id) ON DELETE SET NULL,
                INDEX idx_notification_history_user_id (user_id),
                INDEX idx_notification_history_type (notification_type),
                INDEX idx_notification_history_sent_at (sent_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $results['created'][] = 'notification_history';
    } else {
        $results['skipped'][] = 'notification_history';
    }
    
    // Success!
    echo "<h2>✅ Database Setup Voltooid!</h2>";
    echo "<h3>Aangemaakt:</h3><ul>";
    foreach ($results['created'] as $table) {
        echo "<li>✅ $table</li>";
    }
    echo "</ul>";
    
    if (!empty($results['skipped'])) {
        echo "<h3>Bestaand (overgeslagen):</h3><ul>";
        foreach ($results['skipped'] as $table) {
            echo "<li>⏭️ $table</li>";
        }
        echo "</ul>";
    }
    
    // Haal database/server informatie op voor Vercel configuratie
    echo "<hr style='margin: 30px 0; border: 1px solid #ddd;'>";
    echo "<h2>📋 Database Connectie Informatie voor Vercel</h2>";
    echo "<div style='background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;'>";
    
    // MySQL server informatie
    $serverInfo = $pdo->query("SELECT VERSION() as version, DATABASE() as database_name, USER() as user, @@hostname as hostname")->fetch();
    $hostInfo = $pdo->query("SELECT @@hostname as hostname, @@port as port")->fetch();
    
    // Server hostname/IP
    $serverHostname = gethostname();
    $serverIP = $_SERVER['SERVER_ADDR'] ?? 'Niet beschikbaar';
    
    echo "<h3>🔌 Database Server Informatie:</h3>";
    echo "<table style='width: 100%; border-collapse: collapse; margin: 15px 0;'>";
    echo "<tr><td style='padding: 8px; border-bottom: 1px solid #ddd;'><strong>MySQL Versie:</strong></td><td style='padding: 8px; border-bottom: 1px solid #ddd;'>" . htmlspecialchars($serverInfo['version']) . "</td></tr>";
    echo "<tr><td style='padding: 8px; border-bottom: 1px solid #ddd;'><strong>Database Naam:</strong></td><td style='padding: 8px; border-bottom: 1px solid #ddd;'>" . htmlspecialchars($serverInfo['database_name']) . "</td></tr>";
    echo "<tr><td style='padding: 8px; border-bottom: 1px solid #ddd;'><strong>MySQL Hostname:</strong></td><td style='padding: 8px; border-bottom: 1px solid #ddd;'>" . htmlspecialchars($hostInfo['hostname']) . "</td></tr>";
    echo "<tr><td style='padding: 8px; border-bottom: 1px solid #ddd;'><strong>MySQL Poort:</strong></td><td style='padding: 8px; border-bottom: 1px solid #ddd;'>" . htmlspecialchars($hostInfo['port']) . "</td></tr>";
    echo "<tr><td style='padding: 8px; border-bottom: 1px solid #ddd;'><strong>Web Server Hostname:</strong></td><td style='padding: 8px; border-bottom: 1px solid #ddd;'>" . htmlspecialchars($serverHostname) . "</td></tr>";
    echo "<tr><td style='padding: 8px; border-bottom: 1px solid #ddd;'><strong>Web Server IP:</strong></td><td style='padding: 8px; border-bottom: 1px solid #ddd;'>" . htmlspecialchars($serverIP) . "</td></tr>";
    echo "<tr><td style='padding: 8px;'><strong>Database Gebruiker:</strong></td><td style='padding: 8px;'>" . htmlspecialchars($db_user) . "</td></tr>";
    echo "</table>";
    
    // Test externe toegankelijkheid
    echo "<h3>🌐 Externe Toegankelijkheid Test:</h3>";
    $domain = $_SERVER['HTTP_HOST'] ?? 'Niet beschikbaar';
    echo "<p><strong>Huidige Domain:</strong> " . htmlspecialchars($domain) . "</p>";
    
    // Mogelijke hostnames voor MySQL
    $possibleHosts = [
        'localhost',
        $serverHostname,
        str_replace('www.', '', $domain),
        'mysql.' . str_replace('www.', '', $domain),
        $serverIP
    ];
    
    echo "<p><strong>Mogelijke MySQL Hostnames voor Vercel:</strong></p>";
    echo "<ul>";
    foreach (array_unique($possibleHosts) as $host) {
        if ($host && $host !== 'Niet beschikbaar') {
            echo "<li><code>" . htmlspecialchars($host) . "</code></li>";
        }
    }
    echo "</ul>";
    
    echo "<p style='color: #856404; background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0;'>";
    echo "⚠️ <strong>Let op:</strong> Als MySQL alleen lokaal toegankelijk is, moet je mogelijk je hosting provider vragen om externe toegang in te schakelen, of de backend op deze server draaien in plaats van Vercel.";
    echo "</p>";
    
    // Vercel Environment Variables
    echo "<h3>⚙️ Vercel Environment Variables:</h3>";
    echo "<p>Voeg deze toe in Vercel Dashboard → Project → Settings → Environment Variables:</p>";
    echo "<div style='background: #f8f9fa; padding: 15px; border-radius: 4px; font-family: monospace; margin: 10px 0;'>";
    echo "<strong>DB_HOST</strong> = " . htmlspecialchars($possibleHosts[1] ?? 'localhost') . "<br>";
    echo "<strong>DB_PORT</strong> = 3306<br>";
    echo "<strong>DB_USER</strong> = " . htmlspecialchars($db_user) . "<br>";
    echo "<strong>DB_PASSWORD</strong> = " . (empty($db_password) ? '<span style="color:red;">NOT SET - Configure via environment variable!</span>' : '***HIDDEN***') . "<br>";
    echo "<strong>DB_NAME</strong> = " . htmlspecialchars($db_name) . "<br>";
    echo "</div>";
    
    // Connection string
    echo "<h3>🔗 Connection String (alternatief):</h3>";
    $connectionString = "mysql://" . urlencode($db_user) . ":" . urlencode($db_password) . "@" . 
                       ($possibleHosts[1] ?? 'localhost') . ":3306/" . $db_name;
    echo "<div style='background: #f8f9fa; padding: 15px; border-radius: 4px; font-family: monospace; margin: 10px 0; word-break: break-all;'>";
    echo htmlspecialchars($connectionString);
    echo "</div>";
    echo "<p style='font-size: 12px; color: #666;'>Gebruik dit als <strong>DATABASE_URL</strong> in Vercel (als alternatief voor individuele variabelen)</p>";
    
    echo "</div>";
    
    echo "<hr style='margin: 30px 0; border: 1px solid #ddd;'>";
    echo "<h2>📝 Volgende Stappen:</h2>";
    echo "<ol style='line-height: 2;'>";
    echo "<li>Kopieer de bovenstaande database connectie informatie</li>";
    echo "<li>Ga naar Vercel Dashboard → Project → Settings → Environment Variables</li>";
    echo "<li>Voeg de environment variables toe (probeer eerst de MySQL hostname, als dat niet werkt probeer dan de andere opties)</li>";
    echo "<li>Update server.js om MySQL te gebruiken (ik help je hierbij)</li>";
    echo "<li>Redeploy de backend op Vercel</li>";
    echo "<li>Test de API endpoints</li>";
    echo "</ol>";
    
} catch (PDOException $e) {
    echo "<h2>❌ Fout</h2>";
    echo "<p><strong>Error:</strong> " . htmlspecialchars($e->getMessage()) . "</p>";
    echo "<p><strong>Code:</strong> " . $e->getCode() . "</p>";
}
?>

