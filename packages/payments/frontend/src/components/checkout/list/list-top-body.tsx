import { Box } from "@mui/material";
import { useRef, type JSX } from "react";

import { CpfTop } from "./cpf-top";
import type { ListTopInput } from "./list-top";
import { cpfProvider } from "./top-cpf";
import { WalletBlock } from "./wallet-block";

/** Move the focus to "Número do cartão" — the next thing to type once the CPF is complete. */
function focusCardNumber(scope: HTMLElement | null): void {
  scope?.closest('[data-testid="payment-list"]')?.querySelector<HTMLInputElement>('input[data-testid="card-number"]')?.focus();
}

/**
 * What the top of Pagamento draws (FUT-3685): the CPF field, then the
 * "PAGAMENTO RÁPIDO" block — loaded only when `ListTop` decides there is one
 * to draw (FUT-3711).
 */
export function ListTopBody({ props, held, failure, onGoogle, onApple }: ListTopInput): JSX.Element {
  const scope = useRef<HTMLDivElement | null>(null);
  const { list, state, cap, config, c } = props;
  const typingCard = state.choice?.kind === "online" && state.choice.method === "CARD";
  return (
    <Box ref={scope} data-testid="list-top" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {state.top ? (
        <CpfTop
          field={state.top}
          buyer={c.buyer}
          onBuyerChange={c.setBuyer}
          copy={list.copy.buyer}
          provider={cpfProvider(config?.chain, state.methods)}
          onComplete={typingCard ? () => focusCardNumber(scope.current) : undefined}
          focusOnMount={props.revealed}
          onKeepSaved={props.revealed ? props.onKeepSavedCpf : undefined}
        />
      ) : null}
      <WalletBlock cap={cap} copy={list.copy} held={held} failure={failure} onGoogle={onGoogle} onApple={onApple} />
    </Box>
  );
}
