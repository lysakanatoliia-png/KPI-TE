<?php
// proxy2.php — зберігає локально (без прямої відправки в GAS)
// Uses file locking to prevent race conditions on concurrent writes

require_once __DIR__ . '/config.php';

// ===== Helper для унікального ID =====
function generateEntryId(): string {
    try {
        return bin2hex(random_bytes(16));
    } catch (Exception $e) {
        return uniqid("e_", true);
    }
}

// ===== Auth check =====
function checkAuth(): bool {
    $token = KPI_AUTH_TOKEN;
    if ($token === '') return true; // auth disabled
    $provided = $_GET['token'] ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    return hash_equals($token, $provided);
}

// ===== CORS =====
header('Access-Control-Allow-Origin: ' . KPI_CORS_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

// Auth
if (!checkAuth()) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
    exit;
}

// 1. Читаємо action з GET
$action = $_GET['fn'] ?? null;

// 2. Читаємо payload з POST-тіла
$raw = file_get_contents('php://input');
$payload = $raw ? json_decode($raw, true) : null;

// Якщо payload порожній — стоп
if (!$action || !$payload) {
    echo json_encode(['ok' => false, 'error' => 'Missing action or payload']);
    exit;
}

// 3. Додаємо entryId у payload, якщо його ще нема
if (!isset($payload['entryId'])) {
    $payload['entryId'] = generateEntryId();
}

// 4. Atomic read-modify-write with file locking
$storeFile = KPI_STORE_FILE;
$fp = fopen($storeFile, 'c+');
if (!$fp) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Cannot open store file']);
    exit;
}

if (!flock($fp, LOCK_EX)) {
    fclose($fp);
    http_response_code(503);
    echo json_encode(['ok' => false, 'error' => 'Cannot acquire lock']);
    exit;
}

// Read current data
$contents = '';
while (!feof($fp)) {
    $contents .= fread($fp, 8192);
}
$data = $contents ? json_decode($contents, true) : [];
if (!isset($data['pending'])) $data['pending'] = [];

// 5. Додаємо подію
$data['pending'][] = [
    'fn'      => $action,
    'payload' => $payload,
    'ts'      => gmdate('c'),
    'sent'    => false,
    'retries' => 0
];

// 6. Записуємо назад у файл (truncate + write)
ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

// 7. Відповідь фронту
echo json_encode([
    'ok' => true,
    'stored' => $action,
    'entryId' => $payload['entryId'],
    'pendingCount' => count($data['pending'])
]);
