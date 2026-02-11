<?php
// kpi/proxy1.php
// Серверний проксі на вашому домені -> GAS Web App

// CORS (за потреби підкоригуйте origin)
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://dev.tinyeinstein.org');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$fn = isset($_GET['fn']) ? $_GET['fn'] : '';
if ($fn === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'Missing fn']);
  exit;
}

// !!! ВСТАВТЕ СВІЙ GAS URL нижче (exec)
$GAS_BASE = 'https://script.google.com/macros/s/AKfycbyv8VusXvCajJzKKBAW9BRoMaTZjBlxQQVGw8JilRW-fb6zIhgXRfOnsiC6idLxa6rC/exec';

$gasUrl = $GAS_BASE . '?fn=' . urlencode($fn);
$payload = file_get_contents('php://input');

$ch = curl_init($gasUrl);
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
  CURLOPT_POSTFIELDS     => $payload ?: '{}',
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_TIMEOUT        => 20,
]);
$out  = curl_exec($ch);
$http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($out === false) {
  http_response_code(502);
  echo json_encode(['ok' => false, 'error' => $err ?: 'Proxy request failed']);
  exit;
}

http_response_code($http ?: 200);
echo $out;
