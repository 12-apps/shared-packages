<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use DOMDocument;
use DOMXPath;
use Fiscal\Sidecar\Nfe\Credentials;
use Fiscal\Sidecar\Nfe\DocumentMapper;
use Fiscal\Sidecar\Nfe\Model;
use Fiscal\Sidecar\Nfe\NfeModule;
use Fiscal\Sidecar\Nfe\Sefaz;
use Fiscal\Sidecar\ServiceError;
use Fiscal\Sidecar\Tests\Support\Fixtures;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;
use PHPUnit\Framework\TestCase;

/**
 * The neutral shape → sped-nfe's Make → the XML, signed with a throwaway
 * certificate and validated against the schema package's own XSD
 * (`nfe_v4.00.xsd` of PL_010_V1.30, Pacote de Liberação 010f).
 */
final class DocumentMapperTest extends TestCase
{
    private const XSD = __DIR__ . '/../../vendor/nfephp-org/sped-nfe/schemes/' . NfeModule::SCHEMES . '/nfe_v4.00.xsd';

    private static ThrowawayCertificate $certificate;

    public static function setUpBeforeClass(): void
    {
        self::$certificate = ThrowawayCertificate::create();
    }

    public function testAnNfceOfASimplesIssuerMapsEveryTagItCarries(): void
    {
        $xml = $this->signed('nfce-simples', Model::NFCE);
        $x = self::xpath($xml);

        self::assertXsdValid($xml);
        self::assertSame('65', $x('//n:ide/n:mod'));
        self::assertSame('48213907', $x('//n:ide/n:cNF'));
        self::assertSame('4', $x('//n:ide/n:tpImp'));
        self::assertSame('1', $x('//n:ide/n:tpEmis'));
        self::assertSame('1', $x('//n:ide/n:indFinal'));
        self::assertSame('', $x('//n:ide/n:indIntermed'), 'no indIntermed at the counter');
        self::assertSame('1', $x('//n:emit/n:CRT'));
        self::assertSame('102', $x('//n:det[@nItem="1"]//n:ICMSSN102/n:CSOSN'));
        self::assertSame('19.9500000000', $x('//n:det[@nItem="1"]/n:prod/n:vUnCom'));
        self::assertSame('2.0000', $x('//n:det[@nItem="1"]/n:prod/n:qCom'));
        self::assertSame('5.23', $x('//n:det[@nItem="1"]/n:imposto/n:vTotTrib'));
        self::assertSame('1.00', $x('//n:det[@nItem="2"]/n:prod/n:vDesc'));
        self::assertSame('Fresh', $x('//n:det[@nItem="2"]/n:infAdProd'));
        self::assertSame('49', $x('//n:det[@nItem="1"]//n:PISOutr/n:CST'));
        // IBS/CBS, as the engine's figures say: rates in percent, four decimals.
        self::assertSame('39.90', $x('//n:det[@nItem="1"]//n:gIBSCBS/n:vBC'));
        self::assertSame('0.9000', $x('//n:det[@nItem="1"]//n:gCBS/n:pCBS'));
        self::assertSame('0.36', $x('//n:det[@nItem="1"]//n:gCBS/n:vCBS'));
        self::assertSame('0.1000', $x('//n:det[@nItem="1"]//n:gIBSUF/n:pIBSUF'));
        self::assertSame('200047', $x('//n:det[@nItem="2"]//n:IBSCBS/n:cClassTrib'));
        self::assertSame('40.0000', $x('//n:det[@nItem="2"]//n:gCBS/n:gRed/n:pRedAliq'));
        self::assertSame('0.5400', $x('//n:det[@nItem="2"]//n:gCBS/n:gRed/n:pAliqEfet'));
        // Payments: a non-integrated credit card with its brand, and cash; the change.
        self::assertSame('03', $x('//n:detPag[1]/n:tPag'));
        self::assertSame('2', $x('//n:detPag[1]/n:card/n:tpIntegra'));
        self::assertSame('01', $x('//n:detPag[1]/n:card/n:tBand'));
        self::assertSame('01', $x('//n:detPag[2]/n:tPag'));
        self::assertSame('4.10', $x('//n:pag/n:vTroco'));
        self::assertSame('9', $x('//n:transp/n:modFrete'));
        self::assertSame('Thank you', $x('//n:infAdic/n:infCpl'));
        self::assertSame('Support Desk', $x('//n:infRespTec/n:xContato'));
        self::assertNotSame('', $x('//n:infNFeSupl/n:qrCode'), 'an NFC-e carries its QR code');
    }

