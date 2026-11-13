<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe\Transport;

use NFePHP\Common\Certificate;

/**
 * cURL with the client certificate handed over IN MEMORY (`CURLOPT_SSLCERT_BLOB`,
 * `CURLOPT_SSLKEY_BLOB`). sped-common's own SoapCurl writes the private key to
 * a temporary folder to give cURL a path; this transport is why the service
 * writes nothing to disk.
 *
 * SEFAZ's server certificate is VERIFIED by default, against a bundle of the
 * public (Mozilla) roots and the ICP-Brasil chain: some SEFAZ hosts present an
 * ICP-Brasil server certificate, others a public one. Unverified, anyone on the
 * path could read every document and forge SEFAZ's answers (a `100` for a
 * document never sent). `FISCAL_SEFAZ_TLS_VERIFY=off` is the only way off, and
 * `/health` says so.
 */
final class CurlTransport implements Transport
{
    /** Where the image puts the Mozilla bundle plus `docker/icp-brasil.pem` (see the Dockerfile). */
    public const IMAGE_CA_BUNDLE = '/etc/ssl/fiscal-sidecar-ca.pem';
    /** The ICP-Brasil chain committed beside the Dockerfile, for a run outside the image. */
    public const ICP_BRASIL_PEM = __DIR__ . '/../../../docker/icp-brasil.pem';

    /**
     * @param int $timeoutSeconds to connect, TLS handshake included
     * @param int|null $answerSeconds for the whole request; default 20 s more than the connect
     */
    public function __construct(
        private readonly int $timeoutSeconds = 30,
        private readonly bool $verify = true,
        private readonly ?string $caBundle = null,
        private readonly ?int $answerSeconds = null,
    ) {
    }

    /**
     * `FISCAL_SEFAZ_TIMEOUT_SECONDS` (default 30), `FISCAL_SEFAZ_TLS_VERIFY`
     * (`off` disables verification; anything else, or unset, keeps it) and
     * `FISCAL_SEFAZ_CA_BUNDLE` (a PEM path replacing the default bundle).
     */
    public static function fromEnvironment(): self
    {
        $timeout = (int) (getenv('FISCAL_SEFAZ_TIMEOUT_SECONDS') ?: 30);
        $ca = getenv('FISCAL_SEFAZ_CA_BUNDLE');
        return new self(
            $timeout > 0 ? $timeout : 30,
            self::verifiesFromEnvironment(),
            is_string($ca) && $ca !== '' ? $ca : null,
        );
    }

    public static function verifiesFromEnvironment(): bool
    {
        return strtolower(trim((string) getenv('FISCAL_SEFAZ_TLS_VERIFY'))) !== 'off';
    }

    public function verifies(): bool
    {
        return $this->verify;
    }

    public function verifiesServer(): bool
    {
        return $this->verify;
    }

    /**
     * Every cURL option of one request — public so a test can read what is set.
     *
     * @return array<int, mixed>
     */
    public function options(string $url, string $action, string $envelope, Certificate $certificate): array
    {
        $options = [
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
            CURLOPT_TIMEOUT => $this->answerSeconds ?? $this->timeoutSeconds + 20,
            CURLOPT_SSLVERSION => CURL_SSLVERSION_TLSv1_2,
            CURLOPT_SSLCERTTYPE => 'PEM',
            CURLOPT_SSLCERT_BLOB => (string) $certificate,
            CURLOPT_SSLKEYTYPE => 'PEM',
            CURLOPT_SSLKEY_BLOB => (string) $certificate->privateKey,
            CURLOPT_SSL_VERIFYPEER => $this->verify,
            CURLOPT_SSL_VERIFYHOST => $this->verify ? 2 : 0,
        ];
        if ($this->verify) {
            $options += $this->trustAnchors();
        }
        return $options;
    }

    public function post(string $url, string $action, string $envelope, Certificate $certificate): string
    {
        $curl = curl_init();
        curl_setopt_array($curl, $this->options($url, $action, $envelope, $certificate));
        $body = curl_exec($curl);
        $failure = self::classify(
            curl_errno($curl),
            curl_error($curl),
            (float) curl_getinfo($curl, CURLINFO_SIZE_UPLOAD),
            (int) curl_getinfo($curl, CURLINFO_HTTP_CODE),
            (int) curl_getinfo($curl, CURLINFO_HTTP_CONNECTCODE),
            $this->verify,
            is_string($body) ? $body : '',
        );
        curl_close($curl);
        if ($failure !== null) {
            throw $failure;
        }
        return trim((string) $body);
    }

