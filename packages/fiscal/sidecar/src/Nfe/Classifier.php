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
 */
final class Classifier
{
    /** The certificate itself refused: the transmitter's (280–286), the signature's (290–294), and a CNPJ-base mismatch (213). */
    private const AUTH = [
        '213', '280', '281', '282', '283', '284', '285', '286', '290', '291', '292', '293', '294',
    ];
    /** Service stopped, momentarily or with no forecast: go offline. */
    private const CONTINGENCY = ['108', '109'];
    /** Receipt only, batch still processing, rate-limited, uncatalogued error: ask again. */
    private const RETRYABLE = ['103', '105', '656', '999'];

    public static function fromStatus(string $status, string $reason, SefazReply $reply): ServiceError
    {
        $class = match (true) {
            in_array($status, self::AUTH, true) => ErrorClass::AUTH,
            in_array($status, self::CONTINGENCY, true) => ErrorClass::CONTINGENCY,
            in_array($status, self::RETRYABLE, true) => ErrorClass::RETRYABLE,
            default => ErrorClass::REJECTED,
        };
        return new ServiceError($class, "SEFAZ [$status] $reason", $status, [], null, null, $reply->raw);
    }

    /**
     * @param bool $issuing an authorisation request: SEFAZ unreachable means
     *   contingency there, and only "try again" anywhere else
     */
    public static function fromTransport(TransportFailure $failure, bool $issuing): ServiceError
    {
        return match ($failure->kind) {
            TransportFailure::TLS_REFUSED => new ServiceError(
                ErrorClass::AUTH,
                'SEFAZ refused the client certificate at the TLS handshake.',
            ),
            TransportFailure::TIMEOUT => new ServiceError(
                ErrorClass::RETRYABLE,
                'SEFAZ did not answer in time; the outcome is unknown, so look the key up before issuing again.',
            ),
            default => new ServiceError(
                $issuing ? ErrorClass::CONTINGENCY : ErrorClass::RETRYABLE,
                'SEFAZ is unreachable (' . $failure->getMessage() . ').',
            ),
        };
    }
}
