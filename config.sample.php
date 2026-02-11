<?php
/**
 * KPI System — Configuration Template
 *
 * SETUP INSTRUCTIONS:
 * 1. Copy this file: cp config.sample.php config.php
 * 2. Fill in your GAS URLs and auth token below
 * 3. config.php is .gitignored and will NOT be committed
 */

// ===== Google Apps Script URLs =====
// GAS deployment for reading config data (Write.gs doGet)
// Deploy Write.gs as Web App -> Execute as "Me", Access "Anyone"
define('KPI_GAS_READ_URL', 'https://script.google.com/macros/s/YOUR_READ_DEPLOYMENT_ID/exec');

// GAS deployment for writing KPI data (Upload.gs doPost)
// Deploy Upload.gs as Web App -> Execute as "Me", Access "Anyone"
define('KPI_GAS_UPLOAD_URL', 'https://script.google.com/macros/s/YOUR_UPLOAD_DEPLOYMENT_ID/exec');

// ===== Local file paths =====
define('KPI_STORE_FILE', __DIR__ . '/store.json');
define('KPI_DATA_FILE', __DIR__ . '/data.json');

// ===== Sync settings =====
define('KPI_SYNC_MAX_ATTEMPTS', 100);   // max sync_runner.php loops
define('KPI_SYNC_DELAY_SEC', 30);       // pause between sync cycles
define('KPI_SYNC_BATCH_SIZE', 100);     // max entries per sync run
define('KPI_MAX_ENTRY_RETRIES', 10);    // retries per entry before dead-letter

// ===== Auth token (shared secret for PHP endpoints) =====
// Generate a random token: php -r "echo bin2hex(random_bytes(32));"
// Pass it as: ?token=YOUR_TOKEN or Header: X-Auth-Token: YOUR_TOKEN
// Set to empty string '' to disable auth (NOT recommended for production)
define('KPI_AUTH_TOKEN', '');

// ===== CORS =====
// Set to your domain: 'https://kpi.example.com'
// Use '*' only for development
define('KPI_CORS_ORIGIN', '*');

// ===== Log settings =====
define('KPI_LOG_DIR', __DIR__);
define('KPI_LOG_MAX_SIZE', 5 * 1024 * 1024); // 5 MB max per log file

// ===== Debug =====
define('KPI_DEBUG', false);