    /**
     * What went wrong, from what cURL reports: whether the body went out
     * (`$uploaded` bytes), the error, the HTTP status, the proxy's CONNECT status.
     * `null` is a 200. `$body` is what the SERVER answered (never request data):
     * an HTTP failure quotes its IIS substatus or a short snippet of it, so a
     * 403.6 (an IP block) reads differently from a 403.7 (no client certificate).
     */
    public static function classify(
        int $errno,
        string $error,
        float $uploaded,
        int $status,
        int $proxyConnect,
        bool $verified,
        string $body = '',
    ): ?TransportFailure {
        $sent = $uploaded > 0;
        if ($errno === 0) {
            $said = 'HTTP ' . self::httpDetail($status, $body);
            return match (true) {
                $status === 200 => null,
                $status === 403 && $verified => new TransportFailure(TransportFailure::TLS_REFUSED, 403, "$said from SEFAZ"),
                $status >= 500 => new TransportFailure(TransportFailure::NO_ANSWER, $status, $said),
                $verified && $status >= 400 && !in_array($status, [408, 429], true)
                    => new TransportFailure(TransportFailure::SEFAZ_HTTP, $status, "$said from SEFAZ"),
                default => new TransportFailure(TransportFailure::REFUSED, $status, $said),
            };
        }
        $refusedCertificate = preg_match('/alert|certificate (required|unknown|revoked|expired)|bad certificate|unknown ca/i', $error) === 1;
        return match (true) {
            $proxyConnect !== 0 && $proxyConnect !== 200 => new TransportFailure(TransportFailure::NOT_SENT, null, "proxy CONNECT answered $proxyConnect"),
            $errno === CURLE_SSL_CERTPROBLEM => new TransportFailure(TransportFailure::TLS_REFUSED, null, 'cURL could not use the client certificate'),
            in_array($errno, [CURLE_SSL_CONNECT_ERROR, CURLE_RECV_ERROR], true) && $refusedCertificate
                => new TransportFailure(TransportFailure::TLS_REFUSED, null, "cURL error $errno: the client certificate was refused"),
            $errno === 60 /* CURLE_PEER_FAILED_VERIFICATION */ || $errno === 77 /* CURLE_SSL_CACERT_BADFILE */
                => new TransportFailure(TransportFailure::NOT_SENT, null, "cURL error $errno: SEFAZ's server certificate did not verify"),
            $sent && in_array($errno, [CURLE_OPERATION_TIMEDOUT, CURLE_GOT_NOTHING, CURLE_RECV_ERROR, CURLE_SEND_ERROR], true)
                => new TransportFailure(TransportFailure::NO_ANSWER, null, "cURL error $errno after the request went out"),
            default => new TransportFailure(TransportFailure::NOT_SENT, null, "cURL error $errno before the request went out"),
        };
    }

    /** `403.6`, as IIS names its substatus, or the status and the first words of the page. */
    private static function httpDetail(int $status, string $body): string
    {
        if (preg_match('/\b' . $status . '\.(\d{1,2})\b/', $body, $sub) === 1) {
            return "$status.{$sub[1]}";
        }
        $text = trim((string) preg_replace('/\s+/', ' ', strip_tags($body)));
        return $text === '' ? (string) $status : $status . ' "' . mb_substr($text, 0, 80) . '"';
    }

    /** @return array<int, string> */
    private function trustAnchors(): array
    {
        if ($this->caBundle !== null) {
            return [CURLOPT_CAINFO => $this->caBundle];
        }
        if (is_readable(self::IMAGE_CA_BUNDLE)) {
            return [CURLOPT_CAINFO => self::IMAGE_CA_BUNDLE];
        }
        // Outside the image: the system's bundle plus the committed ICP-Brasil chain, in memory.
        $system = '';
        foreach ([(string) (openssl_get_cert_locations()['default_cert_file'] ?? ''), '/etc/ssl/certs/ca-certificates.crt'] as $file) {
            if ($system === '' && $file !== '' && is_readable($file)) {
                $system = (string) file_get_contents($file);
            }
        }
        $pem = $system . "\n"
            . (string) file_get_contents(self::ICP_BRASIL_PEM);
        return [CURLOPT_CAINFO_BLOB => $pem];
    }
}
