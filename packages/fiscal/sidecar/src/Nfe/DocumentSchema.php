<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Nfe;

use Fiscal\Sidecar\ServiceError;
use JsonSchema\Constraints\Constraint;
use JsonSchema\Validator;

/**
 * The neutral document's JSON schema — the very file `@12-apps/fiscal`
 * publishes beside its `SaleForDocument` type.
 */
final class DocumentSchema
{
    public const PATH = __DIR__ . '/../../schema/sale-for-document.schema.json';

    /**
     * @param mixed $document the decoded JSON (arrays)
     * @throws ServiceError INVALID, one detail per violation
     */
    public static function assertValid(mixed $document): void
    {
        $schema = json_decode((string) file_get_contents(self::PATH));
        $data = json_decode((string) json_encode($document));
        $validator = new Validator();
        $validator->validate($data, $schema, Constraint::CHECK_MODE_NORMAL);
        if ($validator->isValid()) {
            return;
        }
        $details = [];
        foreach ($validator->getErrors() as $error) {
            $where = $error['property'] !== '' ? $error['property'] : '(document)';
            $details[] = "$where: {$error['message']}";
        }
        throw ServiceError::invalid('The document does not match the SaleForDocument schema.', $details);
    }
}
