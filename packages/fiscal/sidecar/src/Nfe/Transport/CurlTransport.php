<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe\Transport;

use NFePHP\Common\Certificate;

/**
 * cURL with the client certificate handed over IN MEMORY (`CURLOPT_SSLCERT_BLOB`,
 * `CURLOPT_SSLKEY_BLOB`). sped-common's own SoapCurl writes the private key to
 * a temporary folder to give cURL a path; this transport is why the service
 * writes nothing to disk.
 */
final class CurlTransport implements Transport
{
    public function __construct(
        private readonly int $timeoutSeconds = 30,
        private readonly ?string $caBundle = null,
    ) {
    }

    /**
     * `FISCAL_SEFAZ_TIMEOUT_SECONDS` (default 30) and `FISCAL_SEFAZ_CA_BUNDLE`, a
     * PEM of the ICP-Brasil roots: when set, SEFAZ's server certificate is
     * verified against it; unset, it is not (sped-nfe's own default).
     */
    public static function fromEnvironment(): self
    {
        $timeout = (int) (getenv('FISCAL_SEFAZ_TIMEOUT_SECONDS') ?: 30);
        $ca = getenv('FISCAL_SEFAZ_CA_BUNDLE');
        return new self($timeout > 0 ? $timeout : 30, is_string($ca) && $ca !== '' ? $ca : null);
    }

    public function post(string $url, string $action, string $envelope, Certificate $certificate): string
    {
        $curl = curl_init();
        curl_setopt_array($curl, [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $envelope,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/soap+xml;charset=utf-8;' . ($action !== '' ? "action=$action" : ''),
                'Content-Length: ' . strlen($envelope),
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
            CURLOPT_CONNECTTIMEOUT => $this->timeoutSeconds,
            CURLOPT_TIMEOUT => $this->timeoutSeconds + 20,
            CURLOPT_SSLVERSION => CURL_SSLVERSION_TLSv1_2,
            CURLOPT_SSLCERTTYPE => 'PEM',
            CURLOPT_SSLCERT_BLOB => (string) $certificate,
            CURLOPT_SSLKEYTYPE => 'PEM',
            CURLOPT_SSLKEY_BLOB => (string) $certificate->privateKey,
            CURLOPT_SSL_VERIFYPEER => $this->caBundle !== null,
            CURLOPT_SSL_VERIFYHOST => $this->caBundle !== null ? 2 : 0,
        ]);
        if ($this->caBundle !== null) {
            curl_setopt($curl, CURLOPT_CAINFO, $this->caBundle);
        }
        $body = curl_exec($curl);
        $errno = curl_errno($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        if ($errno !== 0 || !is_string($body)) {
            throw new TransportFailure(self::kindOf($errno), null, "cURL error $errno");
        }
        if ($status === 403 || $status === 495 || $status === 496) {
            throw new TransportFailure(TransportFailure::TLS_REFUSED, $status);
        }
        if ($status !== 200) {
            throw new TransportFailure(TransportFailure::HTTP_STATUS, $status, "HTTP $status");
        }
        return trim($body);
    }

    private static function kindOf(int $errno): string
    {
        return match ($errno) {
            CURLE_OPERATION_TIMEDOUT => TransportFailure::TIMEOUT,
            CURLE_SSL_CERTPROBLEM => TransportFailure::TLS_REFUSED,
            default => TransportFailure::UNREACHABLE,
        };
    }
}
