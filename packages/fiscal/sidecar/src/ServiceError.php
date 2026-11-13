<?php

declare(strict_types=1);

namespace Fiscal\Sidecar;

use RuntimeException;
use Throwable;

/**
 * A classified failure. Its message goes to the CALLER, never to the request
 * log, which records the class and the code only.
 */
final class ServiceError extends RuntimeException
{
    /**
     * @param list<string> $details
     */
    public function __construct(
        public readonly ErrorClass $class,
        string $message,
        public readonly ?string $sefazCode = null,
        public readonly array $details = [],
        public readonly ?string $accessKey = null,
        public readonly ?string $signedXml = null,
        public readonly ?string $sefazReply = null,
        ?Throwable $previous = null,
        public readonly bool $outcomeUnknown = false,
    ) {
        parent::__construct($message, 0, $previous);
    }

    /** @param list<string> $details */
    public static function invalid(string $message, array $details = []): self
    {
        return new self(ErrorClass::INVALID, $message, null, $details);
    }

    /** The same failure, now knowing the document it concerned. */
    public function withDocument(?string $accessKey, ?string $signedXml): self
    {
        return new self(
            $this->class,
            $this->getMessage(),
            $this->sefazCode,
            $this->details,
            $this->accessKey ?? $accessKey,
            $this->signedXml ?? $signedXml,
            $this->sefazReply,
            $this,
            $this->outcomeUnknown,
        );
    }

    /** @return array{error: array<string, mixed>} */
    public function toBody(): array
    {
        return ['error' => [
            'class' => $this->class->value,
            'code' => $this->sefazCode,
            'message' => $this->getMessage(),
            'details' => $this->details,
            'accessKey' => $this->accessKey,
            'signedXml' => $this->signedXml,
            'sefazReply' => $this->sefazReply,
            'outcomeUnknown' => $this->outcomeUnknown,
        ]];
    }
}
