<?php

declare(strict_types=1);

/*
 * Records the service's OWN answers, one JSON file per case, for the
 * TypeScript issuer adapter's contract suite
 * (`src/issuer/__tests__/fixtures/sidecar/`). Each case runs the real kernel
 * against one of the recorded SEFAZ replies in `tests/fixtures/sefaz/`, so the
 * TypeScript side replays exactly what this service answers.
 *
 *     php tests/Support/record-answers.php <output dir>
 *
 * The request is recorded WITHOUT its certificate and CSC: a throwaway
 * self-signed A1 signs each call and is never written anywhere. Never shipped
 * (`!sidecar/tests` in the package's `files`).
 */

use Fiscal\Sidecar\Nfe\Transport\TransportFailure;
use Fiscal\Sidecar\Tests\Support\Fixtures;
use Fiscal\Sidecar\Tests\Support\RecordedTransport;
use Fiscal\Sidecar\Tests\Support\ThrowawayCertificate;

require dirname(__DIR__) . '/bootstrap.php';

$out = $argv[1] ?? throw new InvalidArgumentException('usage: record-answers.php <output dir>');
$certificate = ThrowawayCertificate::create();
$auth = ['environment' => 'homologacao', 'certificate' => ['pfxBase64' => $certificate->base64(), 'password' => $certificate->password]];
$key = '35261111222333000181650010000012011482139076';
$nfce = Fixtures::issueBody('nfce-simples', $certificate, true);
$late = $nfce;
$late['document']['issuedAt'] = '2027-01-02T10:00:00-03:00';
$contingency = ['since' => '2026-11-20T12:10:00-03:00', 'reason' => 'SEFAZ unreachable from the store'];
$inutilization = $auth + ['model' => 'nfce', 'uf' => 'SP', 'cnpj' => '11222333000181', 'year' => 2026, 'series' => 1, 'from' => 1300, 'to' => 1305, 'reason' => 'Numbers skipped by a failed batch'];

/** @var array<string, array{string, array<string, mixed>, list<string|TransportFailure>}> $cases */
$cases = [
    'nfce-issue-authorized' => ['/nfce/issue', $nfce, ['authorization-100-authorized']],
    'nfce-issue-denied' => ['/nfce/issue', $nfce, ['authorization-302-denied']],
    'nfce-issue-rejected' => ['/nfce/issue', $nfce, ['authorization-539-duplicate']],
    'nfce-issue-retryable' => ['/nfce/issue', $nfce, ['authorization-656-rate-limited']],
    'nfce-issue-contingency' => ['/nfce/issue', $nfce, ['authorization-108-paused']],
    'nfce-issue-unanswered' => ['/nfce/issue', $nfce, [new TransportFailure(TransportFailure::NO_ANSWER), new TransportFailure(TransportFailure::NOT_SENT)]],
    'nfce-issue-auth' => ['/nfce/issue', $nfce, ['authorization-281-certificate']],
    'nfce-issue-2027' => ['/nfce/issue', $late, []],
    'nfce-sign-contingency' => ['/nfce/sign-contingency', $nfce + ['contingency' => $contingency], []],
    'nfce-cancel' => ['/nfce/cancel', $auth + ['accessKey' => $key, 'protocol' => '135260000123456', 'reason' => 'Customer gave up the order'], ['cancel-135-registered']],
    'nfce-cancel-late' => ['/nfce/cancel', $auth + ['accessKey' => $key, 'protocol' => '135260000123456', 'reason' => 'Customer gave up the order'], ['cancel-501-late']],
    'nfce-lookup-authorized' => ['/nfce/lookup', $auth + ['accessKey' => $key], ['lookup-100-authorized']],
    'nfce-lookup-not-found' => ['/nfce/lookup', $auth + ['accessKey' => $key], ['lookup-217-not-found']],
    'inutilize' => ['/inutilize', $inutilization, ['inutilize-102-homologated']],
    'inutilize-used' => ['/inutilize', $inutilization, ['inutilize-241-used']],
];

$record = static function (string $name, string $path, array $body, array $replies) use ($out): array {
    [$kernel] = Fixtures::kernel(new RecordedTransport(...$replies));
    $response = Fixtures::call($kernel, 'POST', $path, $body);
    unset($body['certificate'], $body['csc']);
    $file = ['path' => $path, 'request' => $body, 'status' => $response->status, 'body' => $response->body];
    file_put_contents("$out/$name.json", json_encode($file, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
    return $response->body;
};

foreach ($cases as $name => [$path, $body, $replies]) {
    $answer = $record($name, $path, $body, $replies);
    if ($name === 'nfce-sign-contingency') {
        $record('nfce-transmit-authorized', '/nfce/transmit', $auth + ['signedXml' => $answer['signedXml']], ['authorization-100-authorized']);
    }
}
echo 'recorded ' . (count($cases) + 1) . " answers in $out\n";
