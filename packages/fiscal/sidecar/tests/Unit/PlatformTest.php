<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Platform;
use PHPUnit\Framework\TestCase;

/**
 * `extensions.json` is the one list a bundled PHP is built and checked
 * against (FUT-4717): exactly the `ext-*` the service and its locked
 * production libraries require, so a library bump that needs a new extension
 * fails here first.
 */
final class PlatformTest extends TestCase
{
    /** @return list<string> */
    private static function declared(): array
    {
        $root = dirname(__DIR__, 2);
        $composer = json_decode((string) file_get_contents("$root/composer.json"), true, 64, JSON_THROW_ON_ERROR);
        $lock = json_decode((string) file_get_contents("$root/composer.lock"), true, 64, JSON_THROW_ON_ERROR);
        $requires = array_keys($composer['require']);
        foreach ($lock['packages'] as $package) {
            $requires = [...$requires, ...array_keys($package['require'] ?? [])];
        }
        $extensions = array_map(
            static fn (string $name): string => strtolower(substr($name, 4)),
            array_filter($requires, static fn (string $name): bool => str_starts_with($name, 'ext-')),
        );
        $extensions = array_values(array_unique($extensions));
        sort($extensions);
        return $extensions;
    }

    public function testTheListIsExactlyWhatTheServiceAndItsLockedLibrariesRequire(): void
    {
        $listed = Platform::required()['extensions'];
        $sorted = $listed;
        sort($sorted);
        self::assertSame($sorted, $listed, 'extensions.json stays sorted');
        self::assertSame(self::declared(), $listed);
    }

    public function testThePhpVersionIsTheOneComposerPins(): void
    {
        $composer = json_decode((string) file_get_contents(dirname(__DIR__, 2) . '/composer.json'), true, 64, JSON_THROW_ON_ERROR);
        self::assertSame('~' . Platform::required()['php'] . '.0', $composer['require']['php']);
    }

    public function testMissingNamesWhatALeanPhpLacks(): void
    {
        $required = ['php' => '8.3', 'extensions' => ['curl', 'reflection', 'soap'], 'sapi' => ['cli']];
        self::assertSame([], Platform::missing(['Core', 'curl', 'Reflection', 'soap'], '8.3.14', $required));
        self::assertSame(
            ['PHP 8.3 is required, this is 8.4.1', 'the extension soap is missing'],
            Platform::missing(['curl', 'Reflection'], '8.4.1', $required),
        );
        self::assertSame(['PHP 8.3 is required, this is 8.30.0'], Platform::missing(['curl', 'Reflection', 'soap'], '8.30.0', $required));
    }

    public function testTheCheckScriptAnswersThisPhpAsPlatformDoes(): void
    {
        $script = dirname(__DIR__, 2) . '/bin/check-platform.php';
        exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($script) . ' 2>&1', $output, $code);
        $expected = Platform::missing(get_loaded_extensions(), PHP_VERSION);
        self::assertSame($expected === [] ? 0 : 1, $code, implode("\n", $output));
        foreach ($expected as $problem) {
            self::assertContains("fiscal sidecar: $problem", $output);
        }
    }
}
