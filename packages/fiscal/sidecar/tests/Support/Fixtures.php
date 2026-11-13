<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Support;

use Fiscal\Sidecar\Http\Request;
use Fiscal\Sidecar\Http\Response;
use Fiscal\Sidecar\Kernel;
use Fiscal\Sidecar\Nfe\Transport\Transport;
use Fiscal\Sidecar\RequestLog;

/** The documents, the requests around them and an in-process kernel. */
final class Fixtures
{
    public const CSC = ['id' => '000001', 'token' => 'TESTCSC0123456789ABCDEF0123456789'];

    /** @return array<string, mixed> */
    public static function document(string $name): array
    {
        return json_decode(
            (string) file_get_contents(__DIR__ . "/../fixtures/documents/$name.json"),
            true,
            64,
            JSON_THROW_ON_ERROR,
        );
    }

    /** @return array<string, mixed> */
    public static function issueBody(string $document, ThrowawayCertificate $certificate, bool $nfce): array
    {
        return [
            'environment' => 'homologacao',
            'certificate' => ['pfxBase64' => $certificate->base64(), 'password' => $certificate->password],
            'csc' => $nfce ? self::CSC : null,
            'document' => self::document($document),
        ];
    }

    /** @return array{0: Kernel, 1: resource} the kernel and the stream its request log writes to */
    public static function kernel(Transport $transport): array
    {
        $log = fopen('php://memory', 'w+b');
        return [new Kernel(Kernel::modules($transport), new RequestLog($log)), $log];
    }

    /** @param array<string, mixed>|string $body */
    public static function call(Kernel $kernel, string $method, string $path, array|string $body = ''): Response
    {
        $raw = is_array($body) ? (string) json_encode($body) : $body;
        return $kernel->handle(new Request($method, $path, $raw));
    }

    /** @param resource $log */
    public static function logText($log): string
    {
        rewind($log);
        return (string) stream_get_contents($log);
    }
}
