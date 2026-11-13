<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use Fiscal\Sidecar\ErrorClass;
use Fiscal\Sidecar\ServiceError;
use NFePHP\Common\Certificate;
use Throwable;

/**
 * Opens the A1 handed in with the call, in memory. A wrong password, a file
 * that is not PKCS#12 or an expired certificate is AUTH, and the answer says
 * which without quoting anything it was given.
 */
final class Credentials
{
    /**
     * @param array{pfx: string, password: string} $certificate
     * @param \DateTimeImmutable|null $now the moment the validity is judged at;
     *   the current time unless a test asks for another (PHP cannot backdate a
     *   certificate, so an expired one is judged at a later moment instead)
     */
    public static function open(array $certificate, ?\DateTimeImmutable $now = null): Certificate
    {
        try {
            $opened = Certificate::readPfx($certificate['pfx'], $certificate['password']);
        } catch (Throwable) {
            self::drainOpensslErrors();
            throw new ServiceError(
                ErrorClass::AUTH,
                'The certificate could not be opened: the password is wrong or the file is not a PKCS#12 (.pfx).',
            );
        }
        if ($opened->getValidTo() < ($now ?? new \DateTimeImmutable())) {
            throw new ServiceError(
                ErrorClass::AUTH,
                'The certificate expired on ' . $opened->getValidTo()->format('Y-m-d') . '.',
            );
        }
        return $opened;
    }

    /** OpenSSL keeps a per-process error queue; a failed read must not leave one for the next call. */
    private static function drainOpensslErrors(): void
    {
        while (openssl_error_string() !== false) {
            // drain
        }
    }
}
