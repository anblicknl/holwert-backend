<?php
/**
 * Database-proxy voor Holwert-backend (Vercel → MySQL).
 * Staat in holwert-admin-upload; upload deze map via FTP naar je server (bijv. …/admin/).
 *
 * Verwachte POST (JSON): { "action": "execute"|"insert"|"update"|"delete", "query": "...", "params": [] }
 * Header: X-API-Key: (zelfde waarde als Vercel env PHP_PROXY_API_KEY)
 */

// Fallback als de server geen env vars voor PHP zet (zelfde key als admin-panel en Vercel)
if (!defined('DB_PROXY_API_KEY')) {
    define('DB_PROXY_API_KEY', getenv('DB_PROXY_API_KEY') ?: getenv('PHP_PROXY_API_KEY') ?: 'holwert-db-proxy-2026-secure-key-change-in-production');
}

// DB: env vars > credentials-bestand > fallback uit oorspronkelijke proxy (commit 0508d6f)
if (is_file(__DIR__ . '/db-proxy-credentials.php')) {
    require __DIR__ . '/db-proxy-credentials.php';
}
$hasDbFromEnvOrFile = getenv('DB_PROXY_USER') || getenv('DB_USER') || (defined('DB_PROXY_USER') && DB_PROXY_USER !== '');
if (!$hasDbFromEnvOrFile) {
    if (!defined('DB_PROXY_HOST')) define('DB_PROXY_HOST', 'localhost');
    if (!defined('DB_PROXY_PORT')) define('DB_PROXY_PORT', 3306);
    if (!defined('DB_PROXY_USER')) define('DB_PROXY_USER', 'db_holwert');
    if (!defined('DB_PROXY_PASS')) define('DB_PROXY_PASS', 'h0lwert.2026');
    if (!defined('DB_PROXY_NAME')) define('DB_PROXY_NAME', 'appenvlo_holwert');
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// GET ?check=1: toon versie zodat je kunt controleren of het juiste bestand op de server staat
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['check'])) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'proxy' => 'db-proxy',
        'version' => '2026-02-26-v2',
        'tables' => ['bookmarks', 'push_notification_mutes', 'follows', 'push_tokens', 'users', 'organizations', 'news', 'events', 'content_pages', 'practical_info'],
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed', 'message' => 'Alleen POST toegestaan']);
    exit;
}

