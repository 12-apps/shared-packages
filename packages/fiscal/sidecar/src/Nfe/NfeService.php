<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use DOMDocument;
use Fiscal\Sidecar\ErrorClass;
use Fiscal\Sidecar\Http\Response;
use Fiscal\Sidecar\Nfe\Transport\Transport;
use Fiscal\Sidecar\Nfe\Transport\TransportFailure;
use Fiscal\Sidecar\ServiceError;
use NFePHP\Common\Certificate;
use NFePHP\Common\UFList;
use NFePHP\NFe\Complements;
use NFePHP\NFe\Tools;
use Throwable;

/**
 * The operations over sped-nfe, one call each. Every call opens its own
 * certificate, builds its own `Tools` and keeps nothing.
 */
final class NfeService
{
    /** 100 authorised, 150 authorised late, 120 authorised with a warning (NT 2026.002). */
    private const AUTHORIZED = ['100', '120', '150'];
    private const CANCELLED = ['101', '151', '155'];
    private const DENIED = ['110', '301', '302', '303'];
    private const NOT_FOUND = '217';
    private const EVENT_REGISTERED = ['135', '136', '155'];

    public function __construct(
        private readonly Transport $transport,
        private readonly DocumentMapper $mapper = new DocumentMapper(),
    ) {
    }

    /** `POST /<model>/issue`: build, sign, transmit. */
    public function issue(Model $model, Input $in): Response
    {
        [$environment, $csc, $document, $certificate] = $this->issueInputs($model, $in);
        $built = $this->mapper->build($document, $model, $environment);
        $tools = $this->toolsForDocument($certificate, $model, $environment, $document, $csc);
        $signed = $this->sign($tools, $built['xml'], $built['accessKey']);
        return $this->transmitSigned($tools, $signed, $built['accessKey']);
    }

    /** `POST /nfce/sign-contingency`: build and sign with `tpEmis = 9`; nothing is sent. */
    public function signContingency(Input $in): Response
    {
        [$environment, $csc, $document, $certificate] = $this->issueInputs(Model::NFCE, $in);
        $contingency = $in->contingency();
        $built = $this->mapper->build($document, Model::NFCE, $environment, $contingency);
        $tools = $this->toolsForDocument($certificate, Model::NFCE, $environment, $document, $csc);
        $signed = $this->sign($tools, $built['xml'], $built['accessKey']);
        return new Response(200, ['status' => 'SIGNED', 'accessKey' => $built['accessKey'], 'signedXml' => $signed]);
    }

    /** `POST /<model>/transmit`: an XML signed earlier (offline, say). */
    public function transmit(Model $model, Input $in): Response
    {
        $environment = $in->environment();
        $signed = $in->text('signedXml', 100, 5_000_000);
        $facts = self::signedFacts($signed, $model);
        $certificate = Credentials::open($in->certificate());
        $tools = Sefaz::tools($this->transport, $certificate, $model, $environment, $facts['uf'], $facts['cnpj'], null);
        return $this->transmitSigned($tools, $signed, $facts['accessKey']);
    }

    /** `POST /<model>/cancel`. */
    public function cancel(Model $model, Input $in): Response
    {
        $environment = $in->environment();
        $key = self::keyOf($model, $in);
        $protocol = $in->pattern('protocol', '/^[0-9]{15}$/', 'the 15-digit authorisation protocol');
        $reason = $in->text('reason', 15, 255);
        $tools = $this->toolsForKey($in, $model, $environment, $key);
        $reply = $this->exchange(fn (): string => $tools->sefazCancela($key, $reason, $protocol), false);
        $status = $reply->status() === '128' ? (string) $reply->value('cStat', 'infEvento') : $reply->status();
        if (!in_array($status, self::EVENT_REGISTERED, true)) {
            throw Classifier::fromStatus($status, self::reasonOf($reply, 'infEvento'), $reply);
        }
        return new Response(200, self::answer($reply, $status, 'infEvento') + [
            'status' => 'CANCELLED',
            'accessKey' => $key,
            'protocol' => (string) $reply->value('nProt', 'infEvento'),
            'registeredAt' => (string) $reply->value('dhRegEvento', 'infEvento'),
            'eventXml' => self::protocolled($tools->lastRequest, $reply->raw),
        ]);
    }

