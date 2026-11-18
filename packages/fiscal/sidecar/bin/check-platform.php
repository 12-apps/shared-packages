<?php

declare(strict_types=1);

/*
 * Exits 0 when the PHP running it can run the service, 1 listing what it
 * lacks otherwise. Run it with the PHP a desktop build bundles AND the launch
 * flags the service runs with (sidecar/README.md, `SIDECAR_PHP_LAUNCH_FLAGS`),
 * so a launch that drops `zend.exception_ignore_args` fails here:
 *
 *   ./php -d display_errors=0 -d log_errors=1 -d zend.exception_ignore_args=1 \
 *     -d zend.exception_string_param_max_len=0 -d file_uploads=0 sidecar/bin/check-platform.php
 *
 * It needs no vendor/ folder: a build checks its PHP before it copies one in.
 */

require dirname(__DIR__) . '/src/Platform.php';

$problems = [
    ...Fiscal\Sidecar\Platform::missing(get_loaded_extensions(), PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION . '.' . PHP_RELEASE_VERSION),
    ...Fiscal\Sidecar\Platform::unsafeSettings('ini_get'),
];
if (!in_array(PHP_SAPI, ['cli'], true)) {
    $problems[] = 'run this with the command-line PHP (' . PHP_SAPI . ' is not cli)';
}
foreach ($problems as $problem) {
    fwrite(STDERR, "fiscal sidecar: $problem\n");
}
exit($problems === [] ? 0 : 1);
