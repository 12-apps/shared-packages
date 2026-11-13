<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Nfe\Transport\TransportFailure;
use Fiscal\Sidecar\Tests\Support\Fixtures;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Each recorded SEFAZ reply and each way the wire can fail, through
 * `/nfce/issue`, sorted into the issuer port's classes.
 */
final class ClassificationTest extends TestCase
{
    private static ThrowawayCertificate $certificate;

    public static function setUpBeforeClass(): void
    {
        self::$certificate = ThrowawayCertificate::create();
    }

    /** @return iterable<string, array{string|TransportFailure, string, ?string, int}> */
    public static function issueOutcomes(): iterable
    {
        yield 'duplicate number, other key' => ['authorization-539-duplicate', 'REJECTED', '539', 422];
        yield 'use denied: the number is spent' => ['authorization-302-denied', 'REJECTED', '302', 422];
        yield 'whole batch refused by schema' => ['authorization-225-batch-schema', 'REJECTED', '225', 422];
        yield 'transmitter certificate expired' => ['authorization-281-certificate', 'AUTH', '281', 401];
        yield 'service paused' => ['authorization-108-paused', 'CONTINGENCY', '108', 503];
        yield 'service stopped' => ['authorization-109-stopped', 'CONTINGENCY', '109', 503];
        yield 'rate limited' => ['authorization-656-rate-limited', 'RETRYABLE', '656', 503];
        yield 'receipt only, no protocol yet' => ['authorization-103-receipt-only', 'RETRYABLE', '103', 503];
        yield 'timeout: outcome unknown' => [new TransportFailure(TransportFailure::TIMEOUT), 'RETRYABLE', null, 503];
        yield 'unreachable' => [new TransportFailure(TransportFailure::UNREACHABLE), 'CONTINGENCY', null, 503];
        yield 'HTTP 503 from SEFAZ' => [new TransportFailure(TransportFailure::HTTP_STATUS, 503), 'CONTINGENCY', null, 503];
        yield 'client certificate refused at TLS' => [new TransportFailure(TransportFailure::TLS_REFUSED, 403), 'AUTH', null, 401];
    }

    #[DataProvider('issueOutcomes')]
    public function testIssueClassifiesTheOutcome(string|TransportFailure $reply, string $class, ?string $code, int $status): void
    {
        [$kernel, $log] = Fixtures::kernel(new RecordedTransport($reply));

        $response = Fixtures::call($kernel, 'POST', '/nfce/issue', Fixtures::issueBody('nfce-simples', self::$certificate, true));

        self::assertSame($status, $response->status);
        self::assertSame($class, $response->body['error']['class']);
        self::assertSame($code, $response->body['error']['code']);
        // Built and signed before it failed: the caller keeps both, the key is spoken for.
        self::assertSame('35261111222333000181650010000012011482139076', $response->body['error']['accessKey']);
        self::assertStringContainsString('<Signature', (string) $response->body['error']['signedXml']);
        if (is_string($reply)) {
            self::assertStringContainsString('<cStat>', (string) $response->body['error']['sefazReply']);
        }
        self::assertStringContainsString("\"class\":\"$class\"", Fixtures::logText($log));
    }

    /** @return iterable<string, array{TransportFailure, string}> */
    public static function nonIssuingFailures(): iterable
    {
        yield 'unreachable is only "try again" outside issuing' => [new TransportFailure(TransportFailure::UNREACHABLE), 'RETRYABLE'];
        yield 'timeout' => [new TransportFailure(TransportFailure::TIMEOUT), 'RETRYABLE'];
        yield 'TLS refused' => [new TransportFailure(TransportFailure::TLS_REFUSED, 403), 'AUTH'];
    }

    #[DataProvider('nonIssuingFailures')]
    public function testALookupThatCannotReachSefazIsNeverContingency(TransportFailure $failure, string $class): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport($failure));

        $response = Fixtures::call($kernel, 'POST', '/nfce/lookup', [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => self::$certificate->base64(), 'password' => self::$certificate->password],
            'accessKey' => '35261111222333000181650010000012011482139076',
        ]);

        self::assertSame($class, $response->body['error']['class']);
    }

    public function testALookupRejectionKeepsItsCode(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('lookup-562-rejected'));

        $response = Fixtures::call($kernel, 'POST', '/nfce/lookup', [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => self::$certificate->base64(), 'password' => self::$certificate->password],
            'accessKey' => '35261111222333000181650010000012011482139076',
        ]);

        self::assertSame(['REJECTED', '562'], [$response->body['error']['class'], $response->body['error']['code']]);
    }

    public function testAReplyWithNoStatusIsRetryable(): void
    {
        $transport = new class implements \Fiscal\Sidecar\Nfe\Transport\Transport {
            public function post(string $url, string $action, string $envelope, \NFePHP\Common\Certificate $certificate): string
            {
                return '<html><body>Gateway</body></html>';
            }
        };
        [$kernel] = Fixtures::kernel($transport);

        $response = Fixtures::call($kernel, 'POST', '/nfce/issue', Fixtures::issueBody('nfce-simples', self::$certificate, true));

        self::assertSame('RETRYABLE', $response->body['error']['class']);
        self::assertNotNull($response->body['error']['signedXml']);
    }
}