    /** `POST /<model>/lookup`. */
    public function lookup(Model $model, Input $in): Response
    {
        $environment = $in->environment();
        $key = self::keyOf($model, $in);
        $tools = $this->toolsForKey($in, $model, $environment, $key);
        $reply = $this->exchange(fn (): string => $tools->sefazConsultaChave($key), false);
        $status = $reply->status();
        $state = match (true) {
            in_array($status, self::AUTHORIZED, true) => 'AUTHORIZED',
            in_array($status, self::CANCELLED, true) => 'CANCELLED',
            in_array($status, self::DENIED, true) => 'DENIED',
            $status === self::NOT_FOUND => 'NOT_FOUND',
            default => throw Classifier::fromStatus($status, $reply->reason(), $reply),
        };
        return new Response(200, self::answer($reply, $status, null) + [
            'status' => $state,
            'accessKey' => $key,
            'protocol' => $reply->value('nProt', 'protNFe'),
        ]);
    }

    /** `POST /inutilize`. */
    public function inutilize(Input $in): Response
    {
        $environment = $in->environment();
        $model = Model::tryFrom((string) $in->pattern('model', '/^(nfe|nfce)$/', '"nfe" or "nfce"'));
        $uf = $in->pattern('uf', '/^[A-Z]{2}$/', 'a two-letter UF');
        $cnpj = $in->pattern('cnpj', '/^[A-Z0-9]{12}[0-9]{2}$/', 'a 14-character CNPJ');
        $year = $in->digits('year', 2000, 2099);
        $series = $in->digits('series', 0, 999);
        $from = $in->digits('from', 1, 999999999);
        $to = $in->digits('to', $from, 999999999);
        $reason = $in->text('reason', 15, 255);
        $certificate = Credentials::open($in->certificate());
        $tools = Sefaz::tools($this->transport, $certificate, $model ?? Model::NFE, $environment, $uf, $cnpj, null);
        $reply = $this->exchange(
            fn (): string => $tools->sefazInutiliza($series, $from, $to, $reason, $environment, substr((string) $year, 2)),
            false,
        );
        if ($reply->status() !== '102') {
            throw Classifier::fromStatus($reply->status(), $reply->reason(), $reply);
        }
        return new Response(200, self::answer($reply, '102', null) + [
            'status' => 'INUTILIZED',
            'protocol' => (string) $reply->value('nProt'),
            'registeredAt' => (string) $reply->value('dhRecbto'),
            'inutilizationXml' => self::protocolled($tools->lastRequest, $reply->raw),
        ]);
    }

    /** @return array{0: int, 1: array{id: string, token: string}|null, 2: array<string, mixed>, 3: Certificate} */
    private function issueInputs(Model $model, Input $in): array
    {
        $environment = $in->environment();
        $csc = $in->csc($model);
        $document = $in->document();
        return [$environment, $csc, $document, Credentials::open($in->certificate())];
    }

    /**
     * @param array<string, mixed> $document
     * @param array{id: string, token: string}|null $csc
     */
    private function toolsForDocument(
        Certificate $certificate,
        Model $model,
        int $environment,
        array $document,
        ?array $csc,
    ): Tools {
        $issuer = $document['issuer'];
        return $this->library(fn (): Tools => Sefaz::tools(
            $this->transport,
            $certificate,
            $model,
            $environment,
            $issuer['address']['uf'],
            $issuer['cnpj'],
            $csc,
        ));
    }

    private function toolsForKey(Input $in, Model $model, int $environment, string $key): Tools
    {
        $certificate = Credentials::open($in->certificate());
        $uf = UFList::getUFByCode((int) substr($key, 0, 2));
        return Sefaz::tools($this->transport, $certificate, $model, $environment, $uf, substr($key, 6, 14), null);
    }

    private function sign(Tools $tools, string $xml, string $accessKey): string
    {
        try {
            return $this->library(fn (): string => $tools->signNFe($xml));
        } catch (ServiceError $error) {
            throw $error->withDocument($accessKey, null);
        }
    }

