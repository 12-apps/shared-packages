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
    /** Denial of use (the number is spent; the denial is kept like an authorisation). */
    private const DENIED = ['110', '301', '302', '303'];
    private const NOT_FOUND = '217';
    private const EVENT_REGISTERED = ['135', '136', '155'];
    /** 204 "Duplicidade de NF-e" (the key is already authorised), 205 (already denied): a retried issue. */
    private const ALREADY_HELD = ['204', '205'];
    /** 218 "NF-e já está cancelada", 573 "Duplicidade de Evento": a retried cancel. */
    private const ALREADY_CANCELLED = ['218', '573'];
    /** 563 "Já existe pedido de Inutilização com a mesma faixa": a retried inutilização. */
    private const INUTILIZATION_EXISTS = '563';

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
        return $this->transmitSigned($tools, $signed, $built['accessKey'], true, $model === Model::NFCE);
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

    /** `POST /<model>/transmit`: an XML signed earlier (offline, say). It never goes offline again. */
    public function transmit(Model $model, Input $in): Response
    {
        $environment = $in->environment();
        $signed = $in->text('signedXml', 100, 5_000_000);
        $facts = self::signedFacts($signed, $model);
        $certificate = Credentials::open($in->certificate());
        $tools = Sefaz::tools($this->transport, $certificate, $model, $environment, $facts['uf'], $facts['cnpj'], null);
        return $this->transmitSigned($tools, $signed, $facts['accessKey'], false, false);
    }

    /**
     * `POST /<model>/cancel`. A cancel SEFAZ already holds (218 already
     * cancelled, 573 duplicate event) and one sent with no answer are settled
     * by looking the key up: a retried cancel answers CANCELLED, as the first did.
     */
    public function cancel(Model $model, Input $in): Response
    {
        $environment = $in->environment();
        $key = self::keyOf($model, $in);
        $protocol = $in->pattern('protocol', '/^[0-9]{15}$/', 'the 15-digit authorisation protocol');
        $reason = $in->text('reason', 15, 255);
        $tools = $this->toolsForKey($in, $model, $environment, $key);
        return $this->sendCancel($tools, $key, fn (): string => $tools->sefazCancela($key, $reason, $protocol));
    }

    /**
     * `POST /nfce/cancel-substitution`: the NFC-e "cancelamento por
     * substituição" (event 110112). Cancels an online NFC-e found authorised
     * after its sale was issued again in contingency, naming the substitute's
     * key (`chNFeRef`). Settled like an ordinary cancel when retried.
     */
    public function cancelBySubstitution(Input $in): Response
    {
        $environment = $in->environment();
        $key = self::keyOf(Model::NFCE, $in);
        $substitute = $in->accessKey('substituteAccessKey');
        if ((int) substr($substitute, 20, 2) !== Model::NFCE->code()) {
            throw ServiceError::invalid('substituteAccessKey is not of a model 65 document.');
        }
        if ($substitute === $key) {
            throw ServiceError::invalid('substituteAccessKey must be another document\'s key.');
        }
        $protocol = $in->pattern('protocol', '/^[0-9]{15}$/', 'the 15-digit authorisation protocol');
        $reason = $in->text('reason', 15, 255);
        $tools = $this->toolsForKey($in, Model::NFCE, $environment, $key);
        return $this->sendCancel(
            $tools,
            $key,
            fn (): string => $tools->sefazCancelaPorSubstituicao($key, $reason, $protocol, $substitute, DocumentMapper::PROCESS_VERSION),
        );
    }

    /** One cancel event, sent and settled: 218/573 and a request with no answer are looked up. */
    private function sendCancel(Tools $tools, string $key, callable $send): Response
    {
        try {
            $reply = $this->exchange($send);
        } catch (TransportFailure $failure) {
            if ($failure->kind !== TransportFailure::NO_ANSWER) {
                throw Classifier::fromTransport($failure, false);
            }
            return $this->cancelSettledByLookup($tools, $key, null);
        }
        $status = $reply->status() === '128' ? (string) $reply->value('cStat', 'infEvento') : $reply->status();
        if (in_array($status, self::ALREADY_CANCELLED, true)) {
            return $this->cancelSettledByLookup($tools, $key, Classifier::fromStatus($status, self::reasonOf($reply, 'infEvento'), $reply, false));
        }
        if (!in_array($status, self::EVENT_REGISTERED, true)) {
            throw Classifier::fromStatus($status, self::reasonOf($reply, 'infEvento'), $reply, false);
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
        $reply = $this->settled(fn (): string => $tools->sefazConsultaChave($key), false);
        $status = $reply->status();
        $state = match (true) {
            in_array($status, self::AUTHORIZED, true) => 'AUTHORIZED',
            in_array($status, self::CANCELLED, true) => 'CANCELLED',
            in_array($status, self::DENIED, true) => 'DENIED',
            $status === self::NOT_FOUND => 'NOT_FOUND',
            default => throw Classifier::fromStatus($status, $reply->reason(), $reply, false),
        };
        return new Response(200, self::answer($reply, $status, null) + [
            'status' => $state,
            'accessKey' => $key,
            'protocol' => $reply->value('nProt', 'protNFe'),
        ]);
    }

    /**
     * `POST /inutilize`. 563 ("a request for the same range already exists")
     * is what a retried inutilização gets once the first went through, so it
     * answers INUTILIZED too, with no protocol of its own: the range is void at
     * SEFAZ either way, and SEFAZ offers no query that would return the first
     * protocol. A request sent with no answer is RETRYABLE: resending is safe.
     */
    public function inutilize(Input $in): Response
    {
        $environment = $in->environment();
        $model = Model::from($in->pattern('model', '/^(nfe|nfce)$/', '"nfe" or "nfce"'));
        $uf = $in->pattern('uf', '/^[A-Z]{2}$/', 'a two-letter UF');
        $cnpj = $in->pattern('cnpj', '/^[A-Z0-9]{12}[0-9]{2}$/', 'a 14-character CNPJ');
        $year = $in->digits('year', 2000, 2099);
        $series = $in->digits('series', 0, 999);
        $from = $in->digits('from', 1, 999999999);
        $to = $in->digits('to', $from, 999999999);
        $reason = $in->text('reason', 15, 255);
        $certificate = Credentials::open($in->certificate());
        $tools = Sefaz::tools($this->transport, $certificate, $model, $environment, $uf, $cnpj, null);
        $reply = $this->settled(
            fn (): string => $tools->sefazInutiliza($series, $from, $to, $reason, $environment, substr((string) $year, 2)),
            false,
        );
        $status = $reply->status();
        if ($status === self::INUTILIZATION_EXISTS) {
            return new Response(200, self::answer($reply, $status, null) + [
                'status' => 'INUTILIZED',
                'protocol' => null,
                'registeredAt' => $reply->value('dhRecbto'),
                'inutilizationXml' => null,
            ]);
        }
        if ($status !== '102') {
            throw Classifier::fromStatus($status, $reply->reason(), $reply, false);
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

    /**
     * Sends a signed document and answers what SEFAZ decided. When the answer
     * says SEFAZ already holds the key (204 authorised, 205 denied) or the
     * request went out with no answer, the key is looked up and THAT is the
     * answer, so a retry never turns an authorised document into a rejection.
     *
     * @param bool $issuing the `/issue` endpoint: SEFAZ stopped (108, 109) is CONTINGENCY there
     * @param bool $offlineAllowed issuing an NFC-e: nothing reached SEFAZ is CONTINGENCY there
     */
    private function transmitSigned(Tools $tools, string $signed, string $accessKey, bool $issuing, bool $offlineAllowed): Response
    {
        $batch = substr($accessKey, 22, 15);
        try {
            $reply = $this->exchange(fn (): string => $tools->sefazEnviaLote([$signed], $batch, 1));
        } catch (TransportFailure $failure) {
            if ($failure->kind === TransportFailure::NO_ANSWER) {
                return $this->issueSettledByLookup($tools, $signed, $accessKey, $offlineAllowed, true);
            }
            throw Classifier::fromTransport($failure, $offlineAllowed)->withDocument($accessKey, $signed);
        } catch (ServiceError $error) {
            throw $error->withDocument($accessKey, $signed);
        }
        $processed = $reply->status() === '104' && $reply->has('infProt');
        $status = $processed ? (string) $reply->value('cStat', 'infProt') : $reply->status();
        if (in_array($status, self::AUTHORIZED, true) || in_array($status, self::DENIED, true)) {
            return self::issued($reply, $status, $signed, $accessKey, null);
        }
        if (in_array($status, self::ALREADY_HELD, true)) {
            return $this->issueSettledByLookup($tools, $signed, $accessKey, $offlineAllowed, false);
        }
        throw Classifier::fromStatus($status, self::reasonOf($reply, $processed ? 'infProt' : null), $reply, $issuing)
            ->withDocument($accessKey, $signed);
    }

    /**
     * The key looked up, after a 204/205 or a request with no answer. SEFAZ's
     * answer is final; only when the lookup itself cannot reach SEFAZ does an
     * NFC-e being issued go offline (owner's ruling: look up first, never a
     * blind contingency that could put a second document on the same sale).
     */
    private function issueSettledByLookup(
        Tools $tools,
        string $signed,
        string $accessKey,
        bool $offlineAllowed,
        bool $afterNoAnswer,
    ): Response {
        try {
            $lookup = $this->exchange(fn (): string => $tools->sefazConsultaChave($accessKey));
        } catch (TransportFailure $failure) {
            throw self::unsettled($failure, $offlineAllowed, $afterNoAnswer)->withDocument($accessKey, $signed);
        } catch (ServiceError $error) {
            throw $error->withDocument($accessKey, $signed);
        }
        $status = $lookup->status();
        if (in_array($status, self::AUTHORIZED, true) || in_array($status, self::DENIED, true)) {
            return self::issued($lookup, $status, $signed, $accessKey, 'protNFe');
        }
        if ($status === self::NOT_FOUND) {
            throw (new ServiceError(
                ErrorClass::RETRYABLE,
                'SEFAZ holds no document under this key: it never received it, so send it again.',
                $status,
                [],
                null,
                null,
                $lookup->raw,
            ))->withDocument($accessKey, $signed);
        }
        throw Classifier::fromStatus($status, $lookup->reason(), $lookup, false)->withDocument($accessKey, $signed);
    }

    /** A cancel settled by the key's state, after 218/573 (`$original`) or a request with no answer (null). */
    private function cancelSettledByLookup(Tools $tools, string $key, ?ServiceError $original): Response
    {
        try {
            $lookup = $this->exchange(fn (): string => $tools->sefazConsultaChave($key));
        } catch (TransportFailure $failure) {
            throw $original ?? self::unsettled($failure, false, true);
        }
        $status = $lookup->status();
        if (!in_array($status, self::CANCELLED, true)) {
            throw $original ?? new ServiceError(
                ErrorClass::RETRYABLE,
                "The cancel got no answer and SEFAZ still reports [$status] {$lookup->reason()}: send it again.",
                $status,
                [],
                null,
                null,
                $lookup->raw,
            );
        }
        return new Response(200, self::answer($lookup, $status, null) + [
            'status' => 'CANCELLED',
            'accessKey' => $key,
            'protocol' => $lookup->value('nProt', 'retEvento'),
            'registeredAt' => $lookup->value('dhRegEvento', 'retEvento'),
            'eventXml' => $lookup->element('procEventoNFe'),
        ]);
    }

    /** The lookup that would settle an outcome could not reach SEFAZ either. */
    private static function unsettled(TransportFailure $failure, bool $offlineAllowed, bool $afterNoAnswer): ServiceError
    {
        if ($failure->kind === TransportFailure::TLS_REFUSED) {
            return Classifier::fromTransport($failure, false);
        }
        return new ServiceError(
            $offlineAllowed ? ErrorClass::CONTINGENCY : ErrorClass::RETRYABLE,
            ($afterNoAnswer ? 'The request went out with no answer, and ' : '')
            . 'the lookup that would settle it could not reach SEFAZ (' . $failure->getMessage() . ').',
            outcomeUnknown: $afterNoAnswer,
        );
    }

    /** `AUTHORIZED` or `DENIED`, with the protocol from the reply's `$group` (`infProt` when null). */
    private static function issued(SefazReply $reply, string $status, string $signed, string $accessKey, ?string $group): Response
    {
        $group ??= 'infProt';
        $sefazDigest = $reply->value('digVal', $group);
        if ($sefazDigest !== null && $sefazDigest !== self::digestOf($signed)) {
            throw (new ServiceError(
                ErrorClass::REJECTED,
                'SEFAZ holds a DIFFERENT document under this key (its digest is not this XML\'s).',
                $status,
                [],
                null,
                null,
                $reply->raw,
            ))->withDocument($accessKey, $signed);
        }
        return new Response(200, self::answer($reply, $status, $group) + [
            'status' => in_array($status, self::DENIED, true) ? 'DENIED' : 'AUTHORIZED',
            'accessKey' => $accessKey,
            'protocol' => (string) $reply->value('nProt', $group),
            'authorizedAt' => (string) $reply->value('dhRecbto', $group),
            'signedXml' => $signed,
            'authorizedXml' => self::protocolled($signed, $reply->raw),
        ]);
    }

    private static function digestOf(string $signed): ?string
    {
        return preg_match('#<DigestValue>([^<]+)</DigestValue>#', $signed, $match) === 1 ? $match[1] : null;
    }

    /**
     * One request to SEFAZ, its reply read. A transport failure is thrown as
     * is, for the caller to decide (a lookup first, or a class).
     *
     * @param callable(): string $call
     */
    private function exchange(callable $call): SefazReply
    {
        return SefazReply::parse($this->library($call));
    }

    /**
     * An exchange whose transport failure is final: classified, never settled.
     *
     * @param callable(): string $call
     */
    private function settled(callable $call, bool $offlineAllowed): SefazReply
    {
        try {
            return $this->exchange($call);
        } catch (TransportFailure $failure) {
            throw Classifier::fromTransport($failure, $offlineAllowed);
        }
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
