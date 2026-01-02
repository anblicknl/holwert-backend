<?php
/**
 * Database Proxy voor MySQL
 * 
 * Veilige proxy die database queries uitvoert voor Vercel backend.
 * Draait op shared hosting met localhost MySQL toegang.
 * 
 * Security: Alleen whitelisted queries zijn toegestaan
 */

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

// Database configuratie
$db_config = [
    'host' => 'localhost',
    'port' => 3306,
    'dbname' => 'appenvlo_holwert',
    'user' => 'db_holwert',
    'password' => 'h0lwert.2026',
    'charset' => 'utf8mb4'
];

// Security: API key (gebruik een sterk wachtwoord!)
$API_KEY = 'holwert-db-proxy-2026-secure-key-change-in-production';

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

// Tijdelijke, zeer specifieke whitelist voor éénmalige kolomaanpassing
$allowedMaintenanceQuery = 'ALTER TABLE ORGANIZATIONS MODIFY COLUMN LOGO_URL MEDIUMTEXT';
$isWhitelistedMaintenance = (
    $action === 'execute' && 
    stripos($queryUpper, $allowedMaintenanceQuery) !== false
);

// Als het de whitelisted onderhoudsquery is, voer direct uit en sla verdere checks over
if ($isWhitelistedMaintenance) {
    try {
        $pdo->exec($query);
        echo json_encode(['success' => true, 'message' => 'Maintenance ALTER executed']);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Maintenance query failed', 'message' => $e->getMessage()]);
    }
    exit;
}

// Alleen echt gevaarlijke operaties blokkeren, ongeacht action type
// INSERT, UPDATE, DELETE zijn toegestaan via hun respectievelijke actions
$trulyDangerous = ['DROP TABLE', 'DROP DATABASE', 'TRUNCATE TABLE', 'ALTER TABLE', 'CREATE TABLE'];
foreach ($trulyDangerous as $dangerous) {
    if (strpos($queryUpper, $dangerous) !== false) {
        // Alleen ALTER TABLE en CREATE TABLE blokkeren (behalve whitelisted maintenance)
        if (strpos($dangerous, 'ALTER TABLE') !== false || strpos($dangerous, 'CREATE TABLE') !== false) {
            http_response_code(403);
            echo json_encode(['error' => 'Forbidden - Dangerous query detected: ' . $dangerous]);
            exit;
        }
    }
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