    private function transmitSigned(Tools $tools, string $signed, string $accessKey): Response
    {
        $batch = substr($accessKey, 22, 15);
        try {
            $reply = $this->exchange(fn (): string => $tools->sefazEnviaLote([$signed], $batch, 1), true);
        } catch (ServiceError $error) {
            throw $error->withDocument($accessKey, $signed);
        }
        $processed = $reply->status() === '104' && $reply->has('infProt');
        $status = $processed ? (string) $reply->value('cStat', 'infProt') : $reply->status();
        if (!in_array($status, self::AUTHORIZED, true)) {
            throw Classifier::fromStatus($status, self::reasonOf($reply, $processed ? 'infProt' : null), $reply)
                ->withDocument($accessKey, $signed);
        }
        return new Response(200, self::answer($reply, $status, 'infProt') + [
            'status' => 'AUTHORIZED',
            'accessKey' => $accessKey,
            'protocol' => (string) $reply->value('nProt', 'infProt'),
            'authorizedAt' => (string) $reply->value('dhRecbto', 'infProt'),
            'signedXml' => $signed,
            'authorizedXml' => self::protocolled($signed, $reply->raw),
        ]);
    }

    /**
     * One request to SEFAZ, its reply read.
     *
     * @param callable(): string $call
     */
    private function exchange(callable $call, bool $issuing): SefazReply
    {
        try {
            $raw = $this->library($call);
        } catch (TransportFailure $failure) {
            throw Classifier::fromTransport($failure, $issuing);
        }
        return SefazReply::parse($raw);
    }

    /**
     * Runs a sped-nfe call, sorting what it throws: the transport's failures
     * pass through to be classified; a certificate the library finds expired is
     * AUTH; what the library refuses about the input is INVALID.
     *
     * @template T
     * @param callable(): T $call
     * @return T
     */
    private function library(callable $call): mixed
    {
        try {
            return $call();
        } catch (TransportFailure | ServiceError $passThrough) {
            throw $passThrough;
        } catch (\NFePHP\Common\Certificate\Exception\Expired) {
            throw new ServiceError(ErrorClass::AUTH, 'The certificate has expired.');
        } catch (Throwable $refused) {
            throw ServiceError::invalid('sped-nfe refused the request.', [$refused->getMessage()]);
        }
    }

    /** @return array{statusCode: string, statusReason: string, sefazReply: string} */
    private static function answer(SefazReply $reply, string $status, ?string $group): array
    {
        return ['statusCode' => $status, 'statusReason' => self::reasonOf($reply, $group), 'sefazReply' => $reply->raw];
    }

    private static function reasonOf(SefazReply $reply, ?string $group): string
    {
        return (string) ($group === null ? $reply->reason() : $reply->value('xMotivo', $group));
    }

    private static function protocolled(string $request, string $reply): string
    {
        try {
            return Complements::toAuthorize($request, $reply);
        } catch (Throwable $failure) {
            throw new ServiceError(
                ErrorClass::RETRYABLE,
                'SEFAZ accepted the request but its reply could not be attached to it: ' . $failure->getMessage(),
            );
        }
    }

    private static function keyOf(Model $model, Input $in): string
    {
        $key = $in->accessKey();
        if ((int) substr($key, 20, 2) !== $model->code()) {
            throw ServiceError::invalid("The access key is not of a model {$model->code()} document.");
        }
        return $key;
    }

    /** @return array{accessKey: string, uf: string, cnpj: string} */
    private static function signedFacts(string $signed, Model $model): array
    {
        $dom = new DOMDocument();
        $previous = libxml_use_internal_errors(true);
        $loaded = $dom->loadXML($signed, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        $infNFe = $loaded ? $dom->getElementsByTagName('infNFe')->item(0) : null;
        $signature = $loaded ? $dom->getElementsByTagName('Signature')->item(0) : null;
        if (!$infNFe instanceof \DOMElement || $signature === null) {
            throw ServiceError::invalid('signedXml must be a signed NFe XML.');
        }
        $key = substr($infNFe->getAttribute('Id'), 3);
        if (strlen($key) !== 44 || (int) substr($key, 20, 2) !== $model->code()) {
            throw ServiceError::invalid("signedXml is not a model {$model->code()} document.");
        }
        return ['accessKey' => $key, 'uf' => UFList::getUFByCode((int) substr($key, 0, 2)), 'cnpj' => substr($key, 6, 14)];
    }
}
