<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe\Transport;

use NFePHP\Common\Certificate;
use NFePHP\Common\Soap\SoapBase;
use NFePHP\Common\Soap\SoapInterface;

/**
 * sped-nfe's `Tools` speaks to a `SoapInterface`. This one builds the envelope
 * the way sped-common does and hands it to a `Transport`, so the key material
 * never reaches sped-common's temporary-folder code path, and a test can put
 * recorded SEFAZ replies behind the very same `Tools` calls.
 */
final class SoapAdapter extends SoapBase implements SoapInterface
{
    public function __construct(
        private readonly Transport $transport,
        Certificate $certificate,
    ) {
        parent::__construct($certificate);
    }

    /**
     * @param string $url
     * @param string $operation
     * @param string $action
     * @param int $soapver
     * @param array<string, string> $parameters
     * @param array<string, string> $namespaces
     * @param string $request
     * @param \SoapHeader|null $soapheader
     */
    public function send(
        $url,
        $operation = '',
        $action = '',
        $soapver = SOAP_1_2,
        $parameters = [],
        $namespaces = [],
        $request = '',
        $soapheader = null,
    ) {
        $envelope = $this->makeEnvelopeSoap($request, $namespaces, $soapver, $soapheader);
        $this->requestBody = $envelope;
        $this->responseBody = $this->transport->post((string) $url, (string) $action, $envelope, $this->certificate);
        return $this->responseBody;
    }

    /** sped-common writes key files here; this adapter never needs them. */
    public function saveTemporarilyKeyFiles()
    {
        throw new \LogicException('The fiscal service never writes key material to disk.');
    }
}
