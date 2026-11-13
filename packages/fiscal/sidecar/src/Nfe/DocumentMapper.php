<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use Fiscal\Sidecar\ServiceError;
use NFePHP\Common\UFList;
use NFePHP\NFe\Make;
use Throwable;

/**
 * From the neutral `SaleForDocument` (already schema-valid) to sped-nfe's
 * `Make`, tag by tag, and on to the unsigned XML and its access key.
 *
 * Money arrives in cents and leaves in reais; rates arrive in basis points and
 * leave as percentages with four decimals; a code arrives as a name and leaves
 * as the layout's number. Nothing here computes a tax: the figures are the
 * caller's (the engine's), written as given.
 */
final class DocumentMapper
{
    private const PURPOSE = ['NORMAL' => 1, 'COMPLEMENTARY' => 2, 'ADJUSTMENT' => 3, 'RETURN' => 4];
    private const DESTINATION = ['INTERNAL' => 1, 'INTERSTATE' => 2, 'FOREIGN' => 3];
    private const PRESENCE = [
        'IN_PERSON' => 1,
        'INTERNET' => 2,
        'TELEPHONE' => 3,
        'HOME_DELIVERY' => 4,
        'IN_PERSON_OFF_PREMISES' => 5,
        'OTHER' => 9,
    ];
    private const CRT = ['SIMPLES' => 1, 'SIMPLES_EXCESS' => 2, 'NORMAL' => 3, 'MEI' => 4];
    private const IE_STATUS = ['CONTRIBUTOR' => 1, 'EXEMPT' => 2, 'NON_CONTRIBUTOR' => 9];
    private const FREIGHT = [
        'BY_ISSUER' => 0,
        'BY_RECIPIENT' => 1,
        'BY_THIRD_PARTY' => 2,
        'OWN_BY_ISSUER' => 3,
        'OWN_BY_RECIPIENT' => 4,
        'NONE' => 9,
    ];
    private const PAYMENT = [
        'CASH' => '01',
        'CHECK' => '02',
        'CREDIT_CARD' => '03',
        'DEBIT_CARD' => '04',
        'STORE_CREDIT' => '05',
        'FOOD_VOUCHER' => '10',
        'MEAL_VOUCHER' => '11',
        'GIFT_VOUCHER' => '12',
        'FUEL_VOUCHER' => '13',
        'BANK_SLIP' => '15',
        'BANK_DEPOSIT' => '16',
        'PIX_DYNAMIC' => '17',
        'TRANSFER' => '18',
        'LOYALTY' => '19',
        'PIX_STATIC' => '20',
        'NO_PAYMENT' => '90',
        'OTHER' => '99',
    ];
    /** `indIntermed` is written only where the buyer was not at the counter (NT 2020.006). */
    private const REMOTE_PRESENCE = [2, 3, 4, 9];

    public const PROCESS_VERSION = 'fiscal-sidecar-1';

    /**
     * From 2027 the IBS/CBS go INSIDE `vProd`, and the price without tax
     * travels in NT 2026.008's `vProdLiq`/`vUnComLiq`/`vProdLiqTot` (source:
     * future-pay docs/tax/02-fiscal-document-platforms.md §7, "the tax goes into
     * `vProd` from 2027"). sped-nfe 5.2.9 cannot write those fields, and document
     * version 1 does not carry them, so a document issued on or after this day
     * is refused rather than emitted wrong. Lifted by the sped-nfe bump that
     * brings NT 2026.008, with document version 2.
     */
    public const LAYOUT_LIMIT = '2027-01-01';
    public const LAYOUT_LIMIT_CODE = 'NT_2026_008_NOT_SUPPORTED';

