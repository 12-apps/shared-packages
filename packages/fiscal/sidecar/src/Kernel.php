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
 */
final class Kernel
{
    private readonly Router $router;

    /** @param list<Module> $modules */
    public function __construct(
        private readonly array $modules,
        private readonly RequestLog $log,
    ) {
        $this->router = new Router();
        $this->router->add('GET', '/health', fn (): Response => $this->health());
        foreach ($modules as $module) {
            $module->register($this->router);
        }
    }

    /** The production wiring: every module, talking to SEFAZ over cURL. */
    public static function production(?Transport $transport = null, ?RequestLog $log = null): self
    {
        return new self(self::modules($transport ?? CurlTransport::fromEnvironment()), $log ?? new RequestLog());
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
