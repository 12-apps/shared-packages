<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Live;

use Fiscal\Sidecar\Http\Request;
use Fiscal\Sidecar\Kernel;
use Fiscal\Sidecar\Nfe\Transport\CurlTransport;
use Fiscal\Sidecar\RequestLog;
use Fiscal\Sidecar\Tests\Support\Fixtures;
use NFePHP\Common\TimeZoneByUF;
use PHPUnit\Framework\TestCase;

/**
 * The ticket's live acceptance, against SEFAZ HOMOLOGAÇÃO, with a real A1 of a
 * real CNPJ accredited for NFC-e in its state. It SKIPS unless all of these
 * are set (names only; values come from the operator's secret store, never a
 * file in the repository):
 *
 *   FISCAL_TEST_PFX_BASE64    the A1 .pfx, base64
 *   FISCAL_TEST_PFX_PASSWORD  its password
 *   FISCAL_TEST_CSC           the homologação CSC (token)
 *   FISCAL_TEST_CSC_ID        its id
 *   FISCAL_TEST_CNPJ          the certificate's CNPJ, the issuer
 *   FISCAL_TEST_UF            the issuer's state, e.g. SP
 *
 * Optional: FISCAL_TEST_IE (the issuer's state registration; SEFAZ checks it
 * against the CNPJ), FISCAL_TEST_MUNICIPALITY_IBGE and FISCAL_TEST_MUNICIPALITY
 * (the issuer's city, 7-digit IBGE code and name), FISCAL_TEST_TAX_REGIME
 * (SIMPLES, the default, or NORMAL, SIMPLES_EXCESS, MEI), FISCAL_TEST_SERIES
 * (default 889, a series kept for tests), and FISCAL_TEST_BASE_URL to drive a
 * RUNNING service (the compose one, say: http://fiscal:8080) instead of an
 * in-process kernel talking to SEFAZ over cURL.
 *
 * Run: vendor/bin/phpunit --testsuite live
 */
final class HomologacaoTest extends TestCase
{
    private const REQUIRED = [
        'FISCAL_TEST_PFX_BASE64',
        'FISCAL_TEST_PFX_PASSWORD',
        'FISCAL_TEST_CSC',
        'FISCAL_TEST_CSC_ID',
        'FISCAL_TEST_CNPJ',
        'FISCAL_TEST_UF',
    ];

    protected function setUp(): void
    {
        $missing = array_values(array_filter(self::REQUIRED, static fn (string $name): bool => (string) getenv($name) === ''));
        if ($missing !== []) {
            self::markTestSkipped(
                'Live SEFAZ homologação suite skipped: set ' . implode(', ', $missing)
                . ' (a real A1 of a CNPJ accredited for NFC-e, and its homologação CSC).',
            );
        }
        // The acceptance proves the trust store too: it never runs unverified.
        self::assertTrue(CurlTransport::verifiesFromEnvironment(), 'unset FISCAL_SEFAZ_TLS_VERIFY=off: the live suite runs verified');
        $base = (string) getenv('FISCAL_TEST_BASE_URL');
        if ($base !== '') {
            $health = json_decode((string) @file_get_contents(rtrim($base, '/') . '/health'), true);
            self::assertTrue($health['sefazTlsVerify'] ?? false, 'the running service must verify SEFAZ (sefazTlsVerify)');
        }
    }

    public function testAnNfceIsIssuedLookedUpAndCancelled(): void
    {
        $issued = $this->call('/nfce/issue', $this->issueBody('nfce', $this->nextNumber()));
        self::assertSame('AUTHORIZED', $issued['body']['status'] ?? null, self::why($issued));

        $looked = $this->call('/nfce/lookup', $this->keyBody($issued['body']['accessKey']));
        self::assertSame('AUTHORIZED', $looked['body']['status'] ?? null, self::why($looked));

        $cancelled = $this->call('/nfce/cancel', $this->keyBody($issued['body']['accessKey']) + [
            'protocol' => $issued['body']['protocol'],
            'reason' => 'Live acceptance test of the fiscal service',
        ]);
        self::assertSame('CANCELLED', $cancelled['body']['status'] ?? null, self::why($cancelled));

        $after = $this->call('/nfce/lookup', $this->keyBody($issued['body']['accessKey']));
        self::assertSame('CANCELLED', $after['body']['status'] ?? null, self::why($after));
    }

