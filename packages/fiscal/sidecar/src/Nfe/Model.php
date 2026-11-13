<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

/** The two document models sped-nfe issues, by their path segment. */
enum Model: string
{
    case NFE = 'nfe';
    case NFCE = 'nfce';

    public function code(): int
    {
        return $this === self::NFE ? 55 : 65;
    }
}
