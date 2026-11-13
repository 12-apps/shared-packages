<?php

declare(strict_types=1);

/*
 * The front controller. Every request builds its own kernel, so a certificate
 * read for one call is garbage the moment the call answers.
 */

use Fiscal\Sidecar\Http\Request;
use Fiscal\Sidecar\Kernel;

require dirname(__DIR__) . '/vendor/autoload.php';

Kernel::production()->handle(Request::fromGlobals())->send();