    public function testAnNfeIsIssuedAndCancelled(): void
    {
        $issued = $this->call('/nfe/issue', $this->issueBody('nfe', $this->nextNumber()));
        self::assertSame('AUTHORIZED', $issued['body']['status'] ?? null, self::why($issued));

        $cancelled = $this->call('/nfe/cancel', $this->keyBody($issued['body']['accessKey']) + [
            'protocol' => $issued['body']['protocol'],
            'reason' => 'Live acceptance test of the fiscal service',
        ]);
        self::assertSame('CANCELLED', $cancelled['body']['status'] ?? null, self::why($cancelled));
    }

    public function testAContingencySignatureTransmittedLaterAuthorisesTheSameKey(): void
    {
        $body = $this->issueBody('nfce', $this->nextNumber()) + ['contingency' => [
            'since' => $this->now()->modify('-5 minutes')->format(DATE_ATOM),
            'reason' => 'Live acceptance test: offline signing',
        ]];
        $signed = $this->call('/nfce/sign-contingency', $body);
        self::assertSame('SIGNED', $signed['body']['status'] ?? null, self::why($signed));

        $transmitted = $this->call('/nfce/transmit', [
            'environment' => 'homologacao',
            'certificate' => $body['certificate'],
            'signedXml' => $signed['body']['signedXml'],
        ]);
        self::assertSame('AUTHORIZED', $transmitted['body']['status'] ?? null, self::why($transmitted));
        self::assertSame($signed['body']['accessKey'], $transmitted['body']['accessKey']);

        $this->call('/nfce/cancel', $this->keyBody($transmitted['body']['accessKey']) + [
            'protocol' => $transmitted['body']['protocol'],
            'reason' => 'Live acceptance test of the fiscal service',
        ]);
    }

    public function testARangeIsInutilized(): void
    {
        $from = $this->nextNumber();
        $answer = $this->call('/inutilize', [
            'environment' => 'homologacao',
            'certificate' => $this->certificate(),
            'model' => 'nfce',
            'uf' => (string) getenv('FISCAL_TEST_UF'),
            'cnpj' => (string) getenv('FISCAL_TEST_CNPJ'),
            'year' => (int) $this->now()->format('Y'),
            'series' => $this->series(),
            'from' => $from,
            'to' => $from + 1,
            'reason' => 'Live acceptance test of the fiscal service',
        ]);

        self::assertSame('INUTILIZED', $answer['body']['status'] ?? null, self::why($answer));
    }

    public function testAWrongPasswordIsAuth(): void
    {
        $body = $this->issueBody('nfce', $this->nextNumber());
        $body['certificate']['password'] .= '-wrong';

        $answer = $this->call('/nfce/issue', $body);

        self::assertSame(401, $answer['status']);
        self::assertSame('AUTH', $answer['body']['error']['class'] ?? null);
    }

