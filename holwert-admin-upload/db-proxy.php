<?php
/**
 * Database Proxy voor MySQL
 * 
 * Veilige proxy die database queries uitvoert voor Vercel backend.
 * Draait op shared hosting met localhost MySQL toegang.
 * 
 * Security: Alleen whitelisted queries zijn toegestaan
 */

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

// Database connectie
try {
    $pdo = new PDO(
        "mysql:host={$db_config['host']};port={$db_config['port']};dbname={$db_config['dbname']};charset={$db_config['charset']}",
        $db_config['user'],
        $db_config['password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
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
    'health'        // Health check
];

if (!in_array($action, $allowedActions)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid action']);
    exit;
}

try {
    switch ($action) {
        case 'health':
            $pdo->query('SELECT 1');
            echo json_encode(['status' => 'OK', 'database' => 'MySQL connected']);
            break;

        case 'execute':
            // Voor SELECT queries
            $stmt = $pdo->prepare($query);
            $stmt->execute($params);
            $results = $stmt->fetchAll();
            echo json_encode(['rows' => $results, 'rowCount' => count($results)]);
            break;

        case 'insert':
            // Voor INSERT queries - retourneert insertId
            $stmt = $pdo->prepare($query);
            $stmt->execute($params);
            $insertId = $pdo->lastInsertId();
            echo json_encode(['insertId' => $insertId, 'affectedRows' => $stmt->rowCount()]);
            break;

        case 'update':
        case 'delete':
            // Voor UPDATE/DELETE queries
            $stmt = $pdo->prepare($query);
            $stmt->execute($params);
            echo json_encode(['affectedRows' => $stmt->rowCount()]);
            break;

        default:
            http_response_code(400);
            echo json_encode(['error' => 'Unknown action']);
    }
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error', 'message' => $e->getMessage()]);
}

