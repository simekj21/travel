<?php
declare(strict_types=1);

$photosRoot = __DIR__ . '/../photos';
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
$deleteOriginals = !array_key_exists('deleteOriginals', (array) $input) || (bool) $input['deleteOriginals'];

$realPhotosRoot = realpath($photosRoot);
if (!$realPhotosRoot || !is_dir($realPhotosRoot)) {
    json_response(['error' => 'Složka photos/ nenalezena'], 404);
}

$photos = load_photos($dataFile);
$imported = [];
$skipped = [];

foreach (scandir($realPhotosRoot) ?: [] as $entry) {
    if ($entry === '.' || $entry === '..' || $entry[0] === '.') {
        continue;
    }
    $sourcePath = "$realPhotosRoot/$entry";
    if (!is_file($sourcePath)) {
        continue;
    }

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $sourcePath);
    finfo_close($finfo);

    if (!isset(ALLOWED_IMAGE_TYPES[$mimeType])) {
        $skipped[] = "$entry: nepodporovaný typ souboru";
        continue;
    }

    $target = make_upload_target($uploadsRoot, ALLOWED_IMAGE_TYPES[$mimeType]);

    if ($deleteOriginals) {
        if (!@rename($sourcePath, $target['originalDestPath'])) {
            if (!@copy($sourcePath, $target['originalDestPath'])) {
                $skipped[] = "$entry: přesun se nezdařil";
                continue;
            }
            @unlink($sourcePath);
        }
    } else {
        if (!@copy($sourcePath, $target['originalDestPath'])) {
            $skipped[] = "$entry: kopírování se nezdařilo";
            continue;
        }
    }

    $dims = finalize_uploaded_image($target['originalDestPath'], $mimeType, $target['thumbDestPath']);

    $record = [
        'id' => bin2hex(random_bytes(6)),
        'originalUrl' => $target['originalUrl'],
        'thumbUrl' => $target['thumbUrl'],
        'originalName' => $entry,
        'uploadedAt' => date('c'),
        'width' => $dims['width'],
        'height' => $dims['height'],
        'eventId' => null,
        'countryCode' => null,
    ];

    $photos[] = $record;
    $imported[] = $record;
}

if (!empty($imported) && !save_photos($dataFile, $photos)) {
    json_response(['error' => "Fotky se importovaly, ale zápis do $dataFile selhal"], 500);
}

json_response(['imported' => count($imported), 'skipped' => $skipped]);
