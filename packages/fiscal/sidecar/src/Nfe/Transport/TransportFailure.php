<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe\Transport;

use RuntimeException;

/**
 * SEFAZ could not be heard from, sorted by the one question that decides what
 * a caller may do next: did the request go out?
 *
 * - NOT_SENT: nothing reached SEFAZ (no route, a connect timeout, a refused
 *   proxy tunnel, a server certificate that does not verify). Safe to send
 *   again, or for an NFC-e to go offline.
 * - NO_ANSWER: the request went out and no answer came back (an empty reply,
 *   a receive error or a timeout after the upload, HTTP 5xx). SEFAZ may have
 *   processed it: the outcome is unknown until the key is looked up.
 * - TLS_REFUSED: the client certificate was refused (a TLS alert, a local key
 *   cURL cannot use, or an HTTP 403 from a VERIFIED SEFAZ host).
 * - REFUSED: an HTTP answer that is not SEFAZ's (a 4xx, or a 403 from a host
 *   whose certificate was not verified): nothing was processed; try again.
 * - SEFAZ_HTTP: a 4xx other than 403, 408 and 429 from the VERIFIED SEFAZ host
 *   (a 404 or 405: the web-service address or the request is wrong). The same
 *   request gets the same answer, so it is a defect, never a retry.
 */
final class TransportFailure extends RuntimeException
{
    public const NOT_SENT = 'NOT_SENT';
    public const NO_ANSWER = 'NO_ANSWER';
    public const TLS_REFUSED = 'TLS_REFUSED';
    public const REFUSED = 'REFUSED';
    public const SEFAZ_HTTP = 'SEFAZ_HTTP';

    public function __construct(
        public readonly string $kind,
        public readonly ?int $httpStatus = null,
        string $message = '',
    ) {
        parent::__construct($message !== '' ? $message : $kind);
    }
}