$raw = file_get_contents('php://input');
$input = json_decode($raw, true);
if (!$input || !isset($input['query'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Bad request', 'message' => 'JSON met query en params verplicht']);
    exit;
}

$apiKey = defined('DB_PROXY_API_KEY') ? DB_PROXY_API_KEY : '';
$incomingKey = isset($_SERVER['HTTP_X_API_KEY']) ? trim($_SERVER['HTTP_X_API_KEY']) : '';
if ($apiKey === '' || $incomingKey !== $apiKey) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden', 'message' => 'Ongeldige of ontbrekende X-API-Key']);
    exit;
}

// Whitelist tabellen die de backend mag gebruiken (Vercel heeft geen directe MySQL)
$allowedTables = [
    'bookmarks',
    'push_notification_mutes',
    'follows',
    'push_tokens',
    'users',
    'organizations',
    'news',
    'events',
    'content_pages',
    'practical_info',
    'afvalkalender_config',
];

$query = $input['query'];
$params = isset($input['params']) && is_array($input['params']) ? $input['params'] : [];
$action = isset($input['action']) ? strtolower($input['action']) : 'execute';

// Haal tabelnamen uit de query (eenvoudige detectie)
$tables = [];
if (preg_match_all('/\bFROM\s+([a-z_][a-z0-9_]*)/i', $query, $m)) {
    foreach ($m[1] as $t) { $tables[$t] = true; }
}
if (preg_match_all('/\bJOIN\s+([a-z_][a-z0-9_]*)/i', $query, $m)) {
    foreach ($m[1] as $t) { $tables[$t] = true; }
}
if (preg_match_all('/\bINTO\s+([a-z_][a-z0-9_]*)/i', $query, $m)) {
    foreach ($m[1] as $t) { $tables[$t] = true; }
}
// Alleen "UPDATE table SET", niet "UPDATE col = val" (bv. ON DUPLICATE KEY UPDATE user_id = user_id)
if (preg_match_all('/\bUPDATE\s+([a-z_][a-z0-9_]*)\s+SET/i', $query, $m)) {
    foreach ($m[1] as $t) { $tables[$t] = true; }
}
if (preg_match_all('/\bDELETE\s+FROM\s+([a-z_][a-z0-9_]*)/i', $query, $m)) {
    foreach ($m[1] as $t) { $tables[$t] = true; }
}
if (preg_match_all('/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/i', $query, $m)) {
    foreach ($m[1] as $t) { $tables[$t] = true; }
}

$rejected = [];
foreach (array_keys($tables) as $table) {
    if (!in_array($table, $allowedTables, true)) {
        $rejected[] = $table;
    }
}
if (count($rejected) > 0) {
    http_response_code(403);
    echo json_encode([
        'error' => 'Forbidden - Query references disallowed table(s)',
        'message' => 'Forbidden - Tabel(s) niet toegestaan: ' . implode(', ', $rejected),
    ]);
    exit;
}

if (!extension_loaded('mysqli')) {
    http_response_code(500);
    echo json_encode(['error' => 'Server error', 'message' => 'mysqli niet beschikbaar']);
    exit;
}

$dbHost = getenv('DB_PROXY_HOST') ?: getenv('DB_HOST') ?: (defined('DB_PROXY_HOST') ? DB_PROXY_HOST : 'localhost');
$dbUser = getenv('DB_PROXY_USER') ?: getenv('DB_USER') ?: (defined('DB_PROXY_USER') ? DB_PROXY_USER : '');
$dbPass = getenv('DB_PROXY_PASS') ?: getenv('DB_PASSWORD') ?: (defined('DB_PROXY_PASS') ? DB_PROXY_PASS : '');
$dbName = getenv('DB_PROXY_NAME') ?: getenv('DB_NAME') ?: (defined('DB_PROXY_NAME') ? DB_PROXY_NAME : '');
$dbPort = (int) (getenv('DB_PROXY_PORT') ?: getenv('DB_PORT') ?: (defined('DB_PROXY_PORT') ? DB_PROXY_PORT : 3306));

if ($dbUser === '' || $dbName === '') {
    http_response_code(500);
    echo json_encode(['error' => 'Server config', 'message' => 'DB-gegevens ontbreken. Maak db-proxy-credentials.php van db-proxy-credentials.sample.php, vul user/pass/name in, upload naast db-proxy.php. Of zet env vars op de server.']);
    exit;
}

$mysqli = @new mysqli($dbHost, $dbUser, $dbPass, $dbName, $dbPort);
if ($mysqli->connect_error) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed', 'message' => $mysqli->connect_error]);
    exit;
}
$mysqli->set_charset('utf8mb4');

$stmt = $mysqli->prepare($query);
if (!$stmt) {
    $mysqli->close();
    http_response_code(500);
    echo json_encode(['error' => 'Query prepare failed', 'message' => $mysqli->error]);
    exit;
}

if (count($params) > 0) {
    $types = '';
    foreach ($params as $p) {
        if (is_int($p)) {
            $types .= 'i';
        } elseif (is_float($p)) {
            $types .= 'd';
        } else {
            $types .= 's';
        }
    }
    $stmt->bind_param($types, ...$params);
}

$ok = $stmt->execute();
if (!$ok) {
    $stmt->close();
    $mysqli->close();
    http_response_code(500);
    echo json_encode(['error' => 'Query failed', 'message' => $stmt->error]);
    exit;
}

if ($action === 'insert') {
    $insertId = (int) $mysqli->insert_id;
    $affectedRows = (int) $mysqli->affected_rows;
    $stmt->close();
    $mysqli->close();
    echo json_encode(['insertId' => $insertId ?: null, 'affectedRows' => $affectedRows]);
    exit;
}

if ($action === 'update' || $action === 'delete') {
    $affectedRows = (int) $mysqli->affected_rows;
    $stmt->close();
    $mysqli->close();
    echo json_encode(['affectedRows' => $affectedRows]);
    exit;
}

$res = $stmt->get_result();
$rows = [];
if ($res) {
    while ($row = $res->fetch_assoc()) {
        $rows[] = $row;
    }
    $res->free();
}
$stmt->close();
$mysqli->close();

echo json_encode(['rows' => $rows, 'rowCount' => count($rows)]);
