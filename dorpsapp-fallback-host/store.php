<?php
/**
 * Dorpsapp publieke fallback-store (Antagonist / holwert.frl).
 *
 * GET  ?tenant=…&key=…     → JSON envelope (ook zonder secret)
 * POST JSON + X-Fallback-Secret → schrijf snapshot
 *
 * Upload deze map naar bijv. https://holwert.frl/dorpsapp-fallback/
 * Zet FALLBACK_STORE_SECRET hieronder (zelfde als Vercel PUBLIC_FALLBACK_STORE_SECRET).
 */

declare(strict_types=1);

header('X-Content-Type-Options: nosniff');

const FALLBACK_STORE_SECRET = 'ZET-HIER-EEN-LANG-GEHEIM'; // zelfde waarde als in Vercel
const MAX_BODY_BYTES = 2_500_000; // ~2.5 MB

function json_out(int $status, array $payload): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=60');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function safe_segment(string $s): string {
    $s = strtolower(trim($s));
    $s = preg_replace('/[^a-z0-9_\/-]/', '_', $s) ?? '';
    $s = preg_replace('/\/+/', '/', $s) ?? '';
    return trim($s, '/');
}

function data_path(string $tenant, string $key): string {
    $tenant = safe_segment($tenant);
    $key = safe_segment($key);
    if ($tenant === '' || $key === '') {
        json_out(400, ['ok' => false, 'error' => 'tenant/key verplicht']);
    }
    $dir = __DIR__ . '/data/' . $tenant;
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        json_out(500, ['ok' => false, 'error' => 'Kon data-map niet aanmaken']);
    }
    // nested keys: news/12 → news__12.json (platte bestanden)
    $file = str_replace('/', '__', $key) . '.json';
    return $dir . '/' . $file;
}

function public_file_exists(string $tenant, string $key): ?string {
    $path = data_path($tenant, $key);
    return is_file($path) ? $path : null;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Fallback-Secret');
    http_response_code(204);
    exit;
}

// Publiek lezen
if ($method === 'GET') {
    $tenant = safe_segment((string)($_GET['tenant'] ?? ''));
    $key = safe_segment((string)($_GET['key'] ?? ''));
    if ($tenant === '' || $key === '') {
        json_out(400, ['ok' => false, 'error' => 'tenant en key verplicht']);
    }
    $path = public_file_exists($tenant, $key);
    if (!$path) {
        json_out(404, ['ok' => false, 'error' => 'not_found']);
    }
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=60');
    readfile($path);
    exit;
}

// Schrijven alleen met secret
if ($method === 'POST') {
    $secret = $_SERVER['HTTP_X_FALLBACK_SECRET'] ?? '';
    if (!is_string($secret) || $secret === '' || !hash_equals(FALLBACK_STORE_SECRET, $secret)) {
        json_out(401, ['ok' => false, 'error' => 'unauthorized']);
    }
    if (FALLBACK_STORE_SECRET === 'ZET-HIER-EEN-LANG-GEHEIM') {
        json_out(500, ['ok' => false, 'error' => 'Pas FALLBACK_STORE_SECRET aan in store.php']);
    }

    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_BODY_BYTES) {
        json_out(413, ['ok' => false, 'error' => 'body_too_large']);
    }
    $input = json_decode($raw, true);
    if (!is_array($input) || ($input['action'] ?? '') !== 'put') {
        json_out(400, ['ok' => false, 'error' => 'action=put verplicht']);
    }
    $tenant = safe_segment((string)($input['tenant'] ?? ''));
    $key = safe_segment((string)($input['key'] ?? ''));
    $body = $input['body'] ?? null;
    if ($tenant === '' || $key === '' || !is_array($body)) {
        json_out(400, ['ok' => false, 'error' => 'tenant, key en body verplicht']);
    }
    if (!isset($body['data'], $body['lastUpdated'])) {
        json_out(400, ['ok' => false, 'error' => 'ongeldige envelope']);
    }

    $path = data_path($tenant, $key);
    $json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        json_out(500, ['ok' => false, 'error' => 'json_encode_failed']);
    }
    $tmp = $path . '.tmp';
    if (file_put_contents($tmp, $json, LOCK_EX) === false) {
        json_out(500, ['ok' => false, 'error' => 'write_failed']);
    }
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        json_out(500, ['ok' => false, 'error' => 'rename_failed']);
    }
    json_out(200, [
        'ok' => true,
        'tenant' => $tenant,
        'key' => $key,
        'bytes' => strlen($json),
    ]);
}

json_out(405, ['ok' => false, 'error' => 'method_not_allowed']);
