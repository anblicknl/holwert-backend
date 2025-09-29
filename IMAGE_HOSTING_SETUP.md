# 🖼️ Image Hosting Setup

## Overzicht

De backend kan afbeeldingen op twee manieren hosten:

1. **Lokaal** (Railway) - Alle bestanden op Railway
2. **Extern** (holwert.appenvloed.com) - API op Railway, bestanden op jouw server

## 🎯 Aanbevolen Setup: Externe Hosting

### Voordelen:
- ✅ **Kosten efficiënt** - Railway alleen voor API
- ✅ **Betere performance** - CDN mogelijk op eigen server
- ✅ **Meer controle** - Over bestanden en storage
- ✅ **Geen vertraging** - Moderne browsers downloaden parallel

### Performance:
- **Geen merkbare vertraging** - Afbeeldingen worden parallel geladen
- **Betere caching** - Eigen server kan agressiever cachen
- **CDN mogelijk** - Later uit te breiden met CloudFlare etc.

## 🚀 Setup Instructies

### 1. Railway Backend
```bash
# Environment variables in Railway:
EXTERNAL_IMAGE_HOSTING=true
IMAGE_HOST_URL=https://holwert.appenvloed.com
IMAGE_UPLOAD_ENDPOINT=/api/upload
IMAGE_HOST_API_KEY=your-secure-api-key
```

### 2. holwert.appenvloed.com Server
Je moet een upload endpoint maken op jouw server:

```php
// /api/upload endpoint
<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Authorization, Content-Type');

// Verify API key
$apiKey = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!verifyApiKey($apiKey)) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// Handle file upload
if ($_FILES['image']) {
    $file = $_FILES['image'];
    $type = $_POST['type'] ?? 'general';
    $filename = $_POST['filename'] ?? $file['name'];
    
    // Create directory structure
    $uploadDir = "uploads/{$type}s/";
    if (!is_dir($uploadDir)) {
        mkdir($uploadDir, 0755, true);
    }
    
    // Move uploaded file
    $targetPath = $uploadDir . $filename;
    if (move_uploaded_file($file['tmp_name'], $targetPath)) {
        echo json_encode([
            'success' => true,
            'url' => "https://holwert.appenvloed.com/{$targetPath}",
            'filename' => $filename
        ]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Upload failed']);
    }
}
?>
```

### 3. Directory Structuur
```
holwert.appenvloed.com/
├── uploads/
│   ├── profiles/
│   ├── news/
│   ├── events/
│   └── organizations/
└── api/
    └── upload.php
```

## 🔧 Configuratie

### Railway Environment Variables:
```bash
EXTERNAL_IMAGE_HOSTING=true
IMAGE_HOST_URL=https://holwert.appenvloed.com
IMAGE_UPLOAD_ENDPOINT=/api/upload
IMAGE_HOST_API_KEY=your-secure-api-key-here
```

### Lokale Development:
```bash
EXTERNAL_IMAGE_HOSTING=false
# Images worden lokaal opgeslagen
```

## 📱 Frontend Impact

De frontend hoeft **niets** te veranderen! De backend retourneert gewoon de juiste URLs:

```javascript
// Backend retourneert:
{
  "image": {
    "url": "https://holwert.appenvloed.com/uploads/profiles/user_123_large.jpg",
    "thumbnail": "https://holwert.appenvloed.com/uploads/profiles/user_123_thumbnail.jpg"
  }
}
```

## 🚀 Deployment Stappen

1. **Railway backend** deployen met externe hosting enabled
2. **Upload endpoint** maken op holwert.appenvloed.com
3. **API key** instellen en testen
4. **Frontend** testen tegen live backend

## 💡 Tips

- **API key** moet sterk zijn (minimaal 32 karakters)
- **HTTPS** is verplicht voor productie
- **File size limits** instellen op jouw server
- **Backup strategy** voor afbeeldingen
- **CDN** later toevoegen voor betere performance

## 🔍 Testing

```bash
# Test upload endpoint
curl -X POST https://holwert.appenvloed.com/api/upload \
  -H "Authorization: Bearer your-api-key" \
  -F "image=@test.jpg" \
  -F "type=profile" \
  -F "filename=test.jpg"
```

## 📊 Performance Monitoring

- **Upload times** monitoren
- **File sizes** tracken
- **Error rates** bijhouden
- **Storage usage** controleren