    /**
     * @param array<string, mixed> $document
     * @param array{since: string, reason: string}|null $contingency an NFC-e signed offline (`tpEmis = 9`)
     * @return array{xml: string, accessKey: string}
     * @throws ServiceError INVALID when sped-nfe refuses to build it
     */
    public function build(array $document, Model $model, int $environment, ?array $contingency = null): array
    {
        self::refuseWhatThisLayoutCannotSay($document);
        $make = new Make(NfeModule::SCHEMES);
        $make->setOnlyAscii(false);
        $make->setCheckGtin(true);
        try {
            $this->header($make, $document, $model, $environment, $contingency);
            $this->parties($make, $document);
            foreach (array_values($document['lines']) as $index => $line) {
                $this->line($make, $index + 1, $line);
            }
            $this->closing($make, $document);
            $xml = $make->render();
        } catch (ServiceError $error) {
            throw $error;
        } catch (Throwable $failure) {
            throw ServiceError::invalid('The document could not be built.', array_merge(
                [$failure->getMessage()],
                array_values(array_map('strval', $make->getErrors())),
            ));
        }
        $errors = array_values(array_map('strval', $make->getErrors()));
        if ($errors !== []) {
            throw ServiceError::invalid('The document could not be built.', $errors);
        }
        return ['xml' => $xml, 'accessKey' => $make->getChave()];
    }

    /** @param array<string, mixed> $document */
    private static function refuseWhatThisLayoutCannotSay(array $document): void
    {
        if (substr((string) $document['issuedAt'], 0, 10) >= self::LAYOUT_LIMIT) {
            throw new ServiceError(
                \Fiscal\Sidecar\ErrorClass::INVALID,
                'A document issued on or after ' . self::LAYOUT_LIMIT . ' needs NT 2026.008 (vProdLiq), '
                . 'which this service\'s sped-nfe does not write yet.',
                self::LAYOUT_LIMIT_CODE,
            );
        }
        $details = [];
        foreach (array_values($document['lines']) as $index => $line) {
            $quantity = (float) $line['quantity'];
            if (abs(round($quantity, 4) - $quantity) > 1e-9) {
                $details[] = "lines[$index].quantity: at most four decimals (qCom)";
            }
        }
        if ($details !== []) {
            throw ServiceError::invalid('The document does not fit the NF-e layout.', $details);
        }
    }

    /** @param array<string, mixed> $d */
    private function header(Make $make, array $d, Model $model, int $environment, ?array $contingency): void
    {
        $make->taginfNFe((object) ['Id' => null, 'versao' => '4.00']);
        $presence = self::PRESENCE[$d['presence']];
        $make->tagide((object) [
            'cUF' => UFList::getCodeByUF($d['issuer']['address']['uf']),
            'cNF' => $d['keyCode'],
            'natOp' => $d['operationNature'],
            'mod' => $model->code(),
            'serie' => $d['series'],
            'nNF' => $d['number'],
            'dhEmi' => $d['issuedAt'],
            'dhSaiEnt' => null,
            'tpNF' => 1,
            'idDest' => self::DESTINATION[$d['destination']],
            'cMunFG' => $d['issuer']['address']['municipalityIbge'],
            'tpImp' => $model === Model::NFCE ? 4 : 1,
            'tpEmis' => $contingency === null ? 1 : 9,
            'cDV' => null,
            'tpAmb' => $environment,
            'finNFe' => self::PURPOSE[$d['purpose']],
            'indFinal' => $d['finalConsumer'] ? 1 : 0,
            'indPres' => $presence,
            'indIntermed' => in_array($presence, self::REMOTE_PRESENCE, true)
                ? ($d['intermediary'] === null ? 0 : 1)
                : null,
            'procEmi' => 0,
            'verProc' => self::PROCESS_VERSION,
            'dhCont' => $contingency['since'] ?? null,
            'xJust' => $contingency['reason'] ?? null,
        ]);
    }

    /** @param array<string, mixed> $d */
    private function parties(Make $make, array $d): void
    {
        $issuer = $d['issuer'];
        $make->tagEmit((object) [
            'xNome' => $issuer['legalName'],
            'xFant' => $issuer['tradeName'],
            'IE' => $issuer['stateRegistration'],
            'CRT' => self::CRT[$issuer['taxRegime']],
            'CNPJ' => $issuer['cnpj'],
        ]);
        $make->tagenderEmit(self::address($issuer['address']));
        $buyer = $d['buyer'];
        if ($buyer === null) {
            return;
        }
        $document = $buyer['document'];
        $make->tagdest((object) [
            'xNome' => $buyer['name'],
            'CNPJ' => $document['kind'] === 'CNPJ' ? $document['number'] : null,
            'CPF' => $document['kind'] === 'CPF' ? $document['number'] : null,
            'idEstrangeiro' => $document['kind'] === 'FOREIGN' ? $document['number'] : null,
            'indIEDest' => self::IE_STATUS[$buyer['stateRegistrationStatus']],
            'IE' => $buyer['stateRegistration'],
            'email' => $buyer['email'],
        ]);
        if ($buyer['address'] !== null) {
            $make->tagenderDest(self::address($buyer['address']));
        }
    }

