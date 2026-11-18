<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Http\Request;
use Fiscal\Sidecar\Kernel;
use Fiscal\Sidecar\RequestLog;
use Fiscal\Sidecar\Tests\Support\Fixtures;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;
use Fiscal\Sidecar\Tests\Support\ServiceProcess;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;
use PHPUnit\Framework\TestCase;

/**
 * The launch token (FUT-4717): a service started with `FISCAL_SIDECAR_TOKEN`
 * answers nothing but `/health` without `Authorization: Bearer <token>`, and
 * the token is never in an answer or the request log.
 */
final class LaunchTokenTest extends TestCase
{
    private const TOKEN = 'launch-token-0123456789abcdef0123456789';

    /** @return array{Kernel, resource} */
    private static function guarded(): array
    {
        $log = fopen('php://memory', 'w+b');
        $kernel = new Kernel(Kernel::modules(new RecordedTransport('inutilize-102-homologated')), new RequestLog($log), self::TOKEN);
        return [$kernel, $log];
    }

    /** @return array<string, mixed> */
    private static function inutilizeBody(): array
    {
        $certificate = ThrowawayCertificate::create();
        return [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => $certificate->base64(), 'password' => $certificate->password],
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

    public function testACallWithoutTheTokenIsRefusedBeforeItIsRouted(): void
    {
        [$kernel, $log] = self::guarded();
        $body = (string) json_encode(self::inutilizeBody());
        foreach ([null, 'Bearer wrong-token-0123456789abcdef0123456789', 'Basic ' . self::TOKEN, self::TOKEN] as $authorization) {
            $answer = $kernel->handle(new Request('POST', '/inutilize', $body, $authorization));
            self::assertSame(401, $answer->status);
            self::assertSame('INVALID', $answer->body['error']['class']);
            self::assertSame('UNAUTHORIZED', $answer->body['error']['code']);
        }
        $lines = Fixtures::logText($log);
        self::assertStringNotContainsString(self::TOKEN, $lines);
        self::assertStringNotContainsString('wrong-token', $lines);
        self::assertSame(4, substr_count($lines, '"status":401'));
    }

    public function testTheRightBearerIsRoutedAndHealthNeedsNone(): void
    {
        [$kernel] = self::guarded();
        $answer = $kernel->handle(new Request('POST', '/inutilize', (string) json_encode(self::inutilizeBody()), 'Bearer ' . self::TOKEN));
        self::assertSame(200, $answer->status);
        self::assertSame('INUTILIZED', $answer->body['status']);
        self::assertSame(200, $kernel->handle(new Request('GET', '/health', ''))->status);
    }

    public function testNoTokenMeansNoCheckAndAShortTokenIsRefused(): void
    {
        $kernel = new Kernel(Kernel::modules(new RecordedTransport('inutilize-102-homologated')), new RequestLog(fopen('php://memory', 'w+b')));
        self::assertSame(200, $kernel->handle(new Request('POST', '/inutilize', (string) json_encode(self::inutilizeBody())))->status);
        $this->expectException(\InvalidArgumentException::class);
        new Kernel([], new RequestLog(fopen('php://memory', 'w+b')), 'too-short');
    }

    public function testTheProductionFrontControllerReadsTheTokenAndNeverLogsIt(): void
    {
        $service = ServiceProcess::start(dirname(__DIR__, 2) . '/public/index.php', ['FISCAL_SIDECAR_TOKEN' => self::TOKEN]);
        try {
            $refused = $service->call('POST', '/inutilize', self::inutilizeBody());
            $health = $service->call('GET', '/health');
            $wrong = $service->call('POST', '/nfce/lookup', ['accessKey' => 'x'], ['Authorization: Bearer ' . strrev(self::TOKEN)]);
            $log = $service->log('"path":"/nfce/lookup"');
        } finally {
            $service->stop();
        }
        self::assertSame(401, $refused['status']);
        self::assertSame(200, $health['status']);
        self::assertSame(401, $wrong['status']);
        self::assertStringNotContainsString(self::TOKEN, $log);
        self::assertStringNotContainsString(strrev(self::TOKEN), $log);
        self::assertStringNotContainsString(self::TOKEN, (string) json_encode([$refused, $health, $wrong]));
    }
}
