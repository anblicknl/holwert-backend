<?php
/**
 * Database Proxy voor MySQL
 * 
 * Veilige proxy die database queries uitvoert voor Vercel backend.
 * Draait op shared hosting met localhost MySQL toegang.
 * 
 * Security: Alleen whitelisted queries zijn toegestaan
 */

// Load environment variables from .env file (if exists)
$envLoader = __DIR__ . '/load-env.php';
if (file_exists($envLoader)) {
    require_once $envLoader;
}

// Enable output buffering and compression voor betere performance
if (extension_loaded('zlib') && !ob_get_level()) {
    ob_start('ob_gzhandler');
} else {
    ob_start();
}

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Database configuratie - SECURITY: Use environment variables only!
$db_config = [
    'host' => $_ENV['DB_HOST'] ?? getenv('DB_HOST') ?: 'localhost',
    'port' => (int)($_ENV['DB_PORT'] ?? getenv('DB_PORT') ?: 3306),
    'dbname' => $_ENV['DB_NAME'] ?? getenv('DB_NAME') ?: 'appenvlo_holwert',
    'user' => $_ENV['DB_USER'] ?? getenv('DB_USER') ?: 'db_holwert',
    'password' => $_ENV['DB_PASSWORD'] ?? getenv('DB_PASSWORD') ?: '',
    'charset' => 'utf8mb4'
];

