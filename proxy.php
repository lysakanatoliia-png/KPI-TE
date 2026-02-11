<?php
// proxy1.php — GAS proxy (hardened)

$GAS_URL = "https://script.google.com/macros/s/AKfycbyQzYk2WQXz_p6ixA-Y-rufp_LsIJNN03Emw0EPBRndAJxe2SInOrNargU4BnRPx-Gx/exec";

// --- CORS (безпечно навіть на same-origin)
header('Access-Control-Allow-Origin: *');
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$qs = $_SERVER['QUERY_STRING'] ?? '';

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
  CURLOPT_ENCODING       => '',                // gzip/deflate
  CURLOPT_USERAGENT      => 'KPI-Proxy/1.0',
]);

$headers = ['Accept: application/json, text/plain;q=0.9, */*;q=0.8'];
if ($method === 'POST') {
  $body = file_get_contents('php://input') ?: '';
  $headers[] = 'Expect:';                      // без 100-continue
  $headers[] = 'Content-Type: application/json';
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

// Проброс мінімального контексту
$headers[] = 'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? '');
$headers[] = 'X-Forwarded-Proto: ' . (!empty($_SERVER['HTTPS']) ? 'https' : 'http');
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

// Якщо GAS віддав HTML (часто через неправильний деплой) — злови і поясни
if (stripos($ctype, 'text/html') !== false) {
  http_response_code(502);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok'=>false,'code'=>'GAS_HTML',
    'message'=>'GAS повернув HTML. Перевір деплой Web App: Execute as "Me", Access "Anyone with the link".'], JSON_UNESCAPED_UNICODE);
  exit;
}

// Проброс статусу, типу, кешу
http_response_code($http ?: 200);
header('Content-Type: ' . (strpos($ctype, 'json') !== false ? $ctype : 'application/json; charset=utf-8'));
header('Cache-Control: no-store, max-age=0');

echo $resp;
