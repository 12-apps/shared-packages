<?php

declare(strict_types=1);

namespace Fiscal\Sidecar;

/**
 * How a failed call is classified. The first four are the issuer port's own
 * classes; INVALID is a malformed request, which no retry fixes.
 */
enum ErrorClass: string
{
    case REJECTED = 'REJECTED';
    case RETRYABLE = 'RETRYABLE';
    case CONTINGENCY = 'CONTINGENCY';
    case AUTH = 'AUTH';
    case INVALID = 'INVALID';

    public function httpStatus(): int
    {
        return match ($this) {
            self::INVALID => 400,
            self::AUTH => 401,
            self::REJECTED => 422,
            self::RETRYABLE, self::CONTINGENCY => 503,
        };
    }
}
