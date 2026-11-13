<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Nfe\Credentials;
use Fiscal\Sidecar\Nfe\Transport\SoapAdapter;
use Fiscal\Sidecar\Tests\Support\Fixtures;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;
use Fiscal\Sidecar\Tests\Support\ServiceProcess;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;
use NFePHP\Common\Soap\SoapCurl;
use PHPUnit\Framework\TestCase;

/**
 * The service keeps nothing between calls and writes nothing to disk.
 */
final class StatelessnessTest extends TestCase
{
    public function testEveryEndpointLeavesItsTmpdirAndItsFolderUntouched(): void
    {
        $certificate = ThrowawayCertificate::create();
        $before = self::serviceFiles();
        $service = ServiceProcess::start(dirname(__DIR__) . '/Support/recorded-server.php');
        try {
            $credentials = ['pfxBase64' => $certificate->base64(), 'password' => $certificate->password];
            $issued = $service->call('POST', '/nfce/issue', Fixtures::issueBody('nfce-simples', $certificate, true));
            $calls = [
                $issued['status'],
                $service->call('POST', '/nfce/lookup', ['environment' => 'homologacao', 'certificate' => $credentials, 'accessKey' => $issued['body']['accessKey']])['status'],
                $service->call('POST', '/nfce/cancel', [
                    'environment' => 'homologacao',
                    'certificate' => $credentials,
                    'accessKey' => $issued['body']['accessKey'],
                    'protocol' => $issued['body']['protocol'],
                    'reason' => 'Customer gave up the order',
                ])['status'],
                $service->call('POST', '/inutilize', [
                    'environment' => 'homologacao', 'certificate' => $credentials, 'model' => 'nfce', 'uf' => 'SP',
                    'cnpj' => '11222333000181', 'year' => 2026, 'series' => 1, 'from' => 1300, 'to' => 1305,
                    'reason' => 'Numbers skipped by a register crash',
                ])['status'],
            ];
            $tmp = $service->tmpFiles();
        } finally {
            $service->stop();
        }

        self::assertSame([200, 200, 200, 200], $calls);
        self::assertSame([], $tmp, 'nothing written to TMPDIR');
        self::assertSame($before, self::serviceFiles(), 'nothing written beside the service');
    }

    public function testTheCheckWouldCatchTheLibrarysOwnTransportWritingTheKey(): void
    {
        // The positive control: sped-common's default SoapCurl does write the
        // private key to a temporary folder before every request. That is the
        // write the test above would see, and why the service has its own transport.
        $folder = sys_get_temp_dir() . '/fiscal-sidecar-control-' . bin2hex(random_bytes(6));
        $certificate = ThrowawayCertificate::create();
        $opened = Credentials::open(['pfx' => $certificate->pfx, 'password' => $certificate->password]);
        $soap = new SoapCurl($opened);
        $soap->setTemporaryFolder($folder);
        $soap->saveTemporarilyKeyFiles();
        $written = glob("$folder/certs/*.pem") ?: [];
        exec('rm -rf ' . escapeshellarg($folder));

        self::assertCount(3, $written);
        $this->expectException(\LogicException::class);
        (new SoapAdapter(new RecordedTransport(), $opened))->saveTemporarilyKeyFiles();
    }

    public function testEachCallSignsWithItsOwnCertificateAndNoneOutlivesIt(): void
    {
        $first = ThrowawayCertificate::create('11222333000181');
        $second = ThrowawayCertificate::create('11444777000161');
        $transport = new RecordedTransport('authorization-100-authorized', 'authorization-100-authorized');
        [$kernel] = Fixtures::kernel($transport);

        $a = Fixtures::call($kernel, 'POST', '/nfce/issue', Fixtures::issueBody('nfce-simples', $first, true));
        $b = Fixtures::call($kernel, 'POST', '/nfce/issue', Fixtures::issueBody('nfce-simples', $second, true));
        $wrong = Fixtures::issueBody('nfce-simples', $first, true);
        $wrong['certificate']['password'] = 'not-the-password';
        $c = Fixtures::call($kernel, 'POST', '/nfce/issue', $wrong);

        self::assertSame([200, 200, 401], [$a->status, $b->status, $c->status], 'a good call opens nothing for a later bad one');
        self::assertNotSame($transport->sent[0]['certificate'], $transport->sent[1]['certificate']);
        self::assertStringContainsString(self::certificateBody($first), $a->body['signedXml']);
        self::assertStringContainsString(self::certificateBody($second), $b->body['signedXml']);
        self::assertCount(2, $transport->sent, 'the refused call never reached SEFAZ');
    }

    public function testNoServiceClassHoldsStaticState(): void
    {
        $holders = [];
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(dirname(__DIR__, 2) . '/src'));
        foreach ($files as $file) {
            if (!str_ends_with((string) $file, '.php')) {
                continue;
            }
            $class = 'Fiscal\\Sidecar\\' . str_replace(['/', '.php'], ['\\', ''], substr((string) $file, strlen(dirname(__DIR__, 2) . '/src/')));
            $reflection = new \ReflectionClass($class);
            foreach ($reflection->getProperties(\ReflectionProperty::IS_STATIC) as $property) {
                $holders[] = "$class::\${$property->getName()}";
            }
        }

        self::assertSame([], $holders);
    }

    private static function certificateBody(ThrowawayCertificate $certificate): string
    {
        $opened = Credentials::open(['pfx' => $certificate->pfx, 'password' => $certificate->password]);
        $pem = (string) $opened->publicKey;
        return substr(preg_replace('/-----[^-]+-----|\s/', '', $pem) ?? '', 0, 64);
    }

    /** @return list<string> the files of the service, vendor and test caches aside */
    private static function serviceFiles(): array
    {
        $root = dirname(__DIR__, 2);
        $files = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            $relative = substr((string) $file, strlen($root) + 1);
            if (!str_starts_with($relative, 'vendor/') && !str_starts_with($relative, '.phpunit.cache/')) {
                $files[] = $relative . ':' . filesize((string) $file);
            }
        }
        sort($files);
        return $files;
    }
}
