<?php
// health.php — system health check endpoint

require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$checks = [];
$allOk = true;

// 1. store.json writable
$storeOk = is_writable(KPI_STORE_FILE) || is_writable(dirname(KPI_STORE_FILE));
$checks['store_writable'] = $storeOk;
if (!$storeOk) $allOk = false;

// 2. Pending count
$pendingCount = 0;
$deadLetterCount = 0;
if (file_exists(KPI_STORE_FILE)) {
    $store = json_decode(file_get_contents(KPI_STORE_FILE), true);
    $pendingCount = count($store['pending'] ?? []);
    $deadLetterCount = count($store['dead_letter'] ?? []);
}
$checks['pending_count'] = $pendingCount;
$checks['dead_letter_count'] = $deadLetterCount;

// 3. data.json exists and fresh
$dataOk = file_exists(KPI_DATA_FILE);
$dataAge = null;
if ($dataOk) {
    $dataAge = time() - filemtime(KPI_DATA_FILE);
    $checks['data_age_seconds'] = $dataAge;
    $checks['data_age_human'] = $dataAge < 60 ? "{$dataAge}s" : round($dataAge / 60) . 'm';
}
$checks['data_exists'] = $dataOk;
if (!$dataOk) $allOk = false;

// 4. data.json valid
if ($dataOk) {
    $data = json_decode(file_get_contents(KPI_DATA_FILE), true);
    $dataValid = is_array($data) && isset($data['rooms'], $data['slots'], $data['indicators'], $data['staff']);
    $checks['data_valid'] = $dataValid;
    if ($dataValid) {
        $checks['data_counts'] = [
            'rooms' => count($data['rooms']),
            'slots' => count($data['slots']),
            'indicators' => count($data['indicators']),
            'staff' => count($data['staff']),
        ];
    }
    if (!$dataValid) $allOk = false;
}

// 5. Config loaded
$checks['gas_read_url_set'] = !empty(KPI_GAS_READ_URL) && KPI_GAS_READ_URL !== 'https://script.google.com/macros/s/YOUR_READ_DEPLOYMENT_ID/exec';
$checks['gas_upload_url_set'] = !empty(KPI_GAS_UPLOAD_URL) && KPI_GAS_UPLOAD_URL !== 'https://script.google.com/macros/s/YOUR_UPLOAD_DEPLOYMENT_ID/exec';
$checks['auth_enabled'] = KPI_AUTH_TOKEN !== '';

// 6. Log files size
$logFiles = ['sync.log', 'sync_runner.log'];
$checks['logs'] = [];
foreach ($logFiles as $logFile) {
    $path = KPI_LOG_DIR . '/' . $logFile;
    if (file_exists($path)) {
        $size = filesize($path);
        $checks['logs'][$logFile] = [
            'size' => $size,
            'size_human' => $size < 1024 ? "{$size}B" : round($size / 1024) . 'KB',
            'over_limit' => $size > KPI_LOG_MAX_SIZE,
        ];
    }
}

$checks['php_version'] = PHP_VERSION;
$checks['timestamp'] = gmdate('c');

http_response_code($allOk ? 200 : 503);
echo json_encode([
    'ok' => $allOk,
    'checks' => $checks,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
