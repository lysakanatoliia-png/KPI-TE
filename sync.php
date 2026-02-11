<?php
// sync.php — передає дані в GAS і чистить локальний store
// CRITICAL FIX: failed entries stay in queue for retry

require_once __DIR__ . '/config.php';

const STORE_FILE = KPI_STORE_FILE;

function loadStore($path){
    if(!file_exists($path)) return ['pending'=>[]];
    $json = file_get_contents($path);
    return json_decode($json, true) ?: ['pending'=>[]];
}
function saveStore($path, $data){
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES), LOCK_EX);
}

$store   = loadStore(STORE_FILE);
$pending = $store['pending'] ?? [];

if(!$pending){
    echo "Nothing to send\n";
    exit;
}

// беремо максимум 100
$batch = array_slice($pending, 0, 100, true);
$sentCount = 0;
$failCount = 0;
$maxRetries = 3; // max retries per entry within this sync cycle

foreach($batch as $idx => $entry){
    $fn      = $entry['fn'];
    $payload = $entry['payload'];
    $batchId = $payload['batchId'] ?? 'unknown';
    $retries = $entry['retries'] ?? 0;

    $body = json_encode(['action' => $fn, 'payload' => $payload]);
    $ch   = curl_init(KPI_GAS_UPLOAD_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $ok = false;
    if(!$err && $resp){
        $res = json_decode($resp, true);
        if(isset($res['ok']) && $res['ok'] === true){
            $ok = true;
        }
    }

    if($ok){
        // Success: remove from pending
        unset($store['pending'][$idx]);
        $sentCount++;
        echo "[OK] {$fn} {$batchId}\n";
    } else {
        // FAIL: keep in pending, increment retry counter
        $store['pending'][$idx]['retries'] = $retries + 1;
        $store['pending'][$idx]['lastError'] = $err ?: "HTTP {$httpCode}";
        $store['pending'][$idx]['lastAttempt'] = gmdate('c');
        $failCount++;

        $maxEntryRetries = KPI_MAX_ENTRY_RETRIES;
        if($retries + 1 >= $maxEntryRetries){
            // Move to dead-letter after too many retries
            if(!isset($store['dead_letter'])) $store['dead_letter'] = [];
            $store['dead_letter'][] = $store['pending'][$idx];
            unset($store['pending'][$idx]);
            echo "[DEAD] {$fn} {$batchId} (after {$maxEntryRetries} retries)\n";
        } else {
            echo "[FAIL] {$fn} {$batchId} (retry " . ($retries + 1) . "/{$maxEntryRetries})\n";
        }
    }
}

// зберігаємо назад
$store['pending'] = array_values($store['pending']); // переіндексуємо
saveStore(STORE_FILE, $store);

echo "Sync done. Sent: {$sentCount}, Failed: {$failCount}, Left: " . count($store['pending']) . "\n";