    /** @return array<string, mixed> */
    private function issueBody(string $model, int $number): array
    {
        $uf = (string) getenv('FISCAL_TEST_UF');
        $document = Fixtures::document($model === 'nfce' ? 'nfce-simples' : 'nfe-normal-company-buyer');
        $document['series'] = $this->series();
        $document['number'] = $number;
        $document['keyCode'] = str_pad((string) random_int(1, 99_999_999), 8, '0', STR_PAD_LEFT);
        $document['issuedAt'] = $this->now()->format(DATE_ATOM);
        $document['issuer']['cnpj'] = (string) getenv('FISCAL_TEST_CNPJ');
        $document['issuer']['stateRegistration'] = (string) (getenv('FISCAL_TEST_IE') ?: 'ISENTO');
        $document['issuer']['taxRegime'] = (string) (getenv('FISCAL_TEST_TAX_REGIME') ?: 'SIMPLES');
        $document['issuer']['address']['uf'] = $uf;
        $document['issuer']['address']['municipalityIbge'] = (string) (getenv('FISCAL_TEST_MUNICIPALITY_IBGE') ?: $document['issuer']['address']['municipalityIbge']);
        $document['issuer']['address']['municipalityName'] = (string) (getenv('FISCAL_TEST_MUNICIPALITY') ?: $document['issuer']['address']['municipalityName']);
        $document['technicalResponsible'] = null;
        if ($model === 'nfe') {
            // A consumer in the same state, at the counter: the simplest NF-e SEFAZ takes.
            $document['presence'] = 'IN_PERSON';
            $document['intermediary'] = null;
            $document['finalConsumer'] = true;
            $document['buyer']['document'] = ['kind' => 'CPF', 'number' => '12345678909'];
            $document['buyer']['stateRegistrationStatus'] = 'NON_CONTRIBUTOR';
            $document['buyer']['stateRegistration'] = null;
            $document['buyer']['address']['uf'] = $uf;
            $document['buyer']['address']['municipalityIbge'] = $document['issuer']['address']['municipalityIbge'];
            $document['buyer']['address']['municipalityName'] = $document['issuer']['address']['municipalityName'];
            if ($document['issuer']['taxRegime'] !== 'NORMAL') {
                $document['lines'][0]['icms'] = ['regime' => 'SIMPLES', 'origin' => 0, 'csosn' => '102'];
                $document['lines'][0]['pis'] = ['cst' => '49', 'baseCents' => 0, 'rateBp' => 0, 'amountCents' => 0];
                $document['lines'][0]['cofins'] = ['cst' => '49', 'baseCents' => 0, 'rateBp' => 0, 'amountCents' => 0];
            }
        }
        return [
            'environment' => 'homologacao',
            'certificate' => $this->certificate(),
            'csc' => $model === 'nfce' ? ['id' => (string) getenv('FISCAL_TEST_CSC_ID'), 'token' => (string) getenv('FISCAL_TEST_CSC')] : null,
            'document' => $document,
        ];
    }

    /** @return array<string, mixed> */
    private function keyBody(string $accessKey): array
    {
        return ['environment' => 'homologacao', 'certificate' => $this->certificate(), 'accessKey' => $accessKey];
    }

    /** @return array{pfxBase64: string, password: string} */
    private function certificate(): array
    {
        return ['pfxBase64' => (string) getenv('FISCAL_TEST_PFX_BASE64'), 'password' => (string) getenv('FISCAL_TEST_PFX_PASSWORD')];
    }

    private function series(): int
    {
        return (int) (getenv('FISCAL_TEST_SERIES') ?: 889);
    }

    /** A number no earlier run used: seconds since 2026, so reruns never collide. */
    private function nextNumber(): int
    {
        static $offset = 0;
        $offset += 3;
        return (time() - 1_767_225_600) % 999_000_000 + $offset;
    }

    private function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('now', new \DateTimeZone(TimeZoneByUF::get((string) getenv('FISCAL_TEST_UF'))));
    }

    /**
     * @param array<string, mixed> $body
     * @return array{status: int, body: array<string, mixed>}
     */
    private function call(string $path, array $body): array
    {
        $base = (string) getenv('FISCAL_TEST_BASE_URL');
        if ($base === '') {
            $kernel = Kernel::production(null, new RequestLog(fopen('php://stderr', 'wb') ?: null));
            $response = $kernel->handle(new Request('POST', $path, (string) json_encode($body)));
            return ['status' => $response->status, 'body' => $response->body];
        }
        $curl = curl_init(rtrim($base, '/') . $path);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => (string) json_encode($body),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
        ]);
        $answer = (string) curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        return ['status' => $status, 'body' => (array) json_decode($answer, true)];
    }

    /** @param array{status: int, body: array<string, mixed>} $answer the answer only: it never carries a secret */
    private static function why(array $answer): string
    {
        $error = $answer['body']['error'] ?? null;
        return is_array($error)
            ? "HTTP {$answer['status']} {$error['class']} {$error['code']}: {$error['message']} " . implode('; ', $error['details'])
            : "HTTP {$answer['status']}";
    }
}