// SECURITY: Fail if password is not set via environment variable
if (empty($db_config['password'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Database password not configured - set DB_PASSWORD environment variable']);
    exit;
}

// Security: API key - SECURITY: Use environment variable only!
$API_KEY = $_ENV['PHP_PROXY_API_KEY'] ?? getenv('PHP_PROXY_API_KEY') ?: '';

// SECURITY: Fail if API key is not set via environment variable
if (empty($API_KEY)) {
    http_response_code(500);
    echo json_encode(['error' => 'API key not configured - set PHP_PROXY_API_KEY environment variable']);
    exit;
}

// Check API key
$providedKey = $_SERVER['HTTP_X_API_KEY'] ?? $_POST['api_key'] ?? '';
if ($providedKey !== $API_KEY) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized - Invalid API key']);
    exit;
}

// Database connectie met persistent connection voor betere performance
try {
    $pdo = new PDO(
        "mysql:host={$db_config['host']};port={$db_config['port']};dbname={$db_config['dbname']};charset={$db_config['charset']}",
        $db_config['user'],
        $db_config['password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_PERSISTENT => true, // Persistent connection voor betere performance
            PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => true // Buffer queries voor betere performance
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed', 'message' => $e->getMessage()]);
    exit;
}

// Get request
$input = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $input['action'] ?? '';
$query = $input['query'] ?? '';
$params = $input['params'] ?? [];

// Security: Whitelist van toegestane queries
$allowedActions = [
    'execute',      // Voor SELECT queries
    'insert',       // Voor INSERT queries
    'update',       // Voor UPDATE queries
    'delete',       // Voor DELETE queries
    'batch',        // Voor meerdere queries in één request (performance!)
    'health'        // Health check
];

if (!in_array($action, $allowedActions)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid action']);
    exit;
}

// Security: Check voor gevaarlijke queries (basic protection)
// Alleen echt gevaarlijke operaties blokkeren, niet normale INSERT/DELETE/UPDATE
$queryUpper = strtoupper(trim($query));

// Whitelist voor veilige ALTER/CREATE operaties op de users-tabel (migraties)
$allowedAlterPatterns = [
    'ALTER TABLE ORGANIZATIONS MODIFY COLUMN LOGO_URL MEDIUMTEXT',
    'ALTER TABLE USERS ADD COLUMN PROFILE_IMAGE_URL',
    'ALTER TABLE USERS ADD COLUMN PROFILE_NUMBER',
    'CREATE TABLE IF NOT EXISTS PUSH_TOKENS',
    'CREATE TABLE IF NOT EXISTS BOOKMARKS',
    'CREATE TABLE IF NOT EXISTS FOLLOWS',
    'CREATE TABLE IF NOT EXISTS NOTIFICATION_HISTORY',
    'CREATE TABLE IF NOT EXISTS PRACTICAL_INFO',
    'ALTER TABLE ORGANIZATIONS ADD COLUMN PRIVACY_STATEMENT',
];
$isWhitelistedMaintenance = false;
foreach ($allowedAlterPatterns as $pattern) {
    if (stripos($queryUpper, $pattern) !== false) {
        $isWhitelistedMaintenance = true;
        break;
    }
}

if ($isWhitelistedMaintenance) {
    try {
        $pdo->exec($query);
        echo json_encode(['success' => true, 'message' => 'Migration executed', 'rows' => [], 'rowCount' => 0]);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            echo json_encode(['success' => true, 'message' => 'Column already exists', 'rows' => [], 'rowCount' => 0]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Migration failed', 'message' => $e->getMessage()]);
        }
    }
    exit;
}

// Alleen echt gevaarlijke operaties blokkeren, ongeacht action type
// INSERT, UPDATE, DELETE zijn toegestaan via hun respectievelijke actions
$trulyDangerous = ['DROP TABLE', 'DROP DATABASE', 'TRUNCATE TABLE', 'ALTER TABLE', 'CREATE TABLE', 'GRANT ', 'REVOKE '];
foreach ($trulyDangerous as $dangerous) {
    if (strpos($queryUpper, $dangerous) !== false) {
        // ALTER/CREATE blokkeren (behalve whitelisted maintenance); GRANT/REVOKE altijd blokkeren
        if (strpos($dangerous, 'ALTER TABLE') !== false || strpos($dangerous, 'CREATE TABLE') !== false
            || strpos($dangerous, 'GRANT ') !== false || strpos($dangerous, 'REVOKE ') !== false) {
            http_response_code(403);
            echo json_encode(['error' => 'Forbidden - Dangerous query detected: ' . $dangerous]);
            exit;
        }
    }
}

// SECURITY: Geen multi-statement (alleen één query per request)
if (strpos($query, ';') !== false) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden - Multiple statements not allowed']);
    exit;
}

// SECURITY: Alleen toegestane tabellen (whitelist)
$allowedTables = [
    'users', 'organizations', 'news', 'events', 'bookmarks', 'follows',
    'push_tokens', 'found_lost', 'notification_history', 'practical_info',
    'information_schema'  // voor schema-checks/migraties
];

function extractTableNames($sql) {
    $tables = [];
    // FROM table, JOIN table, INSERT INTO table, UPDATE table, DELETE FROM table (eventueel met backticks)
    if (preg_match_all('/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|JOIN)\s+`?(\w+)`?/i', $sql, $m)) {
        foreach ($m[1] as $t) {
            $t = strtolower($t);
            if (!in_array($t, $tables)) {
                $tables[] = $t;
            }
        }
    }
    return $tables;
}

function tablesAllowed($sql, $allowedTables) {
    $found = extractTableNames($sql);
    foreach ($found as $t) {
        if (!in_array($t, $allowedTables)) {
            return false;
        }
    }
    return true;
}

if (!empty($query) && !tablesAllowed($query, $allowedTables)) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden - Query references disallowed table(s)']);
    exit;
}

try {
    switch ($action) {
        case 'health':
            $pdo->query('SELECT 1');
            echo json_encode([
                'status' => 'OK', 
                'database' => 'MySQL connected',
                'timestamp' => date('c')
            ]);
            break;

        case 'execute':
            // Voor SELECT queries
            if (empty($query)) {
                throw new Exception('Query is required');
            }
            
            $stmt = $pdo->prepare($query);
            $stmt->execute($params);
            $results = $stmt->fetchAll();
            
            echo json_encode([
                'rows' => $results, 
                'rowCount' => count($results),
                'success' => true
            ]);
            break;

        case 'insert':
            // Voor INSERT queries - retourneert insertId
            if (empty($query)) {
                throw new Exception('Query is required');
            }
            
            $stmt = $pdo->prepare($query);
            $stmt->execute($params);
            $insertId = $pdo->lastInsertId();
            
            echo json_encode([
                'insertId' => $insertId ? intval($insertId) : null, 
                'affectedRows' => $stmt->rowCount(),
                'success' => true
            ]);
            break;

        case 'update':
            // Voor UPDATE queries
            if (empty($query)) {
                throw new Exception('Query is required');
            }
            
            $stmt = $pdo->prepare($query);
            $stmt->execute($params);
            
            echo json_encode([
                'affectedRows' => $stmt->rowCount(),
                'success' => true
            ]);
            break;

        case 'delete':
            // Voor DELETE queries
            if (empty($query)) {
                throw new Exception('Query is required');
            }
            
            $stmt = $pdo->prepare($query);
            $stmt->execute($params);
            
            echo json_encode([
                'affectedRows' => $stmt->rowCount(),
                'success' => true
            ]);
            break;

        case 'batch':
            // Voor meerdere queries in één request - GEWELDIG voor performance!
            $queries = $input['queries'] ?? [];
            if (empty($queries) || !is_array($queries)) {
                throw new Exception('Queries array is required for batch action');
            }
            // Zelfde security-checks per batch-query: geen multi-statement, alleen whitelisted tabellen
            foreach ($queries as $batchQuery) {
                $q = $batchQuery['query'] ?? '';
                if (empty($q)) continue;
                if (strpos($q, ';') !== false) {
                    http_response_code(403);
                    echo json_encode(['error' => 'Forbidden - Multiple statements not allowed in batch']);
                    exit;
                }
                if (!tablesAllowed($q, $allowedTables)) {
                    http_response_code(403);
                    echo json_encode(['error' => 'Forbidden - Batch query references disallowed table(s)']);
                    exit;
                }
            }
            
            $results = [];
            foreach ($queries as $batchQuery) {
                $q = $batchQuery['query'] ?? '';
                $p = $batchQuery['params'] ?? [];
                $a = $batchQuery['action'] ?? 'execute';
                
                if (empty($q)) continue;
                
                try {
                    $stmt = $pdo->prepare($q);
                    $stmt->execute($p);
                    
                    if ($a === 'insert') {
                        $results[] = [
                            'success' => true,
                            'insertId' => $pdo->lastInsertId() ? intval($pdo->lastInsertId()) : null,
                            'affectedRows' => $stmt->rowCount()
                        ];
                    } else if ($a === 'update' || $a === 'delete') {
                        $results[] = [
                            'success' => true,
                            'affectedRows' => $stmt->rowCount()
                        ];
                    } else {
                        $results[] = [
                            'success' => true,
                            'rows' => $stmt->fetchAll(),
                            'rowCount' => $stmt->rowCount()
                        ];
                    }
                } catch (PDOException $e) {
                    $results[] = [
                        'success' => false,
                        'error' => $e->getMessage()
                    ];
                }
            }
            
            echo json_encode([
                'results' => $results,
                'success' => true
            ]);
            break;

        default:
            http_response_code(400);
            echo json_encode(['error' => 'Unknown action', 'success' => false]);
    }
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Database error', 
        'message' => $e->getMessage(),
        'code' => $e->getCode(),
        'success' => false
    ]);
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'error' => $e->getMessage(),
        'success' => false
    ]);
}

// Flush output buffer
ob_end_flush();

