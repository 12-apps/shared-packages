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

    /** The `-d` flags the README launches the service with, from `extensions.json`'s `ini`. */
    private static function launchFlags(array $overrides = []): string
    {
        $flags = '';
        foreach ([...Platform::required()['ini'], ...$overrides] as $name => $value) {
            $flags .= ' -d ' . escapeshellarg("$name=$value");
        }
        return $flags;
    }

    public function testTheLaunchSettingsAreTheImagesPhpIni(): void
    {
        $image = parse_ini_file(dirname(__DIR__, 2) . '/docker/php.ini', false, INI_SCANNER_RAW);
        self::assertIsArray($image);
        foreach (Platform::required()['ini'] as $name => $wanted) {
            self::assertArrayHasKey($name, $image);
            self::assertSame([], Platform::unsafeSettings(static fn () => $image[$name], [$name => $wanted]), $name);
        }
    }

    public function testUnsafeSettingsNamesWhatALaunchDropped(): void
    {
        $settings = ['zend.exception_ignore_args' => '1', 'display_errors' => '0'];
        self::assertSame([], Platform::unsafeSettings(static fn (string $n) => $n === 'display_errors' ? 'Off' : 'On', $settings));
        self::assertSame(
            ["the setting zend.exception_ignore_args must be 1 (launch with -d zend.exception_ignore_args=1), this is '0'",
             "the setting display_errors must be 0 (launch with -d display_errors=0), this is 'STDOUT'"],
            Platform::unsafeSettings(static fn (string $n) => $n === 'display_errors' ? 'STDOUT' : '0', $settings),
        );
    }

    public function testTheCheckScriptFailsALaunchWithoutExceptionIgnoreArgs(): void
    {
        $script = escapeshellarg(dirname(__DIR__, 2) . '/bin/check-platform.php');
        exec(escapeshellarg(PHP_BINARY) . self::launchFlags(['zend.exception_ignore_args' => '0']) . " $script 2>&1", $output, $code);
        self::assertSame(1, $code);
        self::assertContains(
            "fiscal sidecar: the setting zend.exception_ignore_args must be 1 (launch with -d zend.exception_ignore_args=1), this is '0'",
            $output,
        );
    }

    public function testTheCheckScriptAnswersThisPhpAsPlatformDoes(): void
    {
        $script = dirname(__DIR__, 2) . '/bin/check-platform.php';
        exec(escapeshellarg(PHP_BINARY) . self::launchFlags() . ' ' . escapeshellarg($script) . ' 2>&1', $output, $code);
        $expected = Platform::missing(get_loaded_extensions(), PHP_VERSION);
        self::assertSame($expected === [] ? 0 : 1, $code, implode("\n", $output));
        foreach ($expected as $problem) {
            self::assertContains("fiscal sidecar: $problem", $output);
        }
    }
}
