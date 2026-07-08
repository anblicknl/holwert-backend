<?php
/**
 * Simple mail proxy for Holwert (Vercel -> shared hosting).
 *
 * Expected POST JSON:
 *  { "to": "x@y.nl", "subject": "...", "html": "<p>..</p>", "from": "Name <noreply@domain>"? }
 *
 * Auth header:
 *  X-API-Key: same value as Vercel env PHP_PROXY_API_KEY
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed', 'message' => 'Alleen POST toegestaan']);
    exit;
}

$apiKey = getenv('PHP_PROXY_API_KEY');
if (!$apiKey) {
    $apiKey = 'holwert-db-proxy-2026-secure-key-change-in-production';
}
$incomingKey = isset($_SERVER['HTTP_X_API_KEY']) ? trim($_SERVER['HTTP_X_API_KEY']) : '';
if ($incomingKey === '' || $incomingKey !== $apiKey) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Forbidden', 'message' => 'Ongeldige of ontbrekende X-API-Key']);
    exit;
}

$raw = file_get_contents('php://input');
$input = json_decode($raw, true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Bad request', 'message' => 'JSON body verplicht']);
    exit;
}

$to = isset($input['to']) ? trim((string)$input['to']) : '';
$subject = isset($input['subject']) ? trim((string)$input['subject']) : '';
$html = isset($input['html']) ? (string)$input['html'] : '';
$from = isset($input['from']) ? trim((string)$input['from']) : '';

if ($to === '' || $subject === '' || $html === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Bad request', 'message' => 'to, subject en html zijn verplicht']);
    exit;
}
if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Bad request', 'message' => 'Ongeldig e-mailadres']);
    exit;
}

// Default From: use current host (to reduce SPF/DMARC issues on shared hosting)
if ($from === '') {
    $host = isset($_SERVER['HTTP_HOST']) ? preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST']) : 'holwert.appenvloed.com';
    $from = 'Holwert <noreply@' . $host . '>';
}

$headers = [];
$headers[] = 'MIME-Version: 1.0';
$headers[] = 'Content-Type: text/html; charset=UTF-8';
$headers[] = 'From: ' . $from;
$headers[] = 'Reply-To: ' . $from;
$headers[] = 'X-Mailer: Holwert mail-proxy';

$ok = @mail($to, $subject, $html, implode("\r\n", $headers));
if (!$ok) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Send failed', 'message' => 'mail() gaf false terug']);
    exit;
}

echo json_encode(['ok' => true]);

