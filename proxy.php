<?php
// proxy.php — GAS proxy (hardened) with auth support

require_once __DIR__ . '/config.php';

// ===== Auth check =====
function checkAuth(): bool {
    $token = KPI_AUTH_TOKEN;
    if ($token === '') return true;
    $provided = $_GET['token'] ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    return hash_equals($token, $provided);
}

// --- CORS
header('Access-Control-Allow-Origin: ' . KPI_CORS_ORIGIN);
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

// Auth
if (!checkAuth()) {
  http_response_code(401);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
  exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$qs = $_SERVER['QUERY_STRING'] ?? '';

// Remove auth token from forwarded query string
$qs = preg_replace('/(\?|&)?token=[^&]*/', '', $qs);
$qs = ltrim($qs, '&');

$GAS_URL = KPI_GAS_UPLOAD_URL;

$ch = curl_init();
$url = $GAS_URL . ($method === 'GET' && $qs ? ('?'.$qs) : '');
curl_setopt_array($ch, [
  CURLOPT_URL            => $url,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_MAXREDIRS      => 5,
  CURLOPT_CONNECTTIMEOUT => 10,
  CURLOPT_TIMEOUT        => 25,
  CURLOPT_SSL_VERIFYPEER => true,
  CURLOPT_SSL_VERIFYHOST => 2,
  CURLOPT_ENCODING       => '',
  CURLOPT_USERAGENT      => 'KPI-Proxy/2.0',
]);

$headers = ['Accept: application/json, text/plain;q=0.9, */*;q=0.8'];
if ($method === 'POST') {
  $body = file_get_contents('php://input') ?: '';
  $headers[] = 'Expect:';
  $headers[] = 'Content-Type: application/json';
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$resp   = curl_exec($ch);
$errno  = curl_errno($ch);
$error  = curl_error($ch);
$http   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$ctype  = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/json; charset=utf-8';
curl_close($ch);

if ($errno) {
  http_response_code(502);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok'=>false,'code'=>'PROXY_CURL_ERR','message'=>$error], JSON_UNESCAPED_UNICODE);
  exit;
}

// Якщо GAS віддав HTML (часто через неправильний деплой)
if (stripos($ctype, 'text/html') !== false) {
  http_response_code(502);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok'=>false,'code'=>'GAS_HTML',
    'message'=>'GAS returned HTML instead of JSON. Check Web App deployment: Execute as "Me", Access "Anyone".'], JSON_UNESCAPED_UNICODE);
  exit;
}

http_response_code($http ?: 200);
header('Content-Type: ' . (strpos($ctype, 'json') !== false ? $ctype : 'application/json; charset=utf-8'));
header('Cache-Control: no-store, max-age=0');

echo $resp;