    public function testAnNfeWithACompanyBuyerAndAnIntermediary(): void
    {
        $xml = $this->signed('nfe-normal-company-buyer', Model::NFE);
        $x = self::xpath($xml);

        self::assertXsdValid($xml);
        self::assertSame('55', $x('//n:ide/n:mod'));
        self::assertSame('1', $x('//n:ide/n:tpImp'));
        self::assertSame('2', $x('//n:ide/n:indPres'));
        self::assertSame('1', $x('//n:ide/n:indIntermed'));
        self::assertSame('11444777000161', $x('//n:infIntermed/n:CNPJ'));
        self::assertSame('11444777000161', $x('//n:dest/n:CNPJ'));
        self::assertSame('1', $x('//n:dest/n:indIEDest'));
        self::assertSame(
            'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
            $x('//n:dest/n:xNome'),
            'homologacao replaces the buyer name, as SEFAZ requires',
        );
        self::assertSame('3', $x('//n:emit/n:CRT'));
        self::assertSame('3.5000', $x('//n:det/n:prod/n:qCom'));
        self::assertSame('100.0000000000', $x('//n:det/n:prod/n:vUnCom'));
        self::assertSame('7891000100103', $x('//n:det/n:prod/n:cEAN'));
        self::assertSame('63.00', $x('//n:det//n:ICMS00/n:vICMS'));
        self::assertSame('18.0000', $x('//n:det//n:ICMS00/n:pICMS'));
        self::assertSame('1.6500', $x('//n:det//n:PISAliq/n:pPIS'));
        self::assertSame('26.60', $x('//n:det//n:COFINSAliq/n:vCOFINS'));
        self::assertSame('15', $x('//n:detPag/n:tPag'));
        self::assertSame('0', $x('//n:transp/n:modFrete'));
    }

    public function testAnOfflineNfceCarriesTheContingencyEntry(): void
    {
        $contingency = ['since' => '2026-11-20T12:10:00-03:00', 'reason' => 'SEFAZ unreachable from the store'];
        $xml = $this->signed('nfce-simples', Model::NFCE, $contingency);
        $x = self::xpath($xml);

        self::assertXsdValid($xml);
        self::assertSame('9', $x('//n:ide/n:tpEmis'));
        self::assertSame($contingency['since'], $x('//n:ide/n:dhCont'));
        self::assertSame($contingency['reason'], $x('//n:ide/n:xJust'));
    }

    public function testTheSameDocumentAlwaysYieldsTheSameAccessKey(): void
    {
        $document = Fixtures::document('nfce-simples');

        $first = (new DocumentMapper())->build($document, Model::NFCE, 2);
        $second = (new DocumentMapper())->build($document, Model::NFCE, 2);

        self::assertSame($first['accessKey'], $second['accessKey'], 'cNF is the caller\'s, so a retry keeps the key');
    }

    public function testTheXsdCheckIsRealItRefusesABrokenDocument(): void
    {
        $xml = $this->signed('nfce-simples', Model::NFCE);
        $broken = str_replace('<NCM>21069090</NCM>', '<NCM>2106909X</NCM>', $xml);

        self::assertNotSame($xml, $broken);
        self::assertFalse(self::xsdValid($broken));
    }

    public function testWhatOnlyTheXsdRefusesIsInvalidAndNeverSent(): void
    {
        $transport = new RecordedTransport();
        [$kernel] = Fixtures::kernel($transport);
        $body = Fixtures::issueBody('nfce-simples', self::$certificate, true);
        // The JSON schema takes any CFOP of four digits from 1 to 7; the layout has
        // no CFOP starting with 4, and its XSD says so.
        $body['document']['lines'][0]['cfop'] = '4102';

        $response = Fixtures::call($kernel, 'POST', '/nfce/issue', $body);

        self::assertSame(400, $response->status);
        self::assertSame('INVALID', $response->body['error']['class']);
        self::assertSame([], $transport->sent, 'SEFAZ never sees a document the XSD refuses');
    }

    public function testAMalformedEnvelopeIsInvalidBeforeAnythingIsBuilt(): void
    {
        $this->expectException(ServiceError::class);
        (new DocumentMapper())->build(['lines' => []] + Fixtures::document('nfce-simples'), Model::NFCE, 2);
    }

    /** @param array{since: string, reason: string}|null $contingency */
    private function signed(string $fixture, Model $model, ?array $contingency = null): string
    {
        $document = Fixtures::document($fixture);
        $built = (new DocumentMapper())->build($document, $model, 2, $contingency);
        $tools = Sefaz::tools(
            new RecordedTransport(),
            Credentials::open(['pfx' => self::$certificate->pfx, 'password' => self::$certificate->password]),
            $model,
            2,
            $document['issuer']['address']['uf'],
            $document['issuer']['cnpj'],
            $model === Model::NFCE ? Fixtures::CSC : null,
        );
        return $tools->signNFe($built['xml']);
    }

    /** @return callable(string): string */
    private static function xpath(string $xml): callable
    {
        $dom = new DOMDocument();
        $dom->loadXML($xml);
        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('n', 'http://www.portalfiscal.inf.br/nfe');
        return static function (string $query) use ($xpath): string {
            $node = $xpath->query($query)?->item(0);
            return $node === null ? '' : (string) $node->nodeValue;
        };
    }

    private static function assertXsdValid(string $xml): void
    {
        self::assertFileExists(self::XSD);
        self::assertTrue(self::xsdValid($xml), 'the signed XML is valid against ' . NfeModule::SCHEMES);
    }

    private static function xsdValid(string $xml): bool
    {
        $dom = new DOMDocument();
        $dom->loadXML($xml);
        $previous = libxml_use_internal_errors(true);
        $valid = $dom->schemaValidate(self::XSD);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        return $valid;
    }
}
