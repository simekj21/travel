<?php
declare(strict_types=1);

$eventsFile = __DIR__ . '/../data/events.json';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

function json_response($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function load_events(string $eventsFile): array {
    if (!file_exists($eventsFile)) {
        return [];
    }
    $decoded = json_decode(file_get_contents($eventsFile), true);
    return is_array($decoded) ? $decoded : [];
}

function save_events(string $eventsFile, array $events): bool {
    $dir = dirname($eventsFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $result = @file_put_contents($eventsFile, json_encode($events, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $result !== false;
}

function remove_event_from_photos(string $eventId): void {
    $dataFile = __DIR__ . '/../data/photos.json';
    if (!file_exists($dataFile)) {
        return;
    }
    $photos = json_decode(file_get_contents($dataFile), true);
    if (!is_array($photos)) {
        return;
    }
    foreach ($photos as &$photo) {
        if (($photo['eventId'] ?? null) === $eventId) {
            $photo['eventId'] = null;
        }
    }
    unset($photo);
    @file_put_contents($dataFile, json_encode($photos, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function delete_event_photos(string $eventId): void {
    $dataFile = __DIR__ . '/../data/photos.json';
    $root = __DIR__ . '/..';
    if (!file_exists($dataFile)) {
        return;
    }
    $photos = json_decode(file_get_contents($dataFile), true);
    if (!is_array($photos)) {
        return;
    }
    $remaining = [];
    foreach ($photos as $photo) {
        if (($photo['eventId'] ?? null) === $eventId) {
            foreach (['originalUrl', 'thumbUrl'] as $key) {
                if (!empty($photo[$key])) {
                    $path = $root . '/' . $photo[$key];
                    if (is_file($path)) {
                        @unlink($path);
                    }
                }
            }
        } else {
            $remaining[] = $photo;
        }
    }
    @file_put_contents($dataFile, json_encode($remaining, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function compute_end_date(string $startDate, string $endMode, $days, $endDate): ?string {
    if ($endMode === 'date') {
        return $endDate !== null && $endDate !== '' ? $endDate : null;
    }

    $daysInt = (int) $days;
    if ($daysInt < 1) {
        $daysInt = 1;
    }
    $start = DateTime::createFromFormat('Y-m-d', $startDate);
    if (!$start) {
        return null;
    }
    $start->modify('+' . ($daysInt - 1) . ' days');
    return $start->format('Y-m-d');
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $events = load_events($eventsFile);
    usort($events, function ($a, $b) {
        return strcmp($b['startDate'] ?? '', $a['startDate'] ?? '');
    });
    json_response($events);
}

if ($method !== 'POST') {
    json_response(['error' => 'Metoda není povolena'], 405);
}

require __DIR__ . '/auth-guard.php';
require_admin();

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? 'create';
$events = load_events($eventsFile);

if ($action === 'create' || $action === 'update') {
    $name = trim((string) ($input['name'] ?? ''));
    $startDate = trim((string) ($input['startDate'] ?? ''));
    $endMode = ($input['endMode'] ?? 'date') === 'days' ? 'days' : 'date';

    if ($name === '' || $startDate === '') {
        json_response(['error' => 'Chybí název nebo datum začátku'], 400);
    }
    if (!DateTime::createFromFormat('Y-m-d', $startDate)) {
        json_response(['error' => 'Neplatné datum začátku'], 400);
    }

    $endDate = compute_end_date($startDate, $endMode, $input['days'] ?? null, $input['endDate'] ?? null);

    $event = [
        'name' => $name,
        'location' => trim((string) ($input['location'] ?? '')),
        'description' => trim((string) ($input['description'] ?? '')),
        'participants' => trim((string) ($input['participants'] ?? '')),
        'startDate' => $startDate,
        'endDate' => $endDate,
    ];

    if ($action === 'create') {
        $event['id'] = bin2hex(random_bytes(6));
        $events[] = $event;
    } else {
        $id = $input['id'] ?? null;
        if (!$id) {
            json_response(['error' => 'Chybí id'], 400);
        }
        $found = false;
        foreach ($events as &$existing) {
            if ($existing['id'] === $id) {
                $event['id'] = $id;
                $existing = $event;
                $found = true;
                break;
            }
        }
        unset($existing);
        if (!$found) {
            json_response(['error' => 'Akce nenalezena'], 404);
        }
    }

    if (!save_events($eventsFile, $events)) {
        json_response(['error' => 'Uložení akce selhalo'], 500);
    }
    json_response($event);
}

if ($action === 'delete') {
    $ids = $input['ids'] ?? null;
    if (!is_array($ids)) {
        $singleId = $input['id'] ?? null;
        $ids = $singleId ? [$singleId] : [];
    }
    $ids = array_values(array_unique(array_filter($ids)));

    if (empty($ids)) {
        json_response(['error' => 'Chybí id akce/akcí'], 400);
    }

    $idsToDelete = array_flip($ids);
    $before = count($events);
    $events = array_values(array_filter($events, function ($event) use ($idsToDelete) {
        return !isset($idsToDelete[$event['id']]);
    }));

    if (count($events) === $before) {
        json_response(['error' => 'Akce nenalezena'], 404);
    }
    if (!save_events($eventsFile, $events)) {
        json_response(['error' => 'Uložení akce selhalo'], 500);
    }

    foreach ($ids as $id) {
        if (!empty($input['deletePhotos'])) {
            delete_event_photos($id);
        } else {
            remove_event_from_photos($id);
        }
    }

    json_response(['deleted' => $ids]);
}

json_response(['error' => 'Neznámá akce'], 400);
