<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Unit;

use Fiscal\Sidecar\Nfe\DocumentSchema;
use Fiscal\Sidecar\ServiceError;
use Fiscal\Sidecar\Tests\Support\Fixtures;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** The service validates the document against the schema `@12-apps/fiscal` publishes. */
final class DocumentSchemaTest extends TestCase
{
    public function testTheFixturesAreValidDocuments(): void
    {
        DocumentSchema::assertValid(Fixtures::document('nfce-simples'));
        DocumentSchema::assertValid(Fixtures::document('nfe-normal-company-buyer'));
        $this->addToAssertionCount(2);
    }

    /** @return iterable<string, array{callable(array<string, mixed>): array<string, mixed>, string}> */
    public static function brokenDocuments(): iterable
    {
        yield 'a missing field' => [static function (array $d): array {
            unset($d['keyCode']);
            return $d;
        }, 'keyCode'];
        yield 'an unknown field' => [static fn (array $d): array => $d + ['discount' => 1], 'discount'];
        yield 'money as a float' => [static function (array $d): array {
            $d['lines'][0]['valueCents'] = 39.9;
            return $d;
        }, 'lines[0].valueCents'];
        yield 'a payment method not in the list' => [static function (array $d): array {
            $d['payments'][0]['method'] = 'CRYPTO';
            return $d;
        }, 'payments[0].method'];
        yield 'a version from the future' => [static fn (array $d): array => ['version' => 2] + $d, 'version'];
        yield 'an offset-less issue time' => [static function (array $d): array {
            $d['issuedAt'] = '2026-11-20T12:30:00';
            return $d;
        }, 'issuedAt'];
        yield 'no lines' => [static function (array $d): array {
            $d['lines'] = [];
            return $d;
        }, 'lines'];
    }

    /** @param callable(array<string, mixed>): array<string, mixed> $break */
    #[DataProvider('brokenDocuments')]
    public function testABrokenDocumentIsInvalidAndNamesTheField(callable $break, string $field): void
    {
        try {
            DocumentSchema::assertValid($break(Fixtures::document('nfce-simples')));
            self::fail('accepted');
        } catch (ServiceError $error) {
            self::assertSame('INVALID', $error->class->value);
            self::assertStringContainsString($field, implode("\n", $error->details));
        }
    }
}
