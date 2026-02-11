<?php
// sync_runner.php — циклічно викликає sync.php поки є pending

require_once __DIR__ . '/config.php';

$maxAttempts = KPI_SYNC_MAX_ATTEMPTS;
$delaySec    = KPI_SYNC_DELAY_SEC;
$storeFile   = KPI_STORE_FILE;

function hasPending($storeFile){
    if(!file_exists($storeFile)) return false;
    $data = json_decode(file_get_contents($storeFile), true);
    return !empty($data['pending']);
}

$attempt = 1;
while($attempt <= $maxAttempts){
    echo "=== Attempt $attempt ===\n";

    // виклик sync.php
    passthru("php ".__DIR__."/sync.php");

    if(!hasPending($storeFile)){
        echo "All pending entries sent!\n";
        break;
    }

    echo "Pending left, waiting {$delaySec} sec...\n";
    sleep($delaySec);
    $attempt++;
}

if($attempt > $maxAttempts){
    echo "Reached MAX_ATTEMPTS ({$maxAttempts}), still pending left.\n";
}
