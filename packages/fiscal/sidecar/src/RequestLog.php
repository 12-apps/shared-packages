<?php

declare(strict_types=1);

namespace Fiscal\Sidecar;

/**
 * One JSON line per request: when, which endpoint, the answer's status, and
 * for a failure its class and SEFAZ code. NEVER the body, a header, an
 * exception message or anything read from the request: the certificate, its
 * password and the CSC travel in the body, and a message can quote input. So
 * the fields are a closed list, written here and nowhere else.
 */
final class RequestLog
{
    /** @var resource */
    private $stream;

    /** @param resource|null $stream defaults to stderr */
    public function __construct($stream = null)
    {
        $this->stream = $stream ?? fopen('php://stderr', 'wb');
    }

    public function record(
        string $method,
        string $path,
        int $status,
        float $startedAt,
        ?ErrorClass $class,
        ?string $code,
        ?string $failure = null,
    ): void {
        $line = [
            'at' => gmdate('Y-m-d\TH:i:s\Z'),
            'method' => $method,
            'path' => self::knownPath($path),
            'status' => $status,
            'ms' => (int) round((microtime(true) - $startedAt) * 1000),
            'class' => $class?->value,
            'code' => $code !== null && preg_match('/^[0-9]{1,4}$/', $code) === 1 ? $code : null,
        ];
        if ($failure !== null) {
            $line['failure'] = $failure;
        }
        fwrite($this->stream, json_encode($line, JSON_UNESCAPED_SLASHES) . "\n");
    }

    /** The path, if it is made of route characters only; a probe's junk is not echoed. */
    private static function knownPath(string $path): string
    {
        return preg_match('#^[a-z/-]{1,40}$#', $path) === 1 ? $path : '(other)';
    }
}
