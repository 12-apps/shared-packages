<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Nfe\Credentials;
use Fiscal\Sidecar\Nfe\Transport\CurlTransport;
use Fiscal\Sidecar\Nfe\Transport\TransportFailure;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;
use Fiscal\Sidecar\Tests\Support\TlsTestServer;
use NFePHP\Common\Certificate;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The real cURL transport against a local TLS server that misbehaves on
 * purpose: what it reports must say whether the request went out.
 */
final class CurlTransportTest extends TestCase
{
    private static Certificate $client;

    public static function setUpBeforeClass(): void
    {
        $throwaway = ThrowawayCertificate::create();
        self::$client = Credentials::open(['pfx' => $throwaway->pfx, 'password' => $throwaway->password]);
    }

    public function testServerVerificationIsOnByDefault(): void
    {
        $options = (new CurlTransport())->options('https://sefaz.example/ws', 'x', '<e/>', self::$client);

        self::assertTrue($options[CURLOPT_SSL_VERIFYPEER]);
        self::assertSame(2, $options[CURLOPT_SSL_VERIFYHOST]);
        self::assertTrue(isset($options[CURLOPT_CAINFO]) || isset($options[CURLOPT_CAINFO_BLOB]), 'a trust store is set');
        $bundle = (string) ($options[CURLOPT_CAINFO_BLOB] ?? file_get_contents((string) $options[CURLOPT_CAINFO]));
        self::assertStringContainsString(
            (string) preg_replace('/^#.*\n/m', '', explode('-----END CERTIFICATE-----', (string) file_get_contents(CurlTransport::ICP_BRASIL_PEM))[0]),
            $bundle,
            'the ICP-Brasil chain is trusted',
        );
    }

    public function testOnlyTheVariableTurnsVerificationOff(): void
    {
        $previous = getenv('FISCAL_SEFAZ_TLS_VERIFY');
        try {
            putenv('FISCAL_SEFAZ_TLS_VERIFY');
            self::assertTrue(CurlTransport::fromEnvironment()->verifies());
            putenv('FISCAL_SEFAZ_TLS_VERIFY=no');
            self::assertTrue(CurlTransport::fromEnvironment()->verifies(), 'anything but "off" keeps it on');
            putenv('FISCAL_SEFAZ_TLS_VERIFY=off');
            $off = CurlTransport::fromEnvironment();
            self::assertFalse($off->verifies());
            $options = $off->options('https://sefaz.example/ws', 'x', '<e/>', self::$client);
            self::assertFalse($options[CURLOPT_SSL_VERIFYPEER]);
            self::assertSame(0, $options[CURLOPT_SSL_VERIFYHOST]);
        } finally {
            putenv($previous === false ? 'FISCAL_SEFAZ_TLS_VERIFY' : "FISCAL_SEFAZ_TLS_VERIFY=$previous");
        }
    }

    public function testTheKeyTravelsInMemory(): void
    {
        $options = (new CurlTransport())->options('https://sefaz.example/ws', 'x', '<e/>', self::$client);

        self::assertArrayHasKey(CURLOPT_SSLKEY_BLOB, $options);
        self::assertArrayNotHasKey(CURLOPT_SSLKEY, $options);
        self::assertArrayNotHasKey(CURLOPT_SSLCERT, $options);
    }

    /** @return iterable<string, array{string, bool, string}> */
    public static function servers(): iterable
    {
        yield 'a server that never accepts: nothing was sent' => ['never-accept', true, TransportFailure::NOT_SENT];
        yield 'a server certificate that does not verify: nothing was sent' => ['answer-200', false, TransportFailure::NOT_SENT];
        yield 'dropped after the upload: the outcome is unknown' => ['drop-after-upload', true, TransportFailure::NO_ANSWER];
        yield 'silent after the upload: the outcome is unknown' => ['hang-after-upload', true, TransportFailure::NO_ANSWER];
        yield 'the client certificate refused at the handshake' => ['refuse-client-cert', true, TransportFailure::TLS_REFUSED];
        yield 'a 403 from the verified host' => ['answer-403', true, TransportFailure::TLS_REFUSED];
    }

    /** @param bool $trustServer whether the transport is given the test CA */
    #[DataProvider('servers')]
    public function testTheFailureSaysWhetherTheRequestWentOut(string $mode, bool $trustServer, string $kind): void
    {
        $server = TlsTestServer::start($mode);
        try {
            $transport = new CurlTransport(1, true, $trustServer ? $server->caFile() : CurlTransport::ICP_BRASIL_PEM, 3);
            $transport->post($server->url(), 'x', str_repeat('<e/>', 100), self::$client);
            self::fail('the request succeeded');
        } catch (TransportFailure $failure) {
            self::assertSame($kind, $failure->kind, $failure->getMessage());
        } finally {
            $server->stop();
        }
    }

    public function testA403FromAnUnverifiedHostIsNotTakenAsSefazRefusingTheCertificate(): void
    {
        $server = TlsTestServer::start('answer-403');
        try {
            (new CurlTransport(1, false, null, 3))->post($server->url(), 'x', '<e/>', self::$client);
            self::fail('the request succeeded');
        } catch (TransportFailure $failure) {
            self::assertSame(TransportFailure::REFUSED, $failure->kind);
        } finally {
            $server->stop();
        }
    }

    public function testAVerifiedServerAnswers(): void
    {
        $server = TlsTestServer::start('answer-200');
        try {
            $body = (new CurlTransport(1, true, $server->caFile(), 3))->post($server->url(), 'x', '<e/>', self::$client);
        } finally {
            $server->stop();
        }

        self::assertStringContainsString('<cStat/>', $body);
    }

    public function testAProxyThatRefusesTheTunnelSentNothing(): void
    {
        $failure = CurlTransport::classify(56, 'CONNECT tunnel failed, response 403', 0, 0, 403, true);

        self::assertSame(TransportFailure::NOT_SENT, $failure?->kind);
    }
}
