<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Http;

use Fiscal\Sidecar\ServiceError;
use JsonException;

/**
 * One HTTP request, as the kernel sees it: the method, the path, the raw body
 * and the one header it reads, `Authorization` (the launch token, FUT-4717).
 */
final class Request
{
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        private readonly string $body,
        public readonly ?string $authorization = null,
    ) {
    }

    public static function fromGlobals(): self
    {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = (string) parse_url($uri, PHP_URL_PATH);
        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $path === '' ? '/' : $path,
            (string) file_get_contents('php://input'),
            isset($_SERVER['HTTP_AUTHORIZATION']) ? (string) $_SERVER['HTTP_AUTHORIZATION'] : null,
        );
    }

    /**
     * The body as a JSON object.
     *
     * @return array<string, mixed>
     */
    public function json(): array
    {
        try {
            $decoded = json_decode($this->body, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw ServiceError::invalid('The body is not JSON.');
        }
        if (!is_array($decoded) || array_is_list($decoded)) {
            throw ServiceError::invalid('The body must be a JSON object.');
        }
        return $decoded;
    }
}
