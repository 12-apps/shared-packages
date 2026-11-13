<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use Fiscal\Sidecar\Nfe\Transport\SoapAdapter;
use Fiscal\Sidecar\Nfe\Transport\Transport;
use NFePHP\Common\Certificate;
use NFePHP\NFe\Tools;

/**
 * One sped-nfe `Tools`, built for one call: its config, the call's
 * certificate and CSC, and the transport. Nothing here is cached; the next
 * call builds its own.
 */
final class Sefaz
{
    /**
     * @param array{id: string, token: string}|null $csc
     */
    public static function tools(
        Transport $transport,
        Certificate $certificate,
        Model $model,
        int $environment,
        string $uf,
        string $cnpj,
        ?array $csc,
    ): Tools {
        $config = [
            'atualizacao' => null,
            'tpAmb' => $environment,
            'razaosocial' => $certificate->getCompanyName() ?: $cnpj,
            'cnpj' => $cnpj,
            'siglaUF' => $uf,
            'schemes' => NfeModule::SCHEMES,
            'versao' => '4.00',
            'tokenIBPT' => null,
            'CSC' => $csc['token'] ?? null,
            'CSCid' => $csc['id'] ?? null,
            'aProxyConf' => null,
        ];
        $tools = new Tools((string) json_encode($config), $certificate);
        $tools->model($model->code());
        $tools->loadSoapClass(new SoapAdapter($transport, $certificate));
        return $tools;
    }
}
