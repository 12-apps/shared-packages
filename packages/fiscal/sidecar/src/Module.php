<?php

declare(strict_types=1);

namespace Fiscal\Sidecar;

use Fiscal\Sidecar\Http\Router;

/**
 * One document library behind the service. sped-nfe (models 55 and 65) is the
 * first; an NFS-e library is a second module with its own `/nfse/...` paths,
 * added beside it in `Kernel::modules()`.
 */
interface Module
{
    public function register(Router $router): void;

    /**
     * The libraries this module runs, by name, with their installed version.
     *
     * @return array<string, string>
     */
    public function libraries(): array;
}
