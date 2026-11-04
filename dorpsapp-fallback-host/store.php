<?php
/**
 * Dorpsapp publieke fallback-store (Antagonist / holwert.frl).
 *
 * GET  ?tenant=&key=           → JSON snapshot
 * GET  ?tenant=&key=media/…&raw=1 → afbeelding/PDF
 * POST JSON + X-Fallback-Secret, action=put → snapshot
 * POST binary + headers put-media → mediabestand
 *
 * Zet FALLBACK_STORE_SECRET gelijk aan Vercel FALLBACK_STORE_SECRET.
 */

declare(strict_types=1);

header('X-Content-Type-Options: nosniff');

const FALLBACK_STORE_SECRET = 'ZET-HIER-EEN-LANG-GEHEIM'; // zelfde als Vercel FALLBACK_STORE_SECRET
const MAX_JSON_BYTES = 2_500_000;
const MAX_MEDIA_BYTES = 2_000_000;

function json_out(int $status, array $payload): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=60');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function safe_segment(string $s): string {
    $s = strtolower(trim($s));
    $s = preg_replace('/[^a-z0-9_\/.-]/', '_', $s) ?? '';
    $s = preg_replace('/\/+/', '/', $s) ?? '';
    return trim($s, '/');
}

function is_media_key(string $key): bool {
    return str_starts_with($key, 'media/');
}

function media_filename(string $key): ?string {
    // media/abcdef0123456789.jpg
    $base = basename(substr($key, strlen('media/')));
    if (!preg_match('/^[a-f0-9]{16,64}\.(jpe?g|png|webp|gif|pdf)$/i', $base)) {
        return null;
    }
    return strtolower($base);
}

function content_type_for_file(string $path): string {
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    return match ($ext) {
        'jpg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp',
        'gif' => 'image/gif',
        'pdf' => 'application/pdf',
        'json' => 'application/json; charset=utf-8',
        default => 'application/octet-stream',
    };
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

    if (is_media_key($key)) {
        $name = media_filename($key);
        if ($name === null) {
            json_out(400, ['ok' => false, 'error' => 'ongeldige media-key']);
        }
        $mediaDir = $dir . '/media';
        if (!is_dir($mediaDir) && !mkdir($mediaDir, 0755, true) && !is_dir($mediaDir)) {
            json_out(500, ['ok' => false, 'error' => 'Kon media-map niet aanmaken']);
        }
        return $mediaDir . '/' . $name;
    }

    $file = str_replace('/', '__', $key) . '.json';
    return $dir . '/' . $file;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Fallback-Secret, X-Fallback-Action, X-Fallback-Tenant, X-Fallback-Media-Key');
    http_response_code(204);
    exit;
}

if ($method === 'GET') {
    $tenant = safe_segment((string)($_GET['tenant'] ?? ''));
    $key = safe_segment((string)($_GET['key'] ?? ''));
    $raw = isset($_GET['raw']) && (string)$_GET['raw'] !== '0';
    if ($tenant === '' || $key === '') {
        json_out(400, ['ok' => false, 'error' => 'tenant en key verplicht']);
    }
    $path = data_path($tenant, $key);
    if (!is_file($path)) {
        json_out(404, ['ok' => false, 'error' => 'not_found']);
    }
    if ($raw || is_media_key($key)) {
        header('Content-Type: ' . content_type_for_file($path));
        header('Cache-Control: public, max-age=86400');
        header('Content-Length: ' . (string)filesize($path));
        readfile($path);
        exit;
    }
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=60');
    readfile($path);
    exit;
}

