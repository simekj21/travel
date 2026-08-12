<?php
declare(strict_types=1);

$actionsRoot = __DIR__ . '/../actions';
$uploadsRoot = __DIR__ . '/../uploads';
$dataFile = __DIR__ . '/../data/photos.json';

require __DIR__ . '/auth-guard.php';
require __DIR__ . '/photo-utils.php';

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
$folder = (string) ($input['folder'] ?? '');
$filename = basename((string) ($input['filename'] ?? ''));
$eventId = $input['eventId'] ?? null;
$eventId = $eventId !== null ? (string) $eventId : null;
$countryCode = trim((string) ($input['countryCode'] ?? '')) ?: null;
$deleteOriginals = !array_key_exists('deleteOriginals', (array) $input) || (bool) $input['deleteOriginals'];

if ($folder === '' || basename($folder) !== $folder || $folder === '.' || $folder === '..') {
    json_response(['error' => 'Neplatný název složky'], 400);
}
if ($filename === '') {
    json_response(['error' => 'Chybí název souboru'], 400);
}

$sourceDir = "$actionsRoot/$folder";
$realActionsRoot = realpath($actionsRoot);
$realSourceDir = realpath($sourceDir);

if (!$realActionsRoot || !$realSourceDir || strpos($realSourceDir, $realActionsRoot . DIRECTORY_SEPARATOR) !== 0 || !is_dir($realSourceDir)) {
    json_response(['error' => 'Složka nenalezena'], 404);
}

$sourcePath = "$realSourceDir/$filename";
if (!is_file($sourcePath)) {
    json_response(['error' => "$filename: soubor nenalezen"], 404);
}

$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $sourcePath);
finfo_close($finfo);

if (!isset(ALLOWED_IMAGE_TYPES[$mimeType])) {
    json_response(['skipped' => "$filename: nepodporovaný typ souboru"]);
}

$target = make_upload_target($uploadsRoot, ALLOWED_IMAGE_TYPES[$mimeType]);

if ($deleteOriginals) {
    if (!@rename($sourcePath, $target['originalDestPath'])) {
        if (!@copy($sourcePath, $target['originalDestPath'])) {
            json_response(['skipped' => "$filename: přesun se nezdařil"]);
        }
        @unlink($sourcePath);
    }
} else {
    if (!@copy($sourcePath, $target['originalDestPath'])) {
        json_response(['skipped' => "$filename: kopírování se nezdařilo"]);
    }
}

$dims = finalize_uploaded_image($target['originalDestPath'], $mimeType, $target['thumbDestPath']);

$record = [
    'id' => bin2hex(random_bytes(6)),
    'originalUrl' => $target['originalUrl'],
    'thumbUrl' => $target['thumbUrl'],
    'originalName' => $filename,
    'uploadedAt' => date('c'),
    'width' => $dims['width'],
    'height' => $dims['height'],
    'eventId' => $eventId,
    'countryCode' => $countryCode,
];

$photos = load_photos($dataFile);
$photos[] = $record;

if (!save_photos($dataFile, $photos)) {
    json_response(['error' => "$filename: zápis do $dataFile selhal"], 500);
}

$remaining = array_filter((scandir($realSourceDir) ?: []), function ($entry) {
    return $entry !== '.' && $entry !== '..' && $entry[0] !== '.';
});

if (empty($remaining)) {
    @rmdir($realSourceDir);
}

json_response(['imported' => $record]);
