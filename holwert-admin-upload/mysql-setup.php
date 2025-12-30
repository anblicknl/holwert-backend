<?php
/**
 * MySQL Database Setup Script
 * 
 * Dit script richt automatisch de MySQL database in.
 * Draait op de shared hosting server zelf, dus kan via localhost verbinden.
 * 
 * Gebruik: Upload naar /admin/mysql-setup.php en open in browser
 */

// Database credentials
$db_host = 'localhost';
$db_port = 3306;
$db_user = 'db_holwert';
$db_password = 'h0lwert.2026';
$db_name = 'appenvlo_holwert';

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
    
} catch (PDOException $e) {
    echo "<h2>❌ Fout</h2>";
    echo "<p><strong>Error:</strong> " . htmlspecialchars($e->getMessage()) . "</p>";
    echo "<p><strong>Code:</strong> " . $e->getCode() . "</p>";
}
?>

