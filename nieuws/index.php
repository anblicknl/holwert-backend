<?php
/**
 * Publieke nieuws-deellink voor Facebook/WhatsApp (Open Graph).
 * FTP: upload deze map naar holwert.appenvloed.com/nieuws/
 *
 * URL: https://holwert.appenvloed.com/nieuws/44
 */

declare(strict_types=1);

function newsShareResolveId(): ?int
{
    if (isset($_GET['id']) && preg_match('/^\d+$/', (string) $_GET['id'])) {
        return (int) $_GET['id'];
    }
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    if (preg_match('#/nieuws/(\d+)/?$#', $path, $m)) {
        return (int) $m[1];
    }
    return null;
}

function newsShareEsc(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function newsShareStripHtml(string $html, int $maxLen = 200): string
{
    $text = html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />', '</p>'], ["\n", "\n", "\n", "\n\n"], $html)), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/\s+/u', ' ', trim($text)) ?: '';
    if ($maxLen > 0 && mb_strlen($text) > $maxLen) {
        $text = rtrim(mb_substr($text, 0, $maxLen - 1)) . '…';
    }
    return $text;
}

function newsShareRenderError(int $code, string $title, string $message): void
{
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>' . newsShareEsc($title) . '</title></head><body><h1>' . newsShareEsc($title) . '</h1><p>' . newsShareEsc($message) . '</p></body></html>';
    exit;
}

$id = newsShareResolveId();
if (!$id) {
    newsShareRenderError(400, 'Ongeldige link', 'Geen nieuwsbericht opgegeven.');
}

/** @return array<string, mixed>|null|false null=niet gevonden, false=fetch mislukt */
function newsShareLoadDbConfig(): ?array
{
    $credFile = __DIR__ . '/../admin/db-proxy-credentials.php';
    if (is_file($credFile)) {
        require $credFile;
    }
    $host = defined('DB_PROXY_HOST') ? DB_PROXY_HOST : (getenv('DB_PROXY_HOST') ?: getenv('DB_HOST') ?: 'localhost');
    $port = (int) (defined('DB_PROXY_PORT') ? DB_PROXY_PORT : (getenv('DB_PROXY_PORT') ?: 3306));
    $user = defined('DB_PROXY_USER') ? DB_PROXY_USER : (getenv('DB_PROXY_USER') ?: getenv('DB_USER') ?: '');
    $pass = defined('DB_PROXY_PASS') ? DB_PROXY_PASS : (getenv('DB_PROXY_PASS') ?: getenv('DB_PASS') ?: '');
    $name = defined('DB_PROXY_NAME') ? DB_PROXY_NAME : (getenv('DB_PROXY_NAME') ?: getenv('DB_NAME') ?: '');
    if ($user === '' || $name === '') {
        return null;
    }
    return compact('host', 'port', 'user', 'pass', 'name');
}

/** @return array<string, mixed>|null|false */
function newsShareFetchArticleFromDb(int $id)
{
    $cfg = newsShareLoadDbConfig();
    if (!$cfg) {
        return false;
    }
    mysqli_report(MYSQLI_REPORT_OFF);
    $db = @new mysqli($cfg['host'], $cfg['user'], $cfg['pass'], $cfg['name'], $cfg['port']);
    if ($db->connect_errno) {
        return false;
    }
    $db->set_charset('utf8mb4');
    $sql = "SELECT n.id, n.title, COALESCE(n.content, '') AS content, n.image_url,
                   COALESCE(n.published_at, n.created_at) AS published_at
            FROM news n
            WHERE n.id = ? AND n.is_published = 1
            LIMIT 1";
    $stmt = $db->prepare($sql);
    if (!$stmt) {
        $db->close();
        return false;
    }
    $stmt->bind_param('i', $id);
    if (!$stmt->execute()) {
        $stmt->close();
        $db->close();
        return false;
    }
    $result = $stmt->get_result();
    $row = $result ? $result->fetch_assoc() : null;
    $stmt->close();
    $db->close();
    if (!$row) {
        return null;
    }
    return $row;
}

/** @return array<string, mixed>|null|false */
function newsShareFetchArticleFromApi(int $id)
{
    $apiUrl = 'https://holwert-backend.vercel.app/api/news/' . $id;
    $raw = false;
    $httpCode = 0;

    if (function_exists('curl_init')) {
        $ch = curl_init($apiUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: HolwertNewsShare/1.2'],
        ]);
        $raw = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } elseif (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 12,
                'header' => "Accept: application/json\r\nUser-Agent: HolwertNewsShare/1.2\r\n",
            ],
        ]);
        $raw = @file_get_contents($apiUrl, false, $ctx);
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $httpCode = (int) $m[1];
        }
    }

    if ($raw === false) {
        return false;
    }
    if ($httpCode === 404) {
        return null;
    }
    if ($httpCode >= 400) {
        return false;
    }
    $data = json_decode((string) $raw, true);
    $article = is_array($data) ? ($data['article'] ?? null) : null;
    return is_array($article) ? $article : null;
}

