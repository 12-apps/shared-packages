<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use Fiscal\Sidecar\ServiceError;

/**
 * The envelope fields of a request, read with their rules. A field that breaks
 * one is INVALID, named, and its value is never quoted back (it may be the
 * password).
 */
final class Input
{
    /** @param array<string, mixed> $body */
    public function __construct(private readonly array $body)
    {
    }

    /** `tpAmb`: 1 production, 2 homologação. */
    public function environment(): int
    {
        return match ($this->body['environment'] ?? null) {
            'producao' => 1,
            'homologacao' => 2,
            default => throw ServiceError::invalid('environment must be "homologacao" or "producao".'),
        };
    }

    /** @return array{pfx: string, password: string} */
    public function certificate(): array
    {
        $certificate = $this->body['certificate'] ?? null;
        if (!is_array($certificate) || !is_string($certificate['pfxBase64'] ?? null)
            || !is_string($certificate['password'] ?? null)) {
            throw ServiceError::invalid('certificate must be { pfxBase64, password }.');
        }
        $pfx = base64_decode($certificate['pfxBase64'], true);
        if ($pfx === false || $pfx === '') {
            throw ServiceError::invalid('certificate.pfxBase64 is not base64.');
        }
        return ['pfx' => $pfx, 'password' => $certificate['password']];
    }

    /** @return array{id: string, token: string}|null */
    public function csc(Model $model): ?array
    {
        $csc = $this->body['csc'] ?? null;
        if ($model === Model::NFE) {
            if ($csc !== null) {
                throw ServiceError::invalid('csc belongs to an NFC-e; an NF-e takes null.');
            }
            return null;
        }
        if (!is_array($csc) || !is_string($csc['id'] ?? null) || !is_string($csc['token'] ?? null)
            || preg_match('/^[0-9]{1,6}$/', $csc['id']) !== 1 || strlen($csc['token']) < 16
            || strlen($csc['token']) > 36) {
            throw ServiceError::invalid('An NFC-e needs csc: { id: up to 6 digits, token: 16 to 36 characters }.');
        }
        return ['id' => $csc['id'], 'token' => $csc['token']];
    }

    /** @return array<string, mixed> */
    public function document(): array
    {
        $document = $this->body['document'] ?? null;
        if (!is_array($document)) {
            throw ServiceError::invalid('document must be a SaleForDocument object.');
        }
        DocumentSchema::assertValid($document);
        return $document;
    }

    /** @return array{since: string, reason: string} */
    public function contingency(): array
    {
        $contingency = $this->body['contingency'] ?? null;
        $since = is_array($contingency) ? ($contingency['since'] ?? null) : null;
        $reason = is_array($contingency) ? ($contingency['reason'] ?? null) : null;
        if (!is_string($since) || \DateTimeImmutable::createFromFormat(DATE_ATOM, $since) === false
            || !is_string($reason) || mb_strlen(trim($reason)) < 15 || mb_strlen($reason) > 256) {
            throw ServiceError::invalid(
                'contingency must be { since: ISO 8601 with offset, reason: 15 to 256 characters }.',
            );
        }
        return ['since' => $since, 'reason' => trim($reason)];
    }

    public function accessKey(string $field = 'accessKey'): string
    {
        $key = $this->body[$field] ?? null;
        if (!is_string($key) || preg_match('/^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/', $key) !== 1) {
            throw ServiceError::invalid("$field must be the 44-character access key.");
        }
        return $key;
    }

    public function digits(string $field, int $min, int $max): int
    {
        $value = $this->body[$field] ?? null;
        if (!is_int($value) || $value < $min || $value > $max) {
            throw ServiceError::invalid("$field must be an integer from $min to $max.");
        }
        return $value;
    }

    public function text(string $field, int $min, int $max): string
    {
        $value = $this->body[$field] ?? null;
        if (!is_string($value) || mb_strlen(trim($value)) < $min || mb_strlen($value) > $max) {
            throw ServiceError::invalid("$field must be text of $min to $max characters.");
        }
        return trim($value);
    }

    public function pattern(string $field, string $regex, string $rule): string
    {
        $value = $this->body[$field] ?? null;
        if (!is_string($value) || preg_match($regex, $value) !== 1) {
            throw ServiceError::invalid("$field must be $rule.");
        }
        return $value;
    }
}
