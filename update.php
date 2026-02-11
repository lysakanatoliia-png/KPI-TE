<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);

// === NO-CACHE HEADERS ===
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");
header("Expires: 0");

// === CONFIG ===
const GAS_BASE = 'https://script.google.com/macros/s/AKfycbyaKCX36VTb-yGwXlUrmIYL1rgtdVpd3dU_kzaXkmDaOYcQoFF03JMRXPknKb8jfhXScQ/exec';
$GAS_GET_ALL   = GAS_BASE . '?action=getAll';
define('DATA_JSON_PATH', __DIR__ . '/data.json');

function respond_json($payload, $code=200){
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($payload, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
  exit;
}

if (isset($_GET['run'])) {
  try {
    // Додаємо таймштамп щоб GAS теж не кешував
    $url = $GAS_GET_ALL . '&_ts=' . time();
    $raw = @file_get_contents($url);
    if (!$raw) respond_json(['ok'=>false,'error'=>'Failed to fetch from GAS','url'=>$url],502);

    $payload = json_decode($raw,true);
    if (!is_array($payload)) {
      respond_json(['ok'=>false,'error'=>'Invalid JSON from GAS','raw'=>substr($raw,0,200)],500);
    }

    // check required keys
    $need = ['rooms','slots','indicators','staff'];
    $miss = [];
    foreach ($need as $k) if (!array_key_exists($k,$payload)) $miss[]=$k;
    if ($miss) {
      respond_json(['ok'=>false,'error'=>'Missing keys: '.implode(', ',$miss),'got'=>array_keys($payload)],500);
    }

    // overwrite data.json (також з анти-кешом)
    $meta = ['generatedAt'=>gmdate('c'),'source'=>'GAS','version'=>$payload['_meta']['version']??'v1'];
    $combined = [
      'rooms'=>$payload['rooms'],
      'slots'=>$payload['slots'],
      'indicators'=>$payload['indicators'],
      'staff'=>$payload['staff'],
      '_meta'=>$meta
    ];
    file_put_contents(DATA_JSON_PATH,json_encode($combined,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));

    respond_json([
      'ok'=>true,
      'counts'=>[
        'rooms'=>count($payload['rooms']),
        'slots'=>count($payload['slots']),
        'indicators'=>count($payload['indicators']),
        'staff'=>count($payload['staff'])
      ],
      '_meta'=>$meta
    ]);

  } catch(Throwable $e) {
    respond_json(['ok'=>false,'error'=>'PHP Exception: '.$e->getMessage()],500);
  }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>KPI Data Updater</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;
         background:#f6f7fb;font-family:Inter,Arial,sans-serif}
    .card{width:min(520px,92vw);background:#fff;border:1px solid #e5e7eb;
          border-radius:16px;padding:28px;box-shadow:0 8px 26px rgba(0,0,0,.06);
          text-align:center}
    h2{margin:0 0 8px}
    p{margin:0 0 18px;color:#64748b}
    button{padding:12px 18px;border:0;border-radius:10px;background:#2563eb;
           color:#fff;font-size:16px;cursor:pointer}
    button[disabled]{opacity:.7;cursor:not-allowed}
    .msg{margin-top:14px;font-size:14px;color:#0f172a;white-space:pre-wrap}
  </style>
</head>
<body>
  <div class="card">
    <h2>Update KPI Data</h2>
    <p>Fetch all sheets from GAS and overwrite <code>data.json</code>.</p>
    <button id="btn" onclick="updateData()">Update Data</button>
    <div id="msg" class="msg"></div>
  </div>

  <script>
    async function updateData() {
      const btn = document.getElementById('btn');
      const msg = document.getElementById('msg');
      btn.disabled = true;
      msg.textContent = '⏳ Updating...';
      try {
        // додаємо анти-кеш параметр _t
        const res = await fetch('?run=1&_t=' + Date.now(), {cache:'no-store'});
        const txt = await res.text();
        let data;
        try { data = JSON.parse(txt); } catch(e){ throw new Error('Invalid JSON:\n'+txt); }

        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP '+res.status));

        msg.textContent =
          `✅ Done!\nRooms: ${data.counts.rooms}\nSlots: ${data.counts.slots}\nIndicators: ${data.counts.indicators}\nStaff: ${data.counts.staff}`;
      } catch(e) {
        msg.textContent = '❌ ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>
