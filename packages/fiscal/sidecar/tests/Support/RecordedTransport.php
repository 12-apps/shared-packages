<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Support;

use Fiscal\Sidecar\Nfe\Transport\Transport;
use Fiscal\Sidecar\Nfe\Transport\TransportFailure;
use NFePHP\Common\Certificate;
use RuntimeException;

/**
 * Plays SEFAZ from the replies in `tests/fixtures/sefaz/`, one per call, in
 * order. A reply is the SOAP body a SEFAZ web service returns; the request's
 * own values (the access key, the signature's digest, the batch number) are
 * written into its `{{placeholders}}`, as SEFAZ echoes them. A queued
 * `TransportFailure` is thrown instead of answering.
 */
final class RecordedTransport implements Transport
{
    public const FIXTURES = __DIR__ . '/../fixtures/sefaz/';

    /** @var list<string|TransportFailure> */
    private array $queue;

    /** @var list<array{url: string, action: string, envelope: string, certificate: string}> */
    public array $sent = [];

    /** @var array<string, string> what earlier requests carried, for a reply to a later one (a lookup echoes the digest) */
    private array $seen = [];

    public function __construct(string|TransportFailure ...$replies)
    {
        $this->queue = $replies;
    }

    public function post(string $url, string $action, string $envelope, Certificate $certificate): string
    {
        $this->sent[] = ['url' => $url, 'action' => $action, 'envelope' => $envelope, 'certificate' => (string) $certificate->publicKey];
        foreach ([
            '{{accessKey}}' => ['/<chNFe>([A-Z0-9]{44})<\/chNFe>/', '/Id="NFe([A-Z0-9]{44})"/'],
            '{{digVal}}' => ['/<DigestValue>([^<]+)<\/DigestValue>/'],
            '{{idLote}}' => ['/<idLote>([0-9]+)<\/idLote>/'],
        ] as $placeholder => $patterns) {
            $value = self::first($envelope, $patterns);
            if ($value !== '') {
                $this->seen[$placeholder] = $value;
            }
        }
        $next = array_shift($this->queue);
        if ($next === null) {
            throw new RuntimeException("No recorded reply left for $action");
        }
        if ($next instanceof TransportFailure) {
            throw $next;
        }
        $reply = (string) file_get_contents(self::FIXTURES . $next . '.xml');
        return strtr($reply, $this->seen);
    }

    /** Recorded replies come from no server at all. */
    public function verifiesServer(): bool
    {
        return false;
    }

    /** @param list<string> $patterns */
    private static function first(string $text, array $patterns): string
    {
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $text, $match) === 1) {
                return $match[1];
            }
        }
        return '';
    }
}
