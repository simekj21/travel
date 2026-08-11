<?php
declare(strict_types=1);

$root = __DIR__ . '/..';
$dataDir = $root . '/data';
$uploadsRoot = $root . '/uploads';

require __DIR__ . '/auth-guard.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

function json_response($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Metoda není povolena'], 405);
}

require_admin();

$input = json_decode(file_get_contents('php://input'), true);
$confirm = (string) (((array) $input)['confirm'] ?? '');

if ($confirm !== 'reset') {
    json_response(['error' => 'Potvrzení nesouhlasí'], 400);
}

function clear_directory_contents(string $dir): void {
    if (!is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..' || $entry === '.gitkeep') {
            continue;
        }
        $path = "$dir/$entry";
        if (is_dir($path)) {
            clear_directory_contents($path);
            @rmdir($path);
        } else {
            @unlink($path);
        }
    }
}

clear_directory_contents("$uploadsRoot/originals");
clear_directory_contents("$uploadsRoot/thumbs");

foreach (['photos.json', 'tags.json', 'events.json'] as $file) {
    @file_put_contents("$dataDir/$file", '[]', LOCK_EX);
}

json_response(['ok' => true]);