if ($method === 'POST') {
    $secret = $_SERVER['HTTP_X_FALLBACK_SECRET'] ?? '';
    if (!is_string($secret) || $secret === '' || !hash_equals(FALLBACK_STORE_SECRET, $secret)) {
        json_out(401, ['ok' => false, 'error' => 'unauthorized']);
    }
    if (FALLBACK_STORE_SECRET === 'ZET-HIER-EEN-LANG-GEHEIM') {
        json_out(500, ['ok' => false, 'error' => 'Pas FALLBACK_STORE_SECRET aan in store.php']);
    }

    $headerAction = (string) ($_SERVER['HTTP_X_FALLBACK_ACTION'] ?? '');

    // Binary media upload
    if ($headerAction === 'put-media') {
        $tenant = safe_segment((string) ($_SERVER['HTTP_X_FALLBACK_TENANT'] ?? ''));
        $mediaKey = safe_segment((string) ($_SERVER['HTTP_X_FALLBACK_MEDIA_KEY'] ?? ''));
        if ($tenant === '' || !is_media_key($mediaKey) || media_filename($mediaKey) === null) {
            json_out(400, ['ok' => false, 'error' => 'tenant/media-key verplicht']);
        }
        $raw = file_get_contents('php://input', false, null, 0, MAX_MEDIA_BYTES + 1);
        if ($raw === false || $raw === '' || strlen($raw) > MAX_MEDIA_BYTES) {
            json_out(413, ['ok' => false, 'error' => 'media_too_large']);
        }
        $path = data_path($tenant, $mediaKey);
        $tmp = $path . '.tmp';
        if (file_put_contents($tmp, $raw, LOCK_EX) === false) {
            json_out(500, ['ok' => false, 'error' => 'write_failed']);
        }
        if (!rename($tmp, $path)) {
            @unlink($tmp);
            json_out(500, ['ok' => false, 'error' => 'rename_failed']);
        }
        json_out(200, [
            'ok' => true,
            'tenant' => $tenant,
            'key' => $mediaKey,
            'bytes' => strlen($raw),
        ]);
    }

    // JSON actions: put | list-store | delete-media
    $raw = file_get_contents('php://input', false, null, 0, MAX_JSON_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_JSON_BYTES) {
        json_out(413, ['ok' => false, 'error' => 'body_too_large']);
    }
    $input = json_decode($raw, true);
    if (!is_array($input) || !isset($input['action'])) {
        json_out(400, ['ok' => false, 'error' => 'JSON action verplicht']);
    }
    $jsonAction = (string) $input['action'];
    $tenant = safe_segment((string) ($input['tenant'] ?? ''));
    if ($tenant === '') {
        json_out(400, ['ok' => false, 'error' => 'tenant verplicht']);
    }
    $tenantDir = __DIR__ . '/data/' . $tenant;

    if ($jsonAction === 'list-store') {
        $snapshots = [];
        $media = [];
        if (is_dir($tenantDir)) {
            foreach (scandir($tenantDir) ?: [] as $f) {
                if ($f === '.' || $f === '..' || $f === 'media') continue;
                $path = $tenantDir . '/' . $f;
                if (!is_file($path) || !str_ends_with(strtolower($f), '.json')) continue;
                $key = str_replace('__', '/', substr($f, 0, -5));
                $snapshots[] = [
                    'key' => $key,
                    'file' => $f,
                    'bytes' => filesize($path) ?: 0,
                    'mtime' => filemtime($path) ?: 0,
                ];
            }
            $mediaDir = $tenantDir . '/media';
            if (is_dir($mediaDir)) {
                foreach (scandir($mediaDir) ?: [] as $f) {
                    if ($f === '.' || $f === '..') continue;
                    if (!preg_match('/^[a-f0-9]{16,64}\.(jpe?g|png|webp|gif|pdf)$/i', $f)) continue;
                    $path = $mediaDir . '/' . $f;
                    if (!is_file($path)) continue;
                    $media[] = [
                        'name' => strtolower($f),
                        'bytes' => filesize($path) ?: 0,
                        'mtime' => filemtime($path) ?: 0,
                    ];
                }
            }
        }
        json_out(200, [
            'ok' => true,
            'tenant' => $tenant,
            'snapshots' => $snapshots,
            'media' => $media,
            'snapshotCount' => count($snapshots),
            'mediaCount' => count($media),
        ]);
    }

    if ($jsonAction === 'delete-media') {
        $files = $input['files'] ?? [];
        if (!is_array($files)) {
            json_out(400, ['ok' => false, 'error' => 'files[] verplicht']);
        }
        $mediaDir = $tenantDir . '/media';
        $deleted = [];
        $failed = [];
        $missing = [];
        foreach (array_slice($files, 0, 200) as $name) {
            $name = strtolower(basename((string) $name));
            if (!preg_match('/^[a-f0-9]{16,64}\.(jpe?g|png|webp|gif|pdf)$/i', $name)) {
                $failed[] = ['name' => $name, 'error' => 'ongeldige naam'];
                continue;
            }
            $path = $mediaDir . '/' . $name;
            if (!is_file($path)) {
                $missing[] = $name;
                continue;
            }
            if (@unlink($path)) {
                $deleted[] = $name;
            } else {
                $failed[] = ['name' => $name, 'error' => 'unlink_failed'];
            }
        }
        json_out(200, [
            'ok' => true,
            'tenant' => $tenant,
            'deleted' => $deleted,
            'missing' => $missing,
            'failed' => $failed,
        ]);
    }

    if ($jsonAction !== 'put') {
        json_out(400, ['ok' => false, 'error' => 'onbekende action']);
    }

    $key = safe_segment((string) ($input['key'] ?? ''));
    $body = $input['body'] ?? null;
    if ($key === '' || !is_array($body)) {
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
