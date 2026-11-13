<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use DOMDocument;
use DOMElement;
use Fiscal\Sidecar\ErrorClass;
use Fiscal\Sidecar\ServiceError;

/** What SEFAZ answered, read: the status of the reply and of the group inside it. */
final class SefazReply
{
    private function __construct(
        public readonly string $raw,
        private readonly DOMDocument $dom,
    ) {
    }

    public static function parse(string $raw): self
    {
        $dom = new DOMDocument();
        $previous = libxml_use_internal_errors(true);
        $loaded = $raw !== '' && $dom->loadXML($raw, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        if (!$loaded || $dom->getElementsByTagName('cStat')->length === 0) {
            throw new ServiceError(
                ErrorClass::RETRYABLE,
                'SEFAZ answered with no status the service can read.',
                null,
                [],
                null,
                null,
                $raw,
            );
        }
        return new self($raw, $dom);
    }

    /** `cStat` of the reply's own envelope (the first in document order). */
    public function status(): string
    {
        return $this->value('cStat') ?? '';
    }

    public function reason(): string
    {
        return $this->value('xMotivo') ?? '';
    }

    /** The first `$tag` inside the first `$group`, or of the whole reply when `$group` is null. */
    public function value(string $tag, ?string $group = null): ?string
    {
        $scope = $group === null ? $this->dom : $this->group($group);
        if ($scope === null) {
            return null;
        }
        $node = $scope->getElementsByTagName($tag)->item(0);
        return $node === null ? null : trim($node->nodeValue ?? '');
    }

    public function has(string $group): bool
    {
        return $this->group($group) !== null;
    }

    private function group(string $group): ?DOMElement
    {
        $node = $this->dom->getElementsByTagName($group)->item(0);
        return $node instanceof DOMElement ? $node : null;
    }
}