/** @return array<string, mixed>|null|false */
function newsShareFetchArticle(int $id)
{
    $fromDb = newsShareFetchArticleFromDb($id);
    if ($fromDb !== false) {
        return $fromDb;
    }
    return newsShareFetchArticleFromApi($id);
}

$article = newsShareFetchArticle($id);
if ($article === false) {
    newsShareRenderError(502, 'Tijdelijk niet beschikbaar', 'Het bericht kon nu niet worden geladen. Probeer het later opnieuw.');
}
if ($article === null || !is_array($article)) {
    newsShareRenderError(404, 'Bericht niet gevonden', 'Dit nieuwsbericht bestaat niet (meer) of is niet gepubliceerd.');
}

$title = trim((string) ($article['title'] ?? '')) ?: 'Nieuws uit Holwert';
$content = (string) ($article['content'] ?? '');
$description = newsShareStripHtml($content, 200) ?: 'Nieuws uit Holwert.';
$image = trim((string) ($article['image_url'] ?? ''));
$publishedAt = $article['published_at'] ?? null;
$host = $_SERVER['HTTP_HOST'] ?? 'holwert.appenvloed.com';
$canonicalUrl = 'https://' . $host . '/nieuws/' . $id;
$appDeepLink = 'holwert://news/' . $id;
$appLinkUrl = 'https://' . $host . '/app-link/?t=news&id=' . $id;
$androidStoreUrl = 'https://play.google.com/store/apps/details?id=com.appenvloed.holwert';

$dateLabel = '';
if ($publishedAt) {
    try {
        $dt = new DateTime($publishedAt);
        $dateLabel = $dt->format('j F Y');
    } catch (Exception $e) {
        $dateLabel = '';
    }
}

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <title><?= newsShareEsc($title) ?></title>
  <meta name="description" content="<?= newsShareEsc($description) ?>" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Holwert Dorpsapp" />
  <meta property="og:title" content="<?= newsShareEsc($title) ?>" />
  <meta property="og:description" content="<?= newsShareEsc($description) ?>" />
  <meta property="og:url" content="<?= newsShareEsc($canonicalUrl) ?>" />
  <?php if ($image !== ''): ?>
  <meta property="og:image" content="<?= newsShareEsc($image) ?>" />
  <?php endif; ?>
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="<?= newsShareEsc($title) ?>" />
  <meta name="twitter:description" content="<?= newsShareEsc($description) ?>" />
  <?php if ($image !== ''): ?>
  <meta name="twitter:image" content="<?= newsShareEsc($image) ?>" />
  <?php endif; ?>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; background: #f5f5f5; color: #222; }
    .card { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
    h1 { font-size: 26px; margin-bottom: 12px; }
    .meta { font-size: 14px; color: #666; margin-bottom: 16px; }
    img { max-width: 100%; border-radius: 12px; margin-bottom: 16px; }
    .content { font-size: 16px; line-height: 1.6; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #2563EB; color: #fff; font-size: 12px; margin-bottom: 12px; }
    .store-hint { margin-top: 24px; font-size: 14px; color: #555; }
    .store-buttons { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 16px; border-radius: 999px; font-size: 14px; text-decoration: none; border: none; cursor: pointer; }
    .btn-primary { background: #2563EB; color: #fff; }
    .btn-outline { background: #fff; color: #2563EB; border: 1px solid #2563EB; }
  </style>
</head>
<body>
  <main class="card">
    <div class="badge">Holwert Dorpsapp</div>
    <h1><?= newsShareEsc($title) ?></h1>
    <?php if ($dateLabel !== ''): ?>
    <div class="meta"><?= newsShareEsc($dateLabel) ?></div>
    <?php endif; ?>
    <?php if ($image !== ''): ?>
    <img src="<?= newsShareEsc($image) ?>" alt="<?= newsShareEsc($title) ?>" />
    <?php endif; ?>
    <div class="content"><?= $content ?></div>
    <div class="store-hint">
      <p>Dit bericht staat in de Holwert Dorpsapp.</p>
      <div class="store-buttons">
        <a class="btn btn-primary" href="<?= newsShareEsc($appLinkUrl) ?>">Open in de app</a>
        <a class="btn btn-outline" href="<?= newsShareEsc($androidStoreUrl) ?>" target="_blank" rel="noopener">Google Play</a>
      </div>
    </div>
  </main>
  <script>
    (function () {
      var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        setTimeout(function () {
          if (!document.hidden) window.location.href = <?= json_encode($appDeepLink) ?>;
        }, 400);
      }
    })();
  </script>
</body>
</html>