    /** @param array<string, mixed> $address */
    private static function address(array $address): object
    {
        return (object) [
            'xLgr' => $address['street'],
            'nro' => $address['number'],
            'xCpl' => $address['complement'],
            'xBairro' => $address['district'],
            'cMun' => $address['municipalityIbge'],
            'xMun' => $address['municipalityName'],
            'UF' => $address['uf'],
            'CEP' => $address['postalCode'],
            'cPais' => 1058,
            'xPais' => 'Brasil',
            'fone' => $address['phone'],
        ];
    }

    /** @param array<string, mixed> $line */
    private function line(Make $make, int $item, array $line): void
    {
        $gtin = $line['gtin'] ?? 'SEM GTIN';
        $make->tagprod((object) [
            'item' => $item,
            'cProd' => $line['code'],
            'cEAN' => $gtin,
            'xProd' => $line['description'],
            'NCM' => $line['ncm'],
            'CEST' => $line['cest'],
            'CFOP' => $line['cfop'],
            'uCom' => $line['unit'],
            'qCom' => self::quantity($line['quantity']),
            'vUnCom' => self::unitValue($line['valueCents'], $line['quantity']),
            'vProd' => self::reais($line['valueCents']),
            'cEANTrib' => $gtin,
            'uTrib' => $line['unit'],
            'qTrib' => self::quantity($line['quantity']),
            'vUnTrib' => self::unitValue($line['valueCents'], $line['quantity']),
            'vDesc' => $line['discountCents'] > 0 ? self::reais($line['discountCents']) : null,
            'indTot' => 1,
        ]);
        if ($line['additionalInfo'] !== null) {
            $make->taginfAdProd((object) ['item' => $item, 'infAdProd' => $line['additionalInfo']]);
        }
        $make->tagimposto((object) [
            'item' => $item,
            'vTotTrib' => $line['approximateTaxCents'] === null ? null : self::reais($line['approximateTaxCents']),
        ]);
        $this->icms($make, $item, $line['icms']);
        $make->tagPIS(self::contribution($item, $line['pis'], 'PIS'));
        $make->tagCOFINS(self::contribution($item, $line['cofins'], 'COFINS'));
        if ($line['ibsCbs'] !== null) {
            $make->tagIBSCBS(self::ibsCbs($item, $line['ibsCbs']));
        }
    }

    /** @param array<string, mixed> $icms */
    private function icms(Make $make, int $item, array $icms): void
    {
        if ($icms['regime'] === 'SIMPLES') {
            $make->tagICMSSN((object) [
                'item' => $item,
                'orig' => $icms['origin'],
                'CSOSN' => $icms['csosn'],
                'pCredSN' => isset($icms['creditRateBp']) ? self::percent($icms['creditRateBp']) : null,
                'vCredICMSSN' => isset($icms['creditCents']) ? self::reais($icms['creditCents']) : null,
            ]);
            return;
        }
        $taxed = $icms['cst'] === '00';
        $make->tagICMS((object) [
            'item' => $item,
            'orig' => $icms['origin'],
            'CST' => $icms['cst'],
            'modBC' => $taxed ? 3 : null,
            'vBC' => $taxed ? self::reais($icms['baseCents']) : null,
            'pICMS' => $taxed ? self::percent($icms['rateBp']) : null,
            'vICMS' => $taxed ? self::reais($icms['amountCents']) : null,
        ]);
    }

