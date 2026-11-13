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
 * Each recorded SEFAZ reply and each way the wire can fail, sorted into the
 * issuer port's classes — and the retries that SEFAZ answers "already done",
 * settled by looking the key up rather than reported as rejections.
 */
final class ClassificationTest extends TestCase
{
    private const KEY = '35261111222333000181650010000012011482139076';

    private static ThrowawayCertificate $certificate;

    public static function setUpBeforeClass(): void
    {
        self::$certificate = ThrowawayCertificate::create();
    }

    /** @return iterable<string, array{list<string|TransportFailure>, string, ?string, int, bool}> */
    public static function nfceIssueFailures(): iterable
    {
        yield 'duplicate number, other key' => [['authorization-539-duplicate'], 'REJECTED', '539', 422, false];
        yield 'whole batch refused by schema' => [['authorization-225-batch-schema'], 'REJECTED', '225', 422, false];
        yield 'transmitter certificate expired' => [['authorization-281-certificate'], 'AUTH', '281', 401, false];
        yield 'signing certificate not ICP-Brasil (295)' => [['authorization-295-not-icp-brasil'], 'AUTH', '295', 401, false];
        yield 'SEFAZ cannot reach the transmitter LCR (286)' => [['authorization-286-revocation-list'], 'RETRYABLE', '286', 503, false];
        yield 'SEFAZ cannot reach the signing LCR (296)' => [['authorization-296-revocation-list'], 'RETRYABLE', '296', 503, false];
        yield 'service paused' => [['authorization-108-paused'], 'CONTINGENCY', '108', 503, false];
        yield 'service stopped' => [['authorization-109-stopped'], 'CONTINGENCY', '109', 503, false];
        yield 'rate limited' => [['authorization-656-rate-limited'], 'RETRYABLE', '656', 503, false];
        yield 'receipt only, no protocol yet' => [['authorization-103-receipt-only'], 'RETRYABLE', '103', 503, false];
        yield 'nothing reached SEFAZ: offline' => [[new TransportFailure(TransportFailure::NOT_SENT)], 'CONTINGENCY', null, 503, false];
        yield 'a 403 from an unverified host' => [[new TransportFailure(TransportFailure::REFUSED, 403)], 'RETRYABLE', null, 503, false];
        yield 'a 404 from verified SEFAZ: a defect' => [[new TransportFailure(TransportFailure::SEFAZ_HTTP, 404)], 'INTERNAL', null, 500, false];
        yield 'client certificate refused at TLS' => [[new TransportFailure(TransportFailure::TLS_REFUSED)], 'AUTH', null, 401, false];
        yield 'sent, no answer, and the lookup cannot reach SEFAZ: offline' => [
            [new TransportFailure(TransportFailure::NO_ANSWER), new TransportFailure(TransportFailure::NOT_SENT)],
            'CONTINGENCY', null, 503, true,
        ];
        yield 'sent, no answer, and SEFAZ never got it' => [
            [new TransportFailure(TransportFailure::NO_ANSWER), 'lookup-217-not-found'],
            'RETRYABLE', '217', 503, false,
        ];
        yield '204 for a different document under the key' => [
            ['authorization-204-duplicate', 'lookup-100-authorized'], 'REJECTED', '100', 422, false,
        ];
    }

    /** @param list<string|TransportFailure> $replies */
    #[DataProvider('nfceIssueFailures')]
    public function testAnNfceIssueFailureIsClassified(
        array $replies,
        string $class,
        ?string $code,
        int $status,
        bool $outcomeUnknown,
    ): void {
        [$kernel, $log] = Fixtures::kernel(new RecordedTransport(...$replies));

        $response = $this->issue($kernel, 'nfce');

        self::assertSame($status, $response->status, json_encode($response->body) ?: '');
        self::assertSame($class, $response->body['error']['class']);
        self::assertSame($code, $response->body['error']['code']);
        self::assertSame($outcomeUnknown, $response->body['error']['outcomeUnknown']);
        // Built and signed before it failed: the caller keeps both, the key is spoken for.
        self::assertSame(self::KEY, $response->body['error']['accessKey']);
        self::assertStringContainsString('<Signature', (string) $response->body['error']['signedXml']);
        self::assertStringContainsString("\"class\":\"$class\"", Fixtures::logText($log));
    }

