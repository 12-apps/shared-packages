<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe\Transport;

use RuntimeException;

/** SEFAZ could not be heard from: why, in the terms the classifier needs. */
final class TransportFailure extends RuntimeException
{
    public const TIMEOUT = 'TIMEOUT';
    public const UNREACHABLE = 'UNREACHABLE';
    public const TLS_REFUSED = 'TLS_REFUSED';
    public const HTTP_STATUS = 'HTTP_STATUS';

    public function __construct(
        public readonly string $kind,
        public readonly ?int $httpStatus = null,
        string $message = '',
    ) {
        parent::__construct($message !== '' ? $message : $kind);
    }
}
