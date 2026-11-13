<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Tests\Support\Fixtures;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Every endpoint, end to end in-process, against recorded SEFAZ replies. */
final class EndpointsTest extends TestCase
{
    private static ThrowawayCertificate $certificate;

    public static function setUpBeforeClass(): void
    {
        self::$certificate = ThrowawayCertificate::create();
    }

    public function testTheRouteTableIsExactlyTheTicketsEndpoints(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport());

        self::assertSame([
            'GET /health',
            'POST /inutilize',
            'POST /nfce/cancel',
            'POST /nfce/issue',
            'POST /nfce/lookup',
            'POST /nfce/sign-contingency',
            'POST /nfce/transmit',
            'POST /nfe/cancel',
            'POST /nfe/issue',
            'POST /nfe/lookup',
            'POST /nfe/transmit',
        ], $kernel->router()->table());
    }

    public function testHealthNamesTheLibraryAndTheSchemaPackage(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport());

        $response = Fixtures::call($kernel, 'GET', '/health');

        self::assertSame(200, $response->status);
        self::assertSame('ok', $response->body['status']);
        self::assertSame('v5.2.9', $response->body['libraries']['nfephp-org/sped-nfe']);
        self::assertSame('PL_010_V1.30', $response->body['nfeSchemas']);
    }

    public function testAnUnknownPathIs404AndAWrongMethod405(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport());

        self::assertSame(404, Fixtures::call($kernel, 'POST', '/nfse/issue', '{}')->status);
        self::assertSame(405, Fixtures::call($kernel, 'GET', '/nfe/issue')->status);
    }

    public function testIssueAnNfceBuildsSignsTransmitsAndAnswersTheProtocol(): void
    {
        $transport = new RecordedTransport('authorization-100-authorized');
        [$kernel] = Fixtures::kernel($transport);

        $response = Fixtures::call($kernel, 'POST', '/nfce/issue', Fixtures::issueBody('nfce-simples', self::$certificate, true));

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame('AUTHORIZED', $response->body['status']);
        self::assertSame('35261111222333000181650010000012011482139076', $response->body['accessKey']);
        self::assertSame('135260000123456', $response->body['protocol']);
        self::assertSame('100', $response->body['statusCode']);
        self::assertStringContainsString('<nfeProc', $response->body['authorizedXml']);
        self::assertStringContainsString('<qrCode>', $response->body['signedXml']);
        self::assertStringContainsString('<indSinc>1</indSinc>', $transport->sent[0]['envelope']);
        self::assertStringContainsString('NFeAutorizacao4', $transport->sent[0]['url']);
    }

    public function testIssueAnNfeWithACompanyBuyer(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('authorization-120-authorized-with-warning'));

        $response = Fixtures::call($kernel, 'POST', '/nfe/issue', Fixtures::issueBody('nfe-normal-company-buyer', self::$certificate, false));

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame('AUTHORIZED', $response->body['status']);
        self::assertSame('120', $response->body['statusCode']);
        self::assertSame('55', substr($response->body['accessKey'], 20, 2));
    }

    public function testAnNfceNeedsItsCscAndAnNfeRefusesOne(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport());
        $nfce = Fixtures::issueBody('nfce-simples', self::$certificate, false);
        $nfe = Fixtures::issueBody('nfe-normal-company-buyer', self::$certificate, true);

        $withoutCsc = Fixtures::call($kernel, 'POST', '/nfce/issue', $nfce);
        $withCsc = Fixtures::call($kernel, 'POST', '/nfe/issue', $nfe);

        self::assertSame(['INVALID', 400], [$withoutCsc->body['error']['class'], $withoutCsc->status]);
        self::assertSame(['INVALID', 400], [$withCsc->body['error']['class'], $withCsc->status]);
    }

    public function testSignContingencyThenTransmitAuthorisesTheSameKey(): void
    {
        $transport = new RecordedTransport('authorization-100-authorized');
        [$kernel] = Fixtures::kernel($transport);
        $body = Fixtures::issueBody('nfce-simples', self::$certificate, true)
            + ['contingency' => ['since' => '2026-11-20T12:10:00-03:00', 'reason' => 'SEFAZ unreachable from the store']];

        $signed = Fixtures::call($kernel, 'POST', '/nfce/sign-contingency', $body);

        self::assertSame(200, $signed->status, json_encode($signed->body) ?: '');
        self::assertSame('SIGNED', $signed->body['status']);
        self::assertSame([], $transport->sent, 'signing offline sends nothing');
        self::assertStringContainsString('<tpEmis>9</tpEmis>', $signed->body['signedXml']);
        self::assertStringContainsString('<dhCont>2026-11-20T12:10:00-03:00</dhCont>', $signed->body['signedXml']);
        self::assertSame('9', substr($signed->body['accessKey'], 34, 1), 'tpEmis is part of the key');

        $transmitted = Fixtures::call($kernel, 'POST', '/nfce/transmit', [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => self::$certificate->base64(), 'password' => self::$certificate->password],
            'signedXml' => $signed->body['signedXml'],
        ]);

        self::assertSame(200, $transmitted->status, json_encode($transmitted->body) ?: '');
        self::assertSame($signed->body['accessKey'], $transmitted->body['accessKey']);
        self::assertSame($signed->body['signedXml'], $transmitted->body['signedXml'], 'transmit sends the XML as signed');
    }

    public function testTransmitRefusesAnXmlOfTheOtherModel(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('authorization-100-authorized'));
        $issued = Fixtures::call($kernel, 'POST', '/nfce/issue', Fixtures::issueBody('nfce-simples', self::$certificate, true));

        $response = Fixtures::call($kernel, 'POST', '/nfe/transmit', [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => self::$certificate->base64(), 'password' => self::$certificate->password],
            'signedXml' => $issued->body['signedXml'],
        ]);

        self::assertSame('INVALID', $response->body['error']['class']);
    }

    public function testCancelRegistersTheEvent(): void
    {
        $transport = new RecordedTransport('cancel-135-registered');
        [$kernel] = Fixtures::kernel($transport);

        $response = Fixtures::call($kernel, 'POST', '/nfce/cancel', $this->keyed([
            'protocol' => '135260000123456',
            'reason' => 'Customer gave up the order',
        ]));

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame('CANCELLED', $response->body['status']);
        self::assertSame('135260000200001', $response->body['protocol']);
        self::assertStringContainsString('<procEventoNFe', $response->body['eventXml']);
        self::assertStringContainsString('<tpEvento>110111</tpEvento>', $transport->sent[0]['envelope']);
    }

    public function testCancelOutsideTheWindowIsRejectedWithItsCode(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('cancel-501-late'));

        $response = Fixtures::call($kernel, 'POST', '/nfce/cancel', $this->keyed([
            'protocol' => '135260000123456',
            'reason' => 'Customer gave up the order',
        ]));

        self::assertSame(422, $response->status);
        self::assertSame(['REJECTED', '501'], [$response->body['error']['class'], $response->body['error']['code']]);
    }

    /** @return iterable<string, array{string, string}> */
    public static function lookups(): iterable
    {
        yield 'authorised' => ['lookup-100-authorized', 'AUTHORIZED'];
        yield 'cancelled' => ['lookup-101-cancelled', 'CANCELLED'];
        yield 'unknown to SEFAZ' => ['lookup-217-not-found', 'NOT_FOUND'];
    }

    #[DataProvider('lookups')]
    public function testLookupAnswersTheDocumentsState(string $reply, string $state): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport($reply));

        $response = Fixtures::call($kernel, 'POST', '/nfce/lookup', $this->keyed([]));

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame($state, $response->body['status']);
    }

    public function testInutilizeVoidsTheRange(): void
    {
        $transport = new RecordedTransport('inutilize-102-homologated');
        [$kernel] = Fixtures::kernel($transport);

        $response = Fixtures::call($kernel, 'POST', '/inutilize', $this->inutilization());

        self::assertSame(200, $response->status, json_encode($response->body) ?: '');
        self::assertSame('INUTILIZED', $response->body['status']);
        self::assertSame('135260000300001', $response->body['protocol']);
        self::assertStringContainsString('<nNFIni>1300</nNFIni><nNFFin>1305</nNFFin>', $transport->sent[0]['envelope']);
        self::assertStringContainsString('<ProcInutNFe', $response->body['inutilizationXml']);
    }

    public function testInutilizeOfAUsedNumberIsRejected(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport('inutilize-241-used'));

        $response = Fixtures::call($kernel, 'POST', '/inutilize', $this->inutilization());

        self::assertSame(['REJECTED', '241'], [$response->body['error']['class'], $response->body['error']['code']]);
    }

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    private function keyed(array $extra): array
    {
        return [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => self::$certificate->base64(), 'password' => self::$certificate->password],
            'accessKey' => '35261111222333000181650010000012011482139076',
        ] + $extra;
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
