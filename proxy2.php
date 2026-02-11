<?php
// proxy1.php — зберігає локально (без прямої відправки в GAS)

const STORE_FILE = __DIR__ . '/store.json';

// ===== Helper для унікального ID =====
function generateEntryId(): string {
    try {
        return bin2hex(random_bytes(16)); // 32 символи, криптостійкий
    } catch (Exception $e) {
        return uniqid("e_", true); // fallback
    }
}

// 1. Читаємо action з GET
$action = $_GET['fn'] ?? null;

// 2. Читаємо payload з POST-тіла (це вже готовий JSON без обгортки)
$raw = file_get_contents('php://input');
$payload = $raw ? json_decode($raw, true) : null;

// Якщо payload порожній — стоп
if (!$action || !$payload) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Missing action or payload']);
    exit;
}

// 3. Додаємо entryId у payload, якщо його ще нема
if (!isset($payload['entryId'])) {
    $payload['entryId'] = generateEntryId();
}

// 4. Готуємо локальне сховище
$data = file_exists(STORE_FILE) ? json_decode(file_get_contents(STORE_FILE), true) : [];
if (!isset($data['pending'])) $data['pending'] = [];

// 5. Додаємо подію
$data['pending'][] = [
    'fn'      => $action,
    'payload' => $payload,
    'ts'      => gmdate('c'),
    'sent'    => false
];

// 6. Записуємо назад у файл
file_put_contents(STORE_FILE, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

// 7. Відповідь фронту
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok' => true,
    'stored' => $action,
    'entryId' => $payload['entryId'],
    'pendingCount' => count($data['pending'])
]);
