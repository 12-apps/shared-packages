<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Http;

use Fiscal\Sidecar\ServiceError;

/**
 * Exact-path routing. A library module registers its own paths (sped-nfe's
 * under `/nfe`, `/nfce` and `/inutilize`); a second library registers its own
 * prefix beside them, and a path registered twice is refused at boot.
 */
final class Router
{
    /** @var array<string, array<string, callable(Request): Response>> */
    private array $routes = [];

    /** @param callable(Request): Response $handler */
    public function add(string $method, string $path, callable $handler): void
    {
        if (isset($this->routes[$path][$method])) {
            throw new \LogicException("Route registered twice: $method $path");
        }
        $this->routes[$path][$method] = $handler;
    }

    /** @return list<string> every `METHOD /path`, for the route test */
    public function table(): array
    {
        $table = [];
        foreach ($this->routes as $path => $methods) {
            foreach (array_keys($methods) as $method) {
                $table[] = "$method $path";
            }
        }
        sort($table);
        return $table;
    }

    public function dispatch(Request $request): Response
    {
        $methods = $this->routes[$request->path] ?? null;
        if ($methods === null) {
            return new Response(404, ['error' => self::plainError('No such endpoint.')]);
        }
        $handler = $methods[$request->method] ?? null;
        if ($handler === null) {
            return new Response(405, ['error' => self::plainError('Method not allowed.')]);
        }
        return $handler($request);
    }

    /** @return array<string, mixed> */
    private static function plainError(string $message): array
    {
        return (new ServiceError(\Fiscal\Sidecar\ErrorClass::INVALID, $message))->toBody()['error'];
    }
}
