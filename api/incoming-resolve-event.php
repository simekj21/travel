<?php
declare(strict_types=1);

$eventsFile = __DIR__ . '/../data/events.json';

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

function load_events_list(string $eventsFile): array {
    if (!file_exists($eventsFile)) {
        return [];
    }
    $decoded = json_decode(file_get_contents($eventsFile), true);
    return is_array($decoded) ? $decoded : [];
}

function save_events_list(string $eventsFile, array $events): bool {
    $dir = dirname($eventsFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $result = @file_put_contents($eventsFile, json_encode($events, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $result !== false;
}

$input = json_decode(file_get_contents('php://input'), true);
$eventMode = $input['eventMode'] ?? 'none';

$events = load_events_list($eventsFile);
$eventId = null;

if ($eventMode === 'new') {
    $eventName = trim((string) ($input['eventName'] ?? ''));
    $eventStartDate = trim((string) ($input['eventStartDate'] ?? ''));
    if ($eventName === '' || !DateTime::createFromFormat('Y-m-d', $eventStartDate)) {
        json_response(['error' => 'Chybí název nebo datum nové akce'], 400);
    }
    $eventId = bin2hex(random_bytes(6));
    $events[] = [
        'id' => $eventId,
        'name' => $eventName,
        'location' => '',
        'description' => '',
        'participants' => '',
        'startDate' => $eventStartDate,
        'endDate' => null,
    ];
    if (!save_events_list($eventsFile, $events)) {
        json_response(['error' => 'Uložení akce selhalo'], 500);
    }
} elseif ($eventMode === 'existing') {
    $eventId = (string) ($input['eventId'] ?? '');
    $found = false;
    foreach ($events as $evt) {
        if ($evt['id'] === $eventId) {
            $found = true;
            break;
        }
    }
    if ($eventId === '' || !$found) {
        json_response(['error' => 'Akce nenalezena'], 404);
    }
}

json_response(['eventId' => $eventId]);
