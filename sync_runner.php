<?php
// sync_runner.php — циклічно викликає sync.php поки є pending

const STORE_FILE = __DIR__ . '/store.json';
const MAX_ATTEMPTS = 100;   // максимум повторів
const DELAY_SEC   = 30;    // пауза між циклами

function hasPending(){
    if(!file_exists(STORE_FILE)) return false;
    $data = json_decode(file_get_contents(STORE_FILE), true);
    return !empty($data['pending']);
}

$attempt = 1;
while($attempt <= MAX_ATTEMPTS){
    echo "=== Attempt $attempt ===\n";

    // виклик sync.php
    passthru("php ".__DIR__."/sync.php");

    if(!hasPending()){
        echo "All pending entries sent!\n";
        break;
    }

    echo "Pending left, waiting ".DELAY_SEC." sec...\n";
    sleep(DELAY_SEC);
    $attempt++;
}

if($attempt > MAX_ATTEMPTS){
    echo "Reached MAX_ATTEMPTS, still pending left.\n";
}