    /** @return iterable<string, array{list<string|TransportFailure>, string, bool}> */
    public static function nfeIssueFailures(): iterable
    {
        yield 'nothing reached SEFAZ: an NF-e has no offline path, retry' => [[new TransportFailure(TransportFailure::NOT_SENT)], 'RETRYABLE', false];
        yield 'sent, no answer, lookup unreachable' => [
            [new TransportFailure(TransportFailure::NO_ANSWER), new TransportFailure(TransportFailure::NOT_SENT)], 'RETRYABLE', true,
        ];
        yield 'SEFAZ stopped (108): CONTINGENCY, which for model 55 means retry later' => [['authorization-108-paused'], 'CONTINGENCY', false];
    }

    /** @param list<string|TransportFailure> $replies */
    #[DataProvider('nfeIssueFailures')]
    public function testAnNfeIssueNeverGoesOfflineOnTheWire(array $replies, string $class, bool $outcomeUnknown): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport(...$replies));

        $response = $this->issue($kernel, 'nfe');

        self::assertSame($class, $response->body['error']['class']);
        self::assertSame($outcomeUnknown, $response->body['error']['outcomeUnknown']);
    }

    public function testASentIssueWithNoAnswerIsSettledByTheLookup(): void
    {
        $transport = new RecordedTransport(new TransportFailure(TransportFailure::NO_ANSWER), 'lookup-100-authorized-this-document');
        [$kernel] = Fixtures::kernel($transport);

        $response = $this->issue($kernel, 'nfce');

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame('AUTHORIZED', $response->body['status']);
        self::assertSame('135260000123456', $response->body['protocol']);
        self::assertStringContainsString('<nfeProc', $response->body['authorizedXml']);
        self::assertCount(2, $transport->sent);
        self::assertStringContainsString('NFeConsultaProtocolo4', $transport->sent[1]['url']);
    }

    public function testARetriedIssueThatSefazAlreadyAuthorisedAnswersAuthorized(): void
    {
        $transport = new RecordedTransport('authorization-204-duplicate', 'lookup-100-authorized-this-document');
        [$kernel] = Fixtures::kernel($transport);

        $response = $this->issue($kernel, 'nfce');

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame(['AUTHORIZED', '100'], [$response->body['status'], $response->body['statusCode']]);
        self::assertSame('135260000123456', $response->body['protocol']);
    }

    public function testARetriedIssueThatSefazAlreadyDeniedAnswersDenied(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('authorization-205-already-denied', 'lookup-302-denied-this-document'));

        $response = $this->issue($kernel, 'nfe');

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame(['DENIED', '302'], [$response->body['status'], $response->body['statusCode']]);
        self::assertSame('135260000123458', $response->body['protocol']);
    }

    public function testADenialOnIssueAnswersDeniedWithItsProtocol(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('authorization-302-denied'));

        $response = $this->issue($kernel, 'nfce');

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame(['DENIED', '302'], [$response->body['status'], $response->body['statusCode']]);
        self::assertStringContainsString('<nfeProc', $response->body['authorizedXml'], 'the denial is kept like an authorisation');
    }

    /** @return iterable<string, array{list<string|TransportFailure>}> */
    public static function retriedCancels(): iterable
    {
        yield 'already cancelled (218)' => [['cancel-218-already-cancelled', 'lookup-101-cancelled-with-event']];
        yield 'duplicate event (573)' => [['cancel-573-duplicate-event', 'lookup-101-cancelled-with-event']];
        yield 'sent with no answer' => [[new TransportFailure(TransportFailure::NO_ANSWER), 'lookup-101-cancelled-with-event']];
    }

    /** @param list<string|TransportFailure> $replies */
    #[DataProvider('retriedCancels')]
    public function testARetriedCancelAnswersCancelled(array $replies): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport(...$replies));

        $response = $this->cancel($kernel);

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame('CANCELLED', $response->body['status']);
        self::assertSame('135260000200001', $response->body['protocol']);
        self::assertStringContainsString('<procEventoNFe', (string) $response->body['eventXml']);
    }

    public function testACancelWithNoAnswerThatSefazDoesNotHoldIsRetryable(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport(new TransportFailure(TransportFailure::NO_ANSWER), 'lookup-100-authorized'));

        $response = $this->cancel($kernel);

        self::assertSame(['RETRYABLE', false], [$response->body['error']['class'], $response->body['error']['outcomeUnknown']]);
    }

    public function testARetriedInutilizationAnswersInutilized(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('inutilize-563-same-range'));

        $response = Fixtures::call($kernel, 'POST', '/inutilize', $this->inutilization());

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame(['INUTILIZED', '563', null], [$response->body['status'], $response->body['statusCode'], $response->body['protocol']]);
    }

    /** @return iterable<string, array{string, string, array<string, mixed>}> */
    public static function stoppedOutsideIssuing(): iterable
    {
        yield 'lookup' => ['lookup-108-paused', '/nfce/lookup', []];
        yield 'inutilize' => ['inutilize-108-paused', '/inutilize', ['inutilize' => true]];
    }

    /** @param array<string, mixed> $flags */
    #[DataProvider('stoppedOutsideIssuing')]
    public function testSefazStoppedOutsideIssuingIsOnlyRetryable(string $reply, string $path, array $flags): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport($reply));

        $body = isset($flags['inutilize']) ? $this->inutilization() : $this->keyed();
        $response = Fixtures::call($kernel, 'POST', $path, $body);

        self::assertSame(['RETRYABLE', '108'], [$response->body['error']['class'], $response->body['error']['code']]);
    }

    /** @return iterable<string, array{TransportFailure, string}> */
    public static function nonIssuingFailures(): iterable
    {
        yield 'nothing sent is only "try again" outside issuing' => [new TransportFailure(TransportFailure::NOT_SENT), 'RETRYABLE'];
        yield 'no answer' => [new TransportFailure(TransportFailure::NO_ANSWER), 'RETRYABLE'];
        yield 'TLS refused' => [new TransportFailure(TransportFailure::TLS_REFUSED), 'AUTH'];
    }

    #[DataProvider('nonIssuingFailures')]
    public function testALookupThatCannotReachSefazIsNeverContingency(TransportFailure $failure, string $class): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport($failure));

        $response = Fixtures::call($kernel, 'POST', '/nfce/lookup', $this->keyed());

        self::assertSame($class, $response->body['error']['class']);
    }

    public function testALookupRejectionKeepsItsCode(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('lookup-562-rejected'));

        $response = Fixtures::call($kernel, 'POST', '/nfce/lookup', $this->keyed());

        self::assertSame(['REJECTED', '562'], [$response->body['error']['class'], $response->body['error']['code']]);
    }

    public function testAReplyWithNoStatusIsRetryable(): void
    {
        $transport = new class implements \Fiscal\Sidecar\Nfe\Transport\Transport {
            public function post(string $url, string $action, string $envelope, \NFePHP\Common\Certificate $certificate): string
            {
                return '<html><body>Gateway</body></html>';
            }

            public function verifiesServer(): bool
            {
                return false;
            }
        };
        [$kernel] = Fixtures::kernel($transport);

        $response = $this->issue($kernel, 'nfce');

        self::assertSame('RETRYABLE', $response->body['error']['class']);
        self::assertNotNull($response->body['error']['signedXml']);
    }

    private function issue(\Fiscal\Sidecar\Kernel $kernel, string $model): \Fiscal\Sidecar\Http\Response
    {
        $fixture = $model === 'nfce' ? 'nfce-simples' : 'nfe-normal-company-buyer';
        return Fixtures::call($kernel, 'POST', "/$model/issue", Fixtures::issueBody($fixture, self::$certificate, $model === 'nfce'));
    }

    private function cancel(\Fiscal\Sidecar\Kernel $kernel): \Fiscal\Sidecar\Http\Response
    {
        return Fixtures::call($kernel, 'POST', '/nfce/cancel', $this->keyed() + [
            'protocol' => '135260000123456',
            'reason' => 'Customer gave up the order',
        ]);
    }

    /** @return array<string, mixed> */
    private function keyed(): array
    {
        return [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => self::$certificate->base64(), 'password' => self::$certificate->password],
            'accessKey' => self::KEY,
        ];
    }

    /** @return array<string, mixed> */
    private function inutilization(): array
    {
        return [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => self::$certificate->base64(), 'password' => self::$certificate->password],
            'model' => 'nfce',
            'uf' => 'SP',
            'cnpj' => '11222333000181',
            'year' => 2026,
            'series' => 1,
            'from' => 1300,
            'to' => 1305,
            'reason' => 'Numbers skipped by a register crash',
        ];
    }
}
