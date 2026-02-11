<?php
// sync.php — передає дані в GAS і чистить локальний store
const STORE_FILE = __DIR__ . '/store.json';
const GAS_URL    = 'https://script.google.com/macros/s/AKfycbwE9JbMNMJWGKHM1N8slPGwt3UZDm6bAFoF35GNCWJfkuQIuTHKy0p6aTqnz7UAm8Dlrw/exec';

function loadStore($path){
    if(!file_exists($path)) return ['pending'=>[]];
    $json = file_get_contents($path);
    return json_decode($json, true) ?: ['pending'=>[]];
}
function saveStore($path, $data){
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
}

$store   = loadStore(STORE_FILE);
$pending = $store['pending'] ?? [];

if(!$pending){
    echo "Nothing to send\n";
    exit;
}

// беремо максимум 100
$batch = array_slice($pending, 0, 100, true);

foreach($batch as $idx => $entry){
    $fn      = $entry['fn'];
    $payload = $entry['payload'];

    $body = json_encode(['action' => $fn, 'payload' => $payload]);
    $ch   = curl_init(GAS_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_TIMEOUT        => 15
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);

    $ok = false;
    if(!$err && $resp){
        $res = json_decode($resp, true);
        if(isset($res['ok']) && $res['ok'] === true){
            $ok = true;
            echo "[OK] {$fn} {$payload['batchId']}\n";
        }
    }

    // у будь-якому випадку прибираємо запис з pending
    unset($store['pending'][$idx]);

    if(!$ok){
        echo "[FAIL] {$fn} {$payload['batchId']}\n";
    }
}

// зберігаємо назад
$store['pending'] = array_values($store['pending']); // переіндексуємо
saveStore(STORE_FILE, $store);

echo "Sync done. Left: " . count($store['pending']) . "\n";
