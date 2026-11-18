<?php

declare(strict_types=1);

namespace Fiscal\Sidecar;

/**
 * What a PHP must carry to run the service (FUT-4717): the minor version and
 * the extensions `extensions.json` lists — every `ext-*` the service and its
 * locked libraries require. A bundled static PHP (a desktop install, no
 * Docker) is checked against it at build time with `bin/check-platform.php`,
 * so a library bump that needs a new extension fails that build, not a sale.
 *
 * `ini` is what the image's `docker/php.ini` guarantees and a bundled PHP is
 * launched with as `-d` flags: no error printed into a response, a stack
 * trace with no arguments (a password, a certificate, the launch token), no
 * upload spooled to disk.
 */
final class Platform
{
    /** @return array{php: string, extensions: list<string>, sapi: list<string>, ini: array<string, string>} */
    public static function required(?string $file = null): array
    {
        $raw = (string) file_get_contents($file ?? dirname(__DIR__) . '/extensions.json');
        /** @var array{php: string, extensions: list<string>, sapi: list<string>, ini: array<string, string>} $decoded */
        $decoded = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
        return $decoded;
    }

    /**
     * What this PHP lacks, as readable lines; empty when it can run the service.
     *
     * @param list<string> $loaded extension names, as `get_loaded_extensions()` answers them
     * @return list<string>
     */
    public static function missing(array $loaded, string $phpVersion, ?array $required = null): array
    {
        $required ??= self::required();
        $have = array_map('strtolower', $loaded);
        $problems = [];
        if (!str_starts_with($phpVersion . '.', $required['php'] . '.')) {
            $problems[] = "PHP {$required['php']} is required, this is $phpVersion";
        }
        foreach ($required['extensions'] as $extension) {
            if (!in_array($extension, $have, true)) {
                $problems[] = "the extension $extension is missing";
            }
        }
        return $problems;
    }

    /**
     * The launch settings this PHP runs without, as readable lines; empty when
     * it was launched with every one of `ini` (the `-d` flags of the README).
     *
     * @param callable(string): (string|false) $iniGet `ini_get`, or a stand-in
     * @param array<string, string>|null $settings
     * @return list<string>
     */
    public static function unsafeSettings(callable $iniGet, ?array $settings = null): array
    {
        $settings ??= self::required()['ini'];
        $problems = [];
        foreach ($settings as $name => $wanted) {
            $value = $iniGet($name);
            if ($value === false || self::normalised($value) !== $wanted) {
                $shown = $value === false ? 'unknown' : "'$value'";
                $problems[] = "the setting $name must be $wanted (launch with -d $name=$wanted), this is $shown";
            }
        }
        return $problems;
    }

    /** An ini value as `-d` writes it: on/true/yes as 1, off/false/no/empty as 0. */
    private static function normalised(string $value): string
    {
        $lower = strtolower(trim($value));
        return match ($lower) {
            'on', 'true', 'yes' => '1',
            'off', 'false', 'no', '' => '0',
            default => $lower,
        };
    }
}
