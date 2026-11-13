<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use Fiscal\Sidecar\ErrorClass;
use Fiscal\Sidecar\Nfe\Transport\TransportFailure;
use Fiscal\Sidecar\ServiceError;

/**
 * SEFAZ's status codes and the transport's failures, sorted into the issuer
 * port's classes. Everything not listed is a REJECTED with its code: the
 * layout's rejection table is open-ended, and a code the service does not know
 * is still SEFAZ saying no to this document.
 *
 * The codes and their meanings are the MOC table as sped-nfe carries it,
 * `vendor/nfephp-org/sped-nfe/storage/cstat.json`.
 */
final class Classifier
{
    /**
     * The certificate itself refused: the transmitter's (280 invalid, 281
     * validity, 282 no CNPJ, 283 chain, 284 revoked, 285 not ICP-Brasil), the
     * signature's (290–295, the same six), and a CNPJ-base mismatch (213).
     */
    private const AUTH = [
        '213', '280', '281', '282', '283', '284', '285', '290', '291', '292', '293', '294', '295',
    ];
    /** Service stopped, momentarily or with no forecast. */
    private const STOPPED = ['108', '109'];
    /**
     * Ask again: a receipt only (103), a batch still processing (105), SEFAZ
     * failing to reach a revocation list for the transmitter's or the signing
     * certificate (286, 296 — SEFAZ's trouble, not the certificate's), rate
     * limiting (656), an uncatalogued error (999).
     */
    private const RETRYABLE = ['103', '105', '286', '296', '656', '999'];

    /**
     * @param bool $issuing an authorisation request: SEFAZ stopped (108, 109)
     *   means contingency there, and only "try again" anywhere else
     */
    public static function fromStatus(string $status, string $reason, SefazReply $reply, bool $issuing): ServiceError
    {
        $class = match (true) {
            in_array($status, self::AUTH, true) => ErrorClass::AUTH,
            in_array($status, self::STOPPED, true) => $issuing ? ErrorClass::CONTINGENCY : ErrorClass::RETRYABLE,
            in_array($status, self::RETRYABLE, true) => ErrorClass::RETRYABLE,
            default => ErrorClass::REJECTED,
        };
        return new ServiceError($class, "SEFAZ [$status] $reason", $status, [], null, null, $reply->raw);
    }

    /**
     * @param bool $offlineAllowed issuing an NFC-e, the one call that can go
     *   offline (`tpEmis = 9`) when nothing reached SEFAZ
     */
    public static function fromTransport(TransportFailure $failure, bool $offlineAllowed): ServiceError
    {
        return match ($failure->kind) {
            TransportFailure::TLS_REFUSED => new ServiceError(
                ErrorClass::AUTH,
                'SEFAZ refused the client certificate (' . $failure->getMessage() . ').',
            ),
            TransportFailure::NOT_SENT => new ServiceError(
                $offlineAllowed ? ErrorClass::CONTINGENCY : ErrorClass::RETRYABLE,
                'The request never reached SEFAZ (' . $failure->getMessage() . ').',
            ),
            TransportFailure::NO_ANSWER => new ServiceError(
                ErrorClass::RETRYABLE,
                'The request went out and SEFAZ did not answer (' . $failure->getMessage()
                . '); the outcome is unknown, so look the key up before sending it again.',
                outcomeUnknown: true,
            ),
            // INTERNAL rather than a new class: the issuer port's four classes plus
            // INVALID (the caller's input) and INTERNAL (this side's defect) cover it,
            // and a wrong web-service address is this side's defect.
            TransportFailure::SEFAZ_HTTP => new ServiceError(
                ErrorClass::INTERNAL,
                'SEFAZ refused the request itself (' . $failure->getMessage() . '); sending it again gets the same answer.',
            ),
            default => new ServiceError(
                ErrorClass::RETRYABLE,
                'An answer that is not SEFAZ\'s (' . $failure->getMessage() . '); nothing was processed.',
            ),
        };
    }
}
