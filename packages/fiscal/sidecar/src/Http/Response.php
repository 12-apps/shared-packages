<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Http;

/** A JSON answer. */
final class Response
{
    /** @param array<string, mixed> $body */
    public function __construct(
        public readonly int $status,
        public readonly array $body,
    ) {
    }

    public function encoded(): string
    {
        return (string) json_encode(
            $this->body,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE,
        );
    }

    public function send(): void
    {
        http_response_code($this->status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo $this->encoded();
    }
}
