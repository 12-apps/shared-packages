<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Http\Response;
use Fiscal\Sidecar\Http\Router;
use Fiscal\Sidecar\Kernel;
use Fiscal\Sidecar\Module;
use Fiscal\Sidecar\Nfe\DocumentMapper;
use Fiscal\Sidecar\Nfe\DocumentSchema;
use Fiscal\Sidecar\Nfe\Transport\CurlTransport;
use Fiscal\Sidecar\RequestLog;
use Fiscal\Sidecar\Tests\Support\Fixtures;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** The edges of the contract: what the service refuses, reports and ships. */
final class ContractTest extends TestCase
{
    public function testADocumentFrom2027IsRefusedByName(): void
    {
        [$kernel] = Fixtures::kernel($transport = new RecordedTransport());
        $body = Fixtures::issueBody('nfce-simples', ThrowawayCertificate::create(), true);
        $body['document']['issuedAt'] = '2027-01-01T00:00:00-03:00';

        $response = Fixtures::call($kernel, 'POST', '/nfce/issue', $body);

        self::assertSame(400, $response->status);
        self::assertSame(['INVALID', DocumentMapper::LAYOUT_LIMIT_CODE], [$response->body['error']['class'], $response->body['error']['code']]);
        self::assertSame([], $transport->sent);
    }

    public function testTheLastDayOf2026IsStillIssued(): void
    {
        $document = Fixtures::document('nfce-simples');
        $document['issuedAt'] = '2026-12-31T23:59:59-03:00';

        self::assertNotSame('', (new DocumentMapper())->build($document, \Fiscal\Sidecar\Nfe\Model::NFCE, 2)['xml']);
    }

    public function testAQuantityWithMoreThanFourDecimalsIsInvalid(): void
    {
        $document = Fixtures::document('nfce-simples');
        $document['lines'][0]['quantity'] = 1.23456;

        $this->expectExceptionMessage('does not fit the NF-e layout');
        (new DocumentMapper())->build($document, \Fiscal\Sidecar\Nfe\Model::NFCE, 2);
    }

    public function testHealthSaysWhetherSefazIsVerified(): void
    {
        $verified = new Kernel(Kernel::modules(new CurlTransport()), new RequestLog(fopen('php://memory', 'w+b')));
        $unverified = new Kernel(Kernel::modules(new CurlTransport(30, false)), new RequestLog(fopen('php://memory', 'w+b')));

        self::assertTrue(Fixtures::call($verified, 'GET', '/health')->body['sefazTlsVerify']);
        self::assertFalse(Fixtures::call($unverified, 'GET', '/health')->body['sefazTlsVerify']);
    }

    public function testAnUnexpectedFailureIsInternalAndNotRetryable(): void
    {
        $broken = new class implements Module {
            public function register(Router $router): void
            {
                $router->add('GET', '/broken', static fn (): Response => throw new \LogicException('a defect'));
            }

            public function libraries(): array
            {
                return [];
            }

            public function health(): array
            {
                return [];
            }
        };
        $log = fopen('php://memory', 'w+b');
        $kernel = new Kernel([$broken], new RequestLog($log));

        $response = Fixtures::call($kernel, 'GET', '/broken');

        self::assertSame([500, 'INTERNAL'], [$response->status, $response->body['error']['class']]);
        self::assertStringNotContainsString('a defect', Fixtures::logText($log), 'the message is not logged');
    }

    /** @return iterable<string, array{string, string}> */
    public static function mapperTables(): iterable
    {
        yield 'purpose' => ['PURPOSE', '/properties/purpose'];
        yield 'destination' => ['DESTINATION', '/properties/destination'];
        yield 'presence' => ['PRESENCE', '/properties/presence'];
        yield 'freight' => ['FREIGHT', '/properties/freight'];
        yield 'tax regime' => ['CRT', '/definitions/issuer/properties/taxRegime'];
        yield 'state registration status' => ['IE_STATUS', '/definitions/buyer/properties/stateRegistrationStatus'];
        yield 'payment method' => ['PAYMENT', '/definitions/payment/properties/method'];
    }

    #[DataProvider('mapperTables')]
    public function testEveryValueTheSchemaAcceptsHasALayoutCode(string $constant, string $pointer): void
    {
        $schema = json_decode((string) file_get_contents(DocumentSchema::PATH), true);
        $node = $schema;
        foreach (explode('/', trim($pointer, '/')) as $step) {
            $node = $node[$step];
        }
        $table = (new \ReflectionClassConstant(DocumentMapper::class, $constant))->getValue();

        $accepted = $node['enum'];
        sort($accepted);
        $mapped = array_keys($table);
        sort($mapped);
        self::assertSame($accepted, $mapped);
    }

    public function testTheDockerfileChecksTheIcpBrasilChainItShips(): void
    {
        $dockerfile = (string) file_get_contents(dirname(__DIR__, 2) . '/Dockerfile');

        self::assertSame(1, preg_match('/([0-9a-f]{64})\s+\/tmp\/icp-brasil\.pem/', $dockerfile, $match));
        self::assertSame($match[1], hash_file('sha256', CurlTransport::ICP_BRASIL_PEM));
    }
}
