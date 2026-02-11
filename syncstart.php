<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Manual Sync</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      margin: 0; padding: 40px;
      font-family: Arial, sans-serif;
      background: #f6f7fb; color: #0f172a;
    }
    .center {
      text-align: center;
    }
    .btn {
      padding: 12px 22px;
      border: 0;
      border-radius: 10px;
      background: #2563eb;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
    }
    .btn:disabled {
      opacity: .7;
      cursor: not-allowed;
    }
    pre {
      text-align: left;
      background: #fff;
      border: 1px solid #ddd;
      padding: 14px;
      margin-top: 20px;
      border-radius: 10px;
      overflow-x: auto;
      max-height: 70vh;
    }
  </style>
</head>
<body>
  <div class="center">
    <button class="btn" id="syncBtn">🔄 Sync now</button>
    <pre id="output">Press "Sync now" to start…</pre>
  </div>

  <script>
    const btn = document.getElementById('syncBtn');
    const out = document.getElementById('output');

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.textContent = "⏳ Running sync...";
      try {
        const res = await fetch('sync_runner.php?ts=' + Date.now(), {cache: 'no-store'});
        const txt = await res.text();
        out.textContent = txt;
      } catch (e) {
        out.textContent = "❌ Error: " + e.message;
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>
