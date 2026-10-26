import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutComponents } from "./ui";
import type { EmptyCartCopy } from "./view-copy";

/** Empty-cart state shown when there's nothing to check out. */
export function EmptyCart({ copy, onBack }: { copy: EmptyCartCopy; onBack: () => void }): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  return (
    <Box data-testid="checkout-empty" sx={{ py: 8, textAlign: "center", display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
      <Text variant="heading" size="md" as="p">
        {copy.title}
      </Text>
      <Button variant="solid" color="primary" size="md" onClick={onBack} dataTestId="checkout-empty-back">
        {copy.action}
      </Button>
    </Box>
  );
}
