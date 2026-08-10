<?php
declare(strict_types=1);

$settingsFile = __DIR__ . '/../data/settings.json';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

function json_response($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function default_settings(): array {
    return [
        'siteMode' => 'travel',
        'mapEnabled' => true,
        'eventsEnabled' => true,
        'tagsEnabled' => true,
        'countryFilterEnabled' => true,
    ];
}

function load_settings(string $settingsFile): array {
    if (!file_exists($settingsFile)) {
        return default_settings();
    }
    $decoded = json_decode(file_get_contents($settingsFile), true);
    return is_array($decoded) ? array_merge(default_settings(), $decoded) : default_settings();
}

function save_settings(string $settingsFile, array $settings): bool {
    $dir = dirname($settingsFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $result = @file_put_contents($settingsFile, json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $result !== false;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    json_response(load_settings($settingsFile));
}

if ($method !== 'POST') {
    json_response(['error' => 'Metoda není povolena'], 405);
}

require __DIR__ . '/auth-guard.php';
require_admin();

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    json_response(['error' => 'Neplatná data'], 400);
}

$settings = load_settings($settingsFile);

if (array_key_exists('siteMode', $input) && in_array($input['siteMode'], ['travel', 'photo'], true)) {
    $settings['siteMode'] = $input['siteMode'];
}

foreach (array_keys(default_settings()) as $key) {
    if ($key === 'siteMode') {
        continue;
    }
    if (array_key_exists($key, $input)) {
        $settings[$key] = (bool) $input[$key];
    }
}

if (!save_settings($settingsFile, $settings)) {
    json_response(['error' => 'Uložení nastavení selhalo'], 500);
}

json_response($settings);
