import type { JSX } from "react";

import { Switch } from "@12-apps/ui/form/Switch";
import { useFormContext } from "@12-apps/ui/form/total-form";

import type { DiscountsWebCopy } from "./copy";
import { isComboKind } from "./form-kind";

/**
 * "Só na primeira compra do cliente nesta loja" (FUT-2825).
 *
 * Offered at the ORDER, CATEGORY and ITEM scopes only. A combo keeps its own
 * rules — "leve 3, pague 2" is a deal about the basket, not about who is
 * buying — so the switch is not drawn for one, and the server folds a combo's
 * value to false whatever a body sends.
 *
 * Its state is the parent's, like the two switches below it, so submit can
 * send it: `total-form` holds strings.
 */
export function FirstOrderField({
  copy,
  checked,
  onChange,
}: {
  copy: DiscountsWebCopy;
  checked: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element | null {
  const { values } = useFormContext();
  if (isComboKind(values.kind ?? "PERCENTAGE") || values.scope === "COMBO") return null;
  return (
    <Switch
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      label={copy.form.firstOrderOnly}
      description={copy.form.firstOrderOnlyHint}
      dataTestId="discount-first-order-only"
    />
  );
}
