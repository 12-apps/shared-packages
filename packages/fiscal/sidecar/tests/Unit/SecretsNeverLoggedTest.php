<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Tests\Support\Fixtures;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;
use Fiscal\Sidecar\Tests\Support\ServiceProcess;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;
use PHPUnit\Framework\TestCase;

/**
 * A wrong password answers AUTH, and the request log of that very call — the
 * production front controller's stderr, read back from the running process —
 * carries neither the password, nor the certificate, nor the CSC.
 */
final class SecretsNeverLoggedTest extends TestCase
{
    public function testAWrongPasswordIsAuthAndItsLogLineHoldsNoSecret(): void
    {
        $certificate = ThrowawayCertificate::create();
        $body = Fixtures::issueBody('nfce-simples', $certificate, true);
        $body['certificate']['password'] = 'wrong-' . bin2hex(random_bytes(8));
        $service = ServiceProcess::start(dirname(__DIR__, 2) . '/public/index.php');
        try {
            $answer = $service->call('POST', '/nfce/issue', $body);
            $log = $service->log('"path":"/nfce/issue"');
        } finally {
            $service->stop();
        }

        self::assertSame(401, $answer['status']);
        self::assertSame('AUTH', $answer['body']['error']['class']);
        self::assertStringNotContainsString($body['certificate']['password'], json_encode($answer['body']) ?: '');
        self::assertMatchesRegularExpression(
            '/\{"at":"[^"]+","method":"POST","path":"\/nfce\/issue","status":401,"ms":\d+,"class":"AUTH","code":null\}/',
            $log,
            'the request was logged',
        );
        self::assertSecretsAbsent($log, $body['certificate']['password'], $certificate, Fixtures::CSC['token']);
    }

    public function testNoAnswerOrLogOfAnyEndpointQuotesTheSecrets(): void
    {
        $certificate = ThrowawayCertificate::create();
        [$kernel, $log] = Fixtures::kernel(new RecordedTransport('authorization-100-authorized', 'cancel-135-registered'));
        $issue = Fixtures::issueBody('nfce-simples', $certificate, true);

        $issued = Fixtures::call($kernel, 'POST', '/nfce/issue', $issue);
        $cancelled = Fixtures::call($kernel, 'POST', '/nfce/cancel', [
            'environment' => 'homologacao',
            'certificate' => $issue['certificate'],
            'accessKey' => $issued->body['accessKey'],
            'protocol' => $issued->body['protocol'],
            'reason' => 'Customer gave up the order',
        ]);
        $wrong = Fixtures::call($kernel, 'POST', '/nfce/lookup', [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => $certificate->base64(), 'password' => 'not-' . $certificate->password],
            'accessKey' => $issued->body['accessKey'],
        ]);

        self::assertSame([200, 200, 401], [$issued->status, $cancelled->status, $wrong->status]);
        $everything = Fixtures::logText($log) . $issued->encoded() . $cancelled->encoded() . $wrong->encoded();
        self::assertSecretsAbsent($everything, $certificate->password, $certificate, Fixtures::CSC['token']);
    }

    public function testAnExpiredCertificateIsAuth(): void
    {
        $expired = ThrowawayCertificate::create(validDays: -1);
        [$kernel] = Fixtures::kernel(new RecordedTransport());

        $response = Fixtures::call($kernel, 'POST', '/nfce/issue', Fixtures::issueBody('nfce-simples', $expired, true));

        self::assertSame(401, $response->status);
        self::assertSame('AUTH', $response->body['error']['class']);
        self::assertStringContainsString('expired', $response->body['error']['message']);
    }

    public function testBytesThatAreNotAPfxAreAuth(): void
    {
        [$kernel] = Fixtures::kernel(new RecordedTransport());
        $body = Fixtures::issueBody('nfce-simples', ThrowawayCertificate::create(), true);
        $body['certificate']['pfxBase64'] = base64_encode('not a pkcs12 file at all');

        $response = Fixtures::call($kernel, 'POST', '/nfce/issue', $body);

        self::assertSame('AUTH', $response->body['error']['class']);
    }

    private static function assertSecretsAbsent(
        string $text,
        string $password,
        ThrowawayCertificate $certificate,
        string $csc,
    ): void {
        self::assertStringNotContainsString($password, $text, 'the password');
        self::assertStringNotContainsString($csc, $text, 'the CSC');
        $base64 = $certificate->base64();
        // Any 24-character stretch of the .pfx's base64 would be a leak of it.
        for ($offset = 0; $offset + 24 <= strlen($base64); $offset += 97) {
            self::assertStringNotContainsString(substr($base64, $offset, 24), $text, 'the certificate (base64)');
        }
        self::assertStringNotContainsString(substr($certificate->pfx, 40, 24), $text, 'the certificate (bytes)');
        self::assertStringNotContainsString('PRIVATE KEY', $text, 'the private key');
    }
}
