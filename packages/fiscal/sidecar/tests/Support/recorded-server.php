<?php

declare(strict_types=1);

/*
 * The production front controller with SEFAZ replaced by recorded replies, one
 * per endpoint, for the tests that boot the service as a process
 * (`php -S ... tests/Support/recorded-server.php`). Never shipped: the image
 * copies `public/` and `src/`, not `tests/`.
 */

use Fiscal\Sidecar\Http\Request;
use Fiscal\Sidecar\Kernel;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;

require dirname(__DIR__) . '/bootstrap.php';

$request = Request::fromGlobals();
$reply = [
    '/nfce/issue' => 'authorization-100-authorized',
    '/nfce/transmit' => 'authorization-100-authorized',
    '/nfce/cancel' => 'cancel-135-registered',
    '/nfce/lookup' => 'lookup-100-authorized',
    '/inutilize' => 'inutilize-102-homologated',
][$request->path] ?? null;

Kernel::production($reply === null ? new RecordedTransport() : new RecordedTransport($reply))->handle($request)->send();
