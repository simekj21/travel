<?php
declare(strict_types=1);

$actionsRoot = __DIR__ . '/../actions';

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

$folder = (string) ($_GET['folder'] ?? '');
if ($folder === '' || basename($folder) !== $folder || $folder === '.' || $folder === '..') {
    json_response(['error' => 'Neplatný název složky'], 400);
}

$sourceDir = "$actionsRoot/$folder";
$realActionsRoot = realpath($actionsRoot);
$realSourceDir = realpath($sourceDir);

if (!$realActionsRoot || !$realSourceDir || strpos($realSourceDir, $realActionsRoot . DIRECTORY_SEPARATOR) !== 0 || !is_dir($realSourceDir)) {
    json_response(['error' => 'Složka nenalezena'], 404);
}

$files = [];
foreach (scandir($realSourceDir) ?: [] as $entry) {
    if ($entry === '.' || $entry === '..' || $entry[0] === '.') {
        continue;
    }
    $path = "$realSourceDir/$entry";
    if (!is_file($path)) {
        continue;
    }
    $extension = strtolower((string) pathinfo($entry, PATHINFO_EXTENSION));
    if (in_array($extension, ALLOWED_IMAGE_TYPES, true) || $extension === 'jpeg') {
        $files[] = $entry;
    }
}

json_response(['files' => $files]);
