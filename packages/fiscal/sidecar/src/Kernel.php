<?php

declare(strict_types=1);

namespace Fiscal\Sidecar;

use Fiscal\Sidecar\Http\Request;
use Fiscal\Sidecar\Http\Response;
use Fiscal\Sidecar\Http\Router;
use Fiscal\Sidecar\Nfe\NfeModule;
use Fiscal\Sidecar\Nfe\Transport\CurlTransport;
use Fiscal\Sidecar\Nfe\Transport\Transport;
use Throwable;

/**
 * The service: a router over the library modules, one request at a time.
 * Built per request by `public/index.php`, so nothing a call brings in (a
 * certificate, above all) can outlive it.
 *
 * With a token (`FISCAL_SIDECAR_TOKEN`, FUT-4717), every route but
 * `/health` answers only a call carrying `Authorization: Bearer <token>`,
 * compared in constant time; any other call is refused 401 before it is
 * routed. The token is never logged nor answered.
 */
final class Kernel
{
    private readonly Router $router;

    /** The path no token guards: a liveness probe carries no secret and answers none. */
    public const OPEN_PATH = '/health';

    /** @param list<Module> $modules */
    public function __construct(
        private readonly array $modules,
        private readonly RequestLog $log,
        #[\SensitiveParameter]
        private readonly ?string $token = null,
    ) {
        if ($token !== null && strlen($token) < 32) {
            throw new \InvalidArgumentException('FISCAL_SIDECAR_TOKEN must be at least 32 characters.');
        }
        $this->router = new Router();
        $this->router->add('GET', '/health', fn (): Response => $this->health());
        foreach ($modules as $module) {
            $module->register($this->router);
        }
    }

    /** The production wiring: every module, talking to SEFAZ over cURL. */
    public static function production(?Transport $transport = null, ?RequestLog $log = null): self
    {
        return new self(self::modules($transport ?? CurlTransport::fromEnvironment()), $log ?? new RequestLog(), self::tokenFromEnvironment());
    }

    /** `FISCAL_SIDECAR_TOKEN`, or `null` when unset or empty (the container image, reached on a private network). */
    public static function tokenFromEnvironment(): ?string
    {
        $token = getenv('FISCAL_SIDECAR_TOKEN');
        return is_string($token) && $token !== '' ? $token : null;
    }

    /** Whether the call may be routed: no token set, the open path, or the right bearer. */
    private function authorized(Request $request): bool
    {
        if ($this->token === null || $request->path === self::OPEN_PATH) {
            return true;
        }
        $header = $request->authorization ?? '';
        if (!str_starts_with($header, 'Bearer ')) {
            return false;
        }
        return hash_equals($this->token, substr($header, 7));
    }

    /**
     * The libraries the service runs. A second one (NFS-e) is appended here.
     *
     * @return list<Module>
     */
    public static function modules(Transport $transport): array
    {
        return [new NfeModule($transport)];
    }

    public function router(): Router
    {
        return $this->router;
    }

    public function handle(Request $request): Response
    {
        $startedAt = microtime(true);
        if (!$this->authorized($request)) {
            $error = new ServiceError(ErrorClass::INVALID, 'This call needs the service token.', 'UNAUTHORIZED');
            $this->log->record($request->method, $request->path, 401, $startedAt, ErrorClass::INVALID, null, 'Unauthorized');
            return new Response(401, $error->toBody());
        }
        try {
            $response = $this->router->dispatch($request);
            $class = isset($response->body['error']['class'])
                ? ErrorClass::from($response->body['error']['class'])
                : null;
            $this->log->record($request->method, $request->path, $response->status, $startedAt, $class, null);
            return $response;
        } catch (ServiceError $error) {
            $status = $error->class->httpStatus();
            $this->log->record($request->method, $request->path, $status, $startedAt, $error->class, $error->sefazCode);
            return new Response($status, $error->toBody());
        } catch (Throwable $unexpected) {
            // The exception's message can quote input, so only its type is logged.
            $this->log->record(
                $request->method,
                $request->path,
                500,
                $startedAt,
                ErrorClass::INTERNAL,
                null,
                (new \ReflectionClass($unexpected))->getShortName(),
            );
            // INTERNAL, not RETRYABLE: a defect answers the same way every time,
            // and a retry loop would only repeat it.
            $error = new ServiceError(ErrorClass::INTERNAL, 'The service failed unexpectedly.');
            return new Response(500, $error->toBody());
        }
    }

    private function health(): Response
    {
        $libraries = [];
        $facts = [];
        foreach ($this->modules as $module) {
            $libraries += $module->libraries();
            $facts += $module->health();
        }
        return new Response(200, ['status' => 'ok', 'libraries' => $libraries] + $facts);
    }
}
