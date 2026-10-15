import { Box, Chip } from "@mui/material";
import { useMemo, useState, type JSX, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { PT_BR_PAYMENT_LIST_COPY } from "../components/checkout/list/pt-BR";
import type { CheckoutDoorOption, CheckoutPaymentList } from "../index";

import { StoryFlow, type StoryHost } from "./host";
import type { StorySpec } from "./store";
import type { StoryProvider } from "./store-adapter";

/**
 * THE PAGAMENTO STEP AS ONE LIST (FUT-3591/3592), against a real mount.
 *
 * The frame around it — the page colour, the 512px column, the "4 Pagamento"
 * step card — is HOST chrome, drawn here only so the list can be looked at
 * the way the entrega checkout will hold it; it is not part of the package.
 * So are the door options: a host's `CheckoutDoorOption[]`, kept as plain
 * state here (the real ones come from the host's own settlement package).
 *
 * The card runs in the server's stub mode: a saved card or `4111 1111 1111
 * 1111` settles, `4000 0000 0000 0002` declines.
 */
const meta: Meta = { title: "Checkout/Pagamento — one list" };
export default meta;

const ON_PAGE: StoryProvider = { name: "aurora", methods: ["PIX", "CARD"], stub: true, publicKey: null, checkoutScreen: "pix-and-card" };
const SAVED = [{ id: "vault_1", last4: "4242", brand: "Visa", expMonth: 11, expYear: 2032 }];

/** A host's two door options, with the troco question as plain chips. */
function useDemoDoor(): CheckoutDoorOption[] {
  const [troco, setTroco] = useState<string | null>(null);
  return [
    {
      id: "cash",
      label: "Dinheiro",
      action: "Enviar pedido",
      blocked: troco === null ? "Diga se precisa de troco." : null,
      onSend: () => undefined,
      content: (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box component="span" sx={{ typography: "body2", fontWeight: 600 }}>Precisa de troco?</Box>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {["Não preciso", "R$ 30", "R$ 40", "R$ 50"].map((label) => (
              <Chip key={label} label={label} clickable color={troco === label ? "primary" : "default"} onClick={() => setTroco(label)} />
            ))}
          </Box>
        </Box>
      ),
    },
    {
      id: "reader",
      label: "Maquininha",
      hint: "Crédito, débito, vale-refeição ou Pix",
      hideHintWhileChosen: true,
      action: "Enviar pedido",
      blocked: null,
      onSend: () => undefined,
      content: (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, typography: "body2", color: "text.secondary" }}>
          <span><b>Crédito</b>: Visa, Mastercard, Elo, Amex, Hipercard e Diners</span>
          <span><b>Débito</b>: Visa, Mastercard e Elo</span>
          <span><b>Pix</b>: o entregador mostra o QR na maquininha</span>
        </Box>
      ),
    },
  ];
}

function useDemoList(withDoor: boolean): CheckoutPaymentList {
  const door = useDemoDoor();
  return useMemo(
    () => ({
      copy: PT_BR_PAYMENT_LIST_COPY,
      summary: <Box component="span" sx={{ typography: "body2" }}>2 itens · Taxa de entrega R$ 5,00</Box>,
      onlineExtras: (
        <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 1, typography: "body2" }}>
          <input type="checkbox" defaultChecked /> Usar meus R$ 5,00 de crédito na loja
        </Box>
      ),
      door: withDoor ? door : [],
    }),
    [door, withDoor],
  );
}

/** The host's chrome around the step: page, 512px column, the step card. */
function HostFrame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", px: 2, pt: 2 }}>
      <Box sx={{ maxWidth: 512, mx: "auto" }}>
        <Box sx={{ bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 3, boxShadow: 1, p: 1.75, display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, typography: "subtitle1", fontWeight: 700 }}>
            <Box sx={{ width: 26, height: 26, borderRadius: "50%", border: "2px solid", borderColor: "primary.main", color: "primary.main", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem" }}>4</Box>
            Pagamento
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

function scene(spec: StorySpec, host: StoryHost, withDoor = true): StoryObj {
  // The list is the host's HOOK, called inside the checkout on every render —
  // so the door options' own state (the troco answer) reaches the bar.
  const usePaymentList = (): CheckoutPaymentList => useDemoList(withDoor);
  return {
    render: () => (
      <StoryFlow spec={spec} host={{ ...host, usePaymentList }}>
        {(flows) => (
          <HostFrame>
            <flows.Checkout />
          </HostFrame>
        )}
      </StoryFlow>
    ),
  };
}

/**
 * The story mount keeps no buyer profile, so "CPF on file" is played by a CPF
 * the host already holds in the buyer it passes — a real host's server reads
 * the saved one instead.
 */
const ON_FILE = { name: "Ana Teste", taxId: "529.982.247-25" };

/** A returning buyer: CPF on file, a saved Visa — the card comes chosen and Pagar is live. */
export const SavedCard: StoryObj = scene({ chain: [ON_PAGE], instruments: SAVED, amountCents: 2700 }, { taxIdOnFile: true, buyer: ON_FILE });

/** A new buyer: no CPF, no card — nothing chosen; the CPF is asked inside the option, above the card fields. */
export const NewBuyer: StoryObj = scene({ chain: [ON_PAGE], amountCents: 2700 }, { taxIdOnFile: false, buyer: { name: "Ana Teste" } });

/** A store that finishes on its own page: one "Pix ou cartão" row, and the buyer's mobile asked inside it. */
export const HandOffStore: StoryObj = scene(
  {
    chain: [{ name: "boreal", methods: ["PIX", "CARD"], stub: true, publicKey: null, hosted: true, checkoutScreen: "hosted-link", customerSchema: [{ key: "phone", type: "MOBILE", required: true }] }],
    amountCents: 2700,
  },
  { taxIdOnFile: false, buyer: { name: "Ana Teste" }, onNavigate: () => undefined },
);

/** Online only — no door options: one heading, no "PAGAR NA ENTREGA". */
export const OnlineOnly: StoryObj = scene({ chain: [ON_PAGE], instruments: SAVED, amountCents: 2700 }, { taxIdOnFile: true, buyer: ON_FILE }, false);