    /** @param array<string, mixed> $c */
    private static function contribution(int $item, array $c, string $tax): object
    {
        $carriesFigures = !in_array($c['cst'], ['04', '05', '06', '07', '08', '09'], true);
        return (object) [
            'item' => $item,
            'CST' => $c['cst'],
            'vBC' => $carriesFigures ? self::reais($c['baseCents']) : null,
            "p$tax" => $carriesFigures ? self::percent($c['rateBp']) : null,
            "v$tax" => $carriesFigures ? self::reais($c['amountCents']) : null,
        ];
    }

    /** @param array<string, mixed> $group */
    private static function ibsCbs(int $item, array $group): object
    {
        $std = ['item' => $item, 'CST' => $group['cst'], 'cClassTrib' => $group['classCode']];
        $f = $group['figures'];
        if ($f === null) {
            return (object) $std;
        }
        $std['vBC'] = self::reais($f['baseCents']);
        $std['vIBS'] = self::reais($f['ibsUfCents'] + $f['ibsMunCents']);
        foreach (['gIBSUF' => ['IBSUF', 'ibsUf'], 'gIBSMun' => ['IBSMun', 'ibsMun'], 'gCBS' => ['CBS', 'cbs']]
            as $prefix => [$tag, $key]) {
            $std["{$prefix}_p$tag"] = self::percent($f["{$key}RateBp"]);
            $std["{$prefix}_v$tag"] = self::reais($f["{$key}Cents"]);
            if ($f['reductionBp'] > 0) {
                $std["{$prefix}_pRedAliq"] = self::percent($f['reductionBp']);
                $std["{$prefix}_pAliqEfet"] = self::effectiveRate($f["{$key}RateBp"], $f['reductionBp']);
            }
        }
        return (object) $std;
    }

    /** @param array<string, mixed> $d */
    private function closing(Make $make, array $d): void
    {
        $make->tagtransp((object) ['modFrete' => self::FREIGHT[$d['freight']]]);
        $make->tagpag((object) ['vTroco' => $d['changeCents'] > 0 ? self::reais($d['changeCents']) : null]);
        foreach ($d['payments'] as $payment) {
            $card = $payment['card'];
            $make->tagdetPag((object) [
                'indPag' => null,
                'tPag' => self::PAYMENT[$payment['method']],
                'xPag' => $payment['description'],
                'vPag' => self::reais($payment['amountCents']),
                'CNPJ' => $card['acquirerCnpj'] ?? null,
                'tBand' => $card['brand'] ?? null,
                'cAut' => $card['authorizationCode'] ?? null,
                'tpIntegra' => $card === null ? null : ($card['integrated'] ? 1 : 2),
            ]);
        }
        if ($d['intermediary'] !== null) {
            $make->tagIntermed((object) [
                'CNPJ' => $d['intermediary']['cnpj'],
                'idCadIntTran' => $d['intermediary']['userId'],
            ]);
        }
        $info = $d['additionalInfo'];
        if ($info['forTaxpayer'] !== null || $info['forTaxAuthority'] !== null) {
            $make->taginfAdic((object) ['infAdFisco' => $info['forTaxAuthority'], 'infCpl' => $info['forTaxpayer']]);
        }
        $tech = $d['technicalResponsible'];
        if ($tech !== null) {
            $make->taginfRespTec((object) [
                'CNPJ' => $tech['cnpj'],
                'xContato' => $tech['contactName'],
                'email' => $tech['email'],
                'fone' => $tech['phone'],
            ]);
        }
    }

    private static function reais(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    private static function percent(int $basisPoints): string
    {
        return number_format($basisPoints / 100, 4, '.', '');
    }

    private static function effectiveRate(int $rateBp, int $reductionBp): string
    {
        return number_format($rateBp * (10000 - $reductionBp) / 1000000, 4, '.', '');
    }

    private static function quantity(int|float $quantity): string
    {
        return number_format((float) $quantity, 4, '.', '');
    }

    /** `vUnCom`: the line's value over its quantity, ten decimals, as the layout writes it. */
    private static function unitValue(int $cents, int|float $quantity): string
    {
        return number_format($cents / 100 / (float) $quantity, 10, '.', '');
    }
}
