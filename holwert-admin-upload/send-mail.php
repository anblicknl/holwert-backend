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
// Vang PHP-fatale fouten op en geef ze terug als JSON i.p.v. lege 500
ob_start();
error_reporting(E_ALL);
ini_set('display_errors', '0');
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        ob_end_clean();
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode([
            'ok' => false,
            'error' => 'PHP fatal error',
            'message' => $err['message'] . ' in ' . $err['file'] . ':' . $err['line'],
        ]);
    } else {
        ob_end_flush();
    }
});

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
// GET ?check=1: debug (geen secrets tonen)
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['check'])) {
    $smtpHost = getenv('SMTP_HOST') ?: '';
    $smtpPort = (int)(getenv('SMTP_PORT') ?: 0);
    $smtpUser = getenv('SMTP_USER') ?: '';
    $smtpFrom = getenv('SMTP_FROM') ?: '';
    $hasCredFile = is_file(__DIR__ . '/send-mail-credentials.php');
    if ($hasCredFile) {
        require __DIR__ . '/send-mail-credentials.php';
        if (defined('SMTP_HOST') && $smtpHost === '') $smtpHost = SMTP_HOST;
        if (defined('SMTP_PORT') && $smtpPort === 0) $smtpPort = (int)SMTP_PORT;
        if (defined('SMTP_USER') && $smtpUser === '') $smtpUser = SMTP_USER;
        if (defined('SMTP_FROM') && $smtpFrom === '') $smtpFrom = SMTP_FROM;
    }
    $mask = function ($s) {
        $s = (string)($s ?? '');
        if ($s === '') return '';
        if (strlen($s) <= 6) return '***';
        return substr($s, 0, 3) . '***' . substr($s, -2);
    };
    echo json_encode([
        'proxy' => 'send-mail',
        'version' => '2026-07-08-v4',
        'has_credentials_file' => $hasCredFile,
        'smtp' => [
            'host' => $smtpHost,
            'port' => $smtpPort,
            'user' => $mask($smtpUser),
            'from' => $smtpFrom,
            'enabled' => $smtpHost !== '',
        ],
        'note' => 'Als enabled=false, wordt mail() fallback gebruikt (minder betrouwbaar).',
    ]);
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

$smtpHost = getenv('SMTP_HOST') ?: '';
$smtpPort = (int)(getenv('SMTP_PORT') ?: 0);
$smtpUser = getenv('SMTP_USER') ?: '';
$smtpPass = getenv('SMTP_PASS') ?: '';
$smtpFrom = getenv('SMTP_FROM') ?: '';

// Optioneel: credentials-bestand op de server (NIET in repo committen).
// Verwacht (voorbeeld zonder secrets):
//   <?php
//   define('SMTP_HOST', 'mail.hostingserver.nl');
//   define('SMTP_PORT', 465);
//   define('SMTP_USER', 'noreply@appenvloed.com');
//   define('SMTP_PASS', '...'); // alleen op server
//   define('SMTP_FROM', 'Holwert <noreply@appenvloed.com>');
if (is_file(__DIR__ . '/send-mail-credentials.php')) {
    require __DIR__ . '/send-mail-credentials.php';
    if (defined('SMTP_HOST') && $smtpHost === '') $smtpHost = SMTP_HOST;
    if (defined('SMTP_PORT') && $smtpPort === 0) $smtpPort = (int)SMTP_PORT;
    if (defined('SMTP_USER') && $smtpUser === '') $smtpUser = SMTP_USER;
    if (defined('SMTP_PASS') && $smtpPass === '') $smtpPass = SMTP_PASS;
    if (defined('SMTP_FROM') && $smtpFrom === '') $smtpFrom = SMTP_FROM;
}

// Default From: SMTP_FROM of host-domein
if ($from === '') {
    if ($smtpFrom !== '') {
        $from = $smtpFrom;
    } else {
        $host = isset($_SERVER['HTTP_HOST']) ? preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST']) : 'holwert.appenvloed.com';
        $from = 'Holwert <noreply@' . $host . '>';
    }
}

function smtpReadLine($fp) {
    $line = fgets($fp, 8192);
    return $line === false ? '' : $line;
}
function smtpReadResponse($fp) {
    $all = '';
    while (true) {
        $line = smtpReadLine($fp);
        if ($line === '') break;
        $all .= $line;
        // "250-" means more lines; "250 " ends.
        if (preg_match('/^\d{3} /', $line)) break;
    }
    return $all;
}
function smtpSend($fp, $cmd) {
    fwrite($fp, $cmd . "\r\n");
}
function smtpExpectCode($resp, $codes) {
    foreach ($codes as $c) {
        if (preg_match('/^' . preg_quote((string)$c, '/') . '/', $resp)) return true;
    }
    return false;
}

function smtpOpenSocket($host, $port, $timeout) {
    $errno = 0;
    $errstr = '';
    $addr = 'ssl://' . $host . ':' . $port;
    $context = stream_context_create([
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);
    if (function_exists('stream_socket_client')) {
        $fp = @stream_socket_client($addr, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $context);
        if ($fp !== false) {
            return $fp;
        }
    }
    if (function_exists('fsockopen')) {
        $fp = @fsockopen('ssl://' . $host, $port, $errno, $errstr, $timeout);
        if ($fp !== false) {
            return $fp;
        }
    }
    return null;
}

function sendViaSmtp($smtpHost, $smtpPort, $smtpUser, $smtpPass, $smtpFrom, $to, $fromHeader, $subject, $html) {
    $host = $smtpHost;
    $port = $smtpPort > 0 ? $smtpPort : 465;
    $timeout = 15;

    $fp = smtpOpenSocket($host, $port, $timeout);
    if (!$fp) {
        return ['ok' => false, 'message' => 'SMTP connect failed (stream_socket_client/fsockopen niet beschikbaar of geblokkeerd)'];
    }
    stream_set_timeout($fp, $timeout);

    $greet = smtpReadResponse($fp);
    if (!smtpExpectCode($greet, [220])) {
        fclose($fp);
        return ['ok' => false, 'message' => 'SMTP greet failed'];
    }

    $local = isset($_SERVER['HTTP_HOST']) ? preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST']) : 'localhost';
    smtpSend($fp, 'EHLO ' . $local);
    $ehlo = smtpReadResponse($fp);
    if (!smtpExpectCode($ehlo, [250])) {
        smtpSend($fp, 'HELO ' . $local);
        $helo = smtpReadResponse($fp);
        if (!smtpExpectCode($helo, [250])) {
            fclose($fp);
            return ['ok' => false, 'message' => 'SMTP EHLO/HELO failed'];
        }
    }

    // AUTH LOGIN
    if ($smtpUser !== '' && $smtpPass !== '') {
        smtpSend($fp, 'AUTH LOGIN');
        $r1 = smtpReadResponse($fp);
        if (!smtpExpectCode($r1, [334])) {
            fclose($fp);
            return ['ok' => false, 'message' => 'SMTP AUTH not accepted'];
        }
        smtpSend($fp, base64_encode($smtpUser));
        $r2 = smtpReadResponse($fp);
        if (!smtpExpectCode($r2, [334])) {
            fclose($fp);
            return ['ok' => false, 'message' => 'SMTP AUTH username rejected'];
        }
        smtpSend($fp, base64_encode($smtpPass));
        $r3 = smtpReadResponse($fp);
        if (!smtpExpectCode($r3, [235, 250])) {
            fclose($fp);
            return ['ok' => false, 'message' => 'SMTP AUTH failed'];
        }
    }

    $envelopeFrom = $smtpFrom !== '' ? $smtpFrom : $fromHeader;
    // Envelope sender: try to extract email between <>
    $mailFrom = $envelopeFrom;
    if (preg_match('/<([^>]+)>/', $envelopeFrom, $m)) $mailFrom = $m[1];

    smtpSend($fp, 'MAIL FROM:<' . $mailFrom . '>');
    $mfrom = smtpReadResponse($fp);
    if (!smtpExpectCode($mfrom, [250])) {
        fclose($fp);
        return ['ok' => false, 'message' => 'SMTP MAIL FROM failed'];
    }
    smtpSend($fp, 'RCPT TO:<' . $to . '>');
    $rcpt = smtpReadResponse($fp);
    if (!smtpExpectCode($rcpt, [250, 251])) {
        fclose($fp);
        return ['ok' => false, 'message' => 'SMTP RCPT TO failed'];
    }
    smtpSend($fp, 'DATA');
    $data = smtpReadResponse($fp);
    if (!smtpExpectCode($data, [354])) {
        fclose($fp);
        return ['ok' => false, 'message' => 'SMTP DATA failed'];
    }

    $headers = [];
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = 'Content-Type: text/html; charset=UTF-8';
    $headers[] = 'From: ' . $fromHeader;
    $headers[] = 'Reply-To: ' . $fromHeader;
    $headers[] = 'Subject: ' . $subject;
    $headers[] = 'To: <' . $to . '>';

    $msg = implode("\r\n", $headers) . "\r\n\r\n" . $html . "\r\n";
    // Dot-stuffing
    $msg = preg_replace("/\r\n\./", "\r\n..", $msg);
    fwrite($fp, $msg);
    smtpSend($fp, '.');
    $done = smtpReadResponse($fp);
    smtpSend($fp, 'QUIT');
    fclose($fp);

    if (!smtpExpectCode($done, [250])) {
        return ['ok' => false, 'message' => 'SMTP send failed'];
    }
    return ['ok' => true];
}

$headers = [];
$headers[] = 'MIME-Version: 1.0';
$headers[] = 'Content-Type: text/html; charset=UTF-8';
$headers[] = 'From: ' . $from;
$headers[] = 'Reply-To: ' . $from;
$headers[] = 'X-Mailer: Holwert mail-proxy';

// Prefer SMTP if configured, fallback to mail()
if ($smtpHost !== '') {
    $smtpResult = sendViaSmtp($smtpHost, $smtpPort, $smtpUser, $smtpPass, $smtpFrom, $to, $from, $subject, $html);
    if ($smtpResult['ok'] !== true) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'SMTP failed', 'message' => $smtpResult['message']]);
        exit;
    }
} else {
    // Use -f envelope sender if possible (helps deliverability)
    $envelope = '';
    if (preg_match('/<([^>]+)>/', $from, $m)) {
        $envelope = '-f' . $m[1];
    }
    $ok = $envelope !== ''
        ? @mail($to, $subject, $html, implode("\r\n", $headers), $envelope)
        : @mail($to, $subject, $html, implode("\r\n", $headers));
    if (!$ok) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Send failed', 'message' => 'mail() gaf false terug']);
        exit;
    }
}

echo json_encode(['ok' => true]);

