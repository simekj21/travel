<?php
declare(strict_types=1);

$photosRoot = __DIR__ . '/../photos';

require __DIR__ . '/auth-guard.php';
require __DIR__ . '/photo-utils.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

function json_response($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'Metoda není povolena'], 405);
}

require_admin();

$count = 0;

if (is_dir($photosRoot)) {
    foreach (scandir($photosRoot) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..' || $entry[0] === '.') {
            continue;
        }
        $path = "$photosRoot/$entry";
        if (!is_file($path)) {
            continue;
        }
        $extension = strtolower((string) pathinfo($entry, PATHINFO_EXTENSION));
        if (in_array($extension, ALLOWED_IMAGE_TYPES, true) || $extension === 'jpeg') {
            $count++;
        }
    }
}

json_response(['count' => $count]);
