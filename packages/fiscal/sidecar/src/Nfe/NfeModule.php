<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use Composer\InstalledVersions;
use Fiscal\Sidecar\Http\Request;
use Fiscal\Sidecar\Http\Response;
use Fiscal\Sidecar\Http\Router;
use Fiscal\Sidecar\Module;
use Fiscal\Sidecar\Nfe\Transport\Transport;

/**
 * sped-nfe behind the service: models 55 (`/nfe/...`) and 65 (`/nfce/...`),
 * and `/inutilize`, which names its model in the body.
 */
final class NfeModule implements Module
{
    /** The schema package the layout is built and validated against (Pacote de Liberação 010f). */
    public const SCHEMES = 'PL_010_V1.30';
    public const LIBRARY = 'nfephp-org/sped-nfe';

    public function __construct(private readonly Transport $transport)
    {
    }

    public function register(Router $router): void
    {
        foreach (Model::cases() as $model) {
            $prefix = '/' . $model->value;
            $router->add('POST', "$prefix/issue", fn (Request $r): Response => $this->service()->issue($model, self::in($r)));
            $router->add('POST', "$prefix/transmit", fn (Request $r): Response => $this->service()->transmit($model, self::in($r)));
            $router->add('POST', "$prefix/cancel", fn (Request $r): Response => $this->service()->cancel($model, self::in($r)));
            $router->add('POST', "$prefix/lookup", fn (Request $r): Response => $this->service()->lookup($model, self::in($r)));
        }
        $router->add('POST', '/nfce/sign-contingency', fn (Request $r): Response => $this->service()->signContingency(self::in($r)));
        $router->add('POST', '/inutilize', fn (Request $r): Response => $this->service()->inutilize(self::in($r)));
    }

    public function libraries(): array
    {
        return [self::LIBRARY => (string) InstalledVersions::getPrettyVersion(self::LIBRARY)];
    }

    public function health(): array
    {
        return ['nfeSchemas' => self::SCHEMES, 'sefazTlsVerify' => $this->transport->verifiesServer()];
    }

    /** A fresh service per call: nothing one call opens is reachable from the next. */
    private function service(): NfeService
    {
        return new NfeService($this->transport);
    }

    private static function in(Request $request): Input
    {
        return new Input($request->json());
    }
}
