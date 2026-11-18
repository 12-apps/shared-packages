<?php

declare(strict_types=1);

/*
 * Exits 0 when the PHP running it can run the service, 1 listing what it
 * lacks otherwise. Run it with the PHP a desktop build bundles:
 *
 *   ./php sidecar/bin/check-platform.php
 *
 * It needs no vendor/ folder: a build checks its PHP before it copies one in.
 */

require dirname(__DIR__) . '/src/Platform.php';

$problems = Fiscal\Sidecar\Platform::missing(get_loaded_extensions(), PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION . '.' . PHP_RELEASE_VERSION);
if (!in_array(PHP_SAPI, ['cli'], true)) {
    $problems[] = 'run this with the command-line PHP (' . PHP_SAPI . ' is not cli)';
}
foreach ($problems as $problem) {
    fwrite(STDERR, "fiscal sidecar: $problem\n");
}
exit($problems === [] ? 0 : 1);
