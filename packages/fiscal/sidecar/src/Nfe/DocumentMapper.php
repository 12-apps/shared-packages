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
    /** `tpNF`. An absent `operation` is `OUT`: a document built before the field existed is unchanged. */
    private const OPERATION = ['IN' => 0, 'OUT' => 1];
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
     * travels in NT 2026.008's `vProdLiq`/`vUnComLiq`/`vProdLiqTot` (source: NT
     * 2026.008 v1.00 itself: from 2027 the IBS, CBS and IS values "deverão ser
     * acrescidos ao valor do produto ou serviço, compondo o valor informado no
     * campo vProd"). A line's `netValueCents` is the engine's `vProdLiq`,
     * written as given; `vUnComLiq` is derived from it as `vUnCom` is from
     * `vProd`, and sped-nfe (5.2.11) sums `vProdLiqTot` from the items. Whether
     * a period puts the tax inside the price is the engine's rate table's
     * call, never a date here.
     */

    /** A return (`finNFe` 4) quotes the document it returns (`NFref`); one without a reference is refused. */
    public const RETURN_NEEDS_REFERENCE_CODE = 'RETURN_NEEDS_REFERENCE';

    /**
     * An NFC-e has no return purpose: a buyer's goods come back on an NF-e
     * (model 55) of entry that references the NFC-e's key.
     */
    public const RETURN_ON_NFCE_CODE = 'RETURN_ON_NFCE';

    /**
     * @param array<string, mixed> $document
     * @param array{since: string, reason: string}|null $contingency an NFC-e signed offline (`tpEmis = 9`)
     * @return array{xml: string, accessKey: string}
     * @throws ServiceError INVALID when sped-nfe refuses to build it
     */
    public function build(array $document, Model $model, int $environment, ?array $contingency = null): array
    {
        self::refuseWhatThisLayoutCannotSay($document);
        self::refuseAReturnItCannotBe($document, $model);
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
        $details = [];
        $withNetValue = 0;
        foreach (array_values($document['lines']) as $index => $line) {
            $quantity = (float) $line['quantity'];
            if (abs(round($quantity, 4) - $quantity) > 1e-9) {
                $details[] = "lines[$index].quantity: at most four decimals (qCom)";
            }
            $net = $line['netValueCents'] ?? null;
            if ($net !== null) {
                $withNetValue++;
                if ($net > $line['valueCents']) {
                    $details[] = "lines[$index].netValueCents: at most valueCents (vProdLiq is vProd without the IBS/CBS)";
                }
            }
        }
        if ($withNetValue !== 0 && $withNetValue !== count($document['lines'])) {
            $details[] = 'lines: netValueCents on every line or on none (vProdLiqTot sums them all)';
        }
        if ($details !== []) {
            throw ServiceError::invalid('The document does not fit the NF-e layout.', $details);
        }
    }

    /**
     * @param array<string, mixed> $document
     * @throws ServiceError INVALID, coded, when the purpose and the model or the references disagree
     */
    private static function refuseAReturnItCannotBe(array $document, Model $model): void
    {
        $isReturn = $document['purpose'] === 'RETURN';
        if ($model === Model::NFCE && $isReturn) {
            throw new ServiceError(
                \Fiscal\Sidecar\ErrorClass::INVALID,
                'An NFC-e has no return purpose: a return is an NF-e (model 55) of entry referencing the NFC-e.',
                self::RETURN_ON_NFCE_CODE,
            );
        }
        if ($model === Model::NFCE && ($document['operation'] ?? 'OUT') === 'IN') {
            throw ServiceError::invalid('An NFC-e is an outgoing document.', ['operation: an NFC-e takes "OUT" (tpNF 1)']);
        }
        if ($model === Model::NFCE && ($document['referencedDocuments'] ?? []) !== []) {
            // SEFAZ rejects NFref on a model 65 with 708, after the number is spent.
            throw ServiceError::invalid('An NFC-e references no document.', ['referencedDocuments: an NFC-e takes none (708)']);
        }
        if ($isReturn && ($document['referencedDocuments'] ?? []) === []) {
            throw new ServiceError(
                \Fiscal\Sidecar\ErrorClass::INVALID,
                'A return must reference the document it returns (referencedDocuments).',
                self::RETURN_NEEDS_REFERENCE_CODE,
            );
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
            'tpNF' => self::OPERATION[$d['operation'] ?? 'OUT'],
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
        foreach ($d['referencedDocuments'] ?? [] as $referenced) {
            $make->tagrefNFe((object) ['refNFe' => $referenced['accessKey']]);
        }
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
        $net = $line['netValueCents'] ?? null;
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
            'vUnComLiq' => $net === null ? null : self::unitValue($net, $line['quantity']),
            'vProdLiq' => $net === null ? null : self::reais($net),
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
        $this->paymentLinks($make, $d['payments']);
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

    /**
     * `gPgtoVinc` (NT 2026.006 v1.00, YC01): every payment whose transaction was
     * started before the document, linked by its id. `nPag` is the payment's
     * position among the document's payments. The caller decides whether the
     * environment accepts the group (it is optional in the layout, and the
     * fisco's own production activation is announced for 2027).
     *
     * @param list<array<string, mixed>> $payments
     */
    private function paymentLinks(Make $make, array $payments): void
    {
        foreach (array_values($payments) as $index => $payment) {
            $link = $payment['linkedTransaction'] ?? null;
            if ($link === null) {
                continue;
            }
            $make->tagPgtoVinc((object) [
                'nPag' => $index + 1,
                'idTransacao' => $link['transactionId'],
                'tpMeioPgto' => $link['meansCode'],
                'CNPJReceb' => $link['receiverCnpj'],
                'CNPJBasePSP' => $link['pspCnpjBase'],
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
