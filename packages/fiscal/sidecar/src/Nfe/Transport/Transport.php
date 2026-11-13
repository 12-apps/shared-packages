<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe\Transport;

use NFePHP\Common\Certificate;

/** Posts one SOAP envelope to a SEFAZ web service over mutual TLS. */
interface Transport
{
    /**
     * @return string the response body
     * @throws TransportFailure
     */
    public function post(string $url, string $action, string $envelope, Certificate $certificate): string;
}
