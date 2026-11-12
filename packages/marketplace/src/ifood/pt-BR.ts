import type { IfoodAdapterCopy } from "./copy";

/**
 * The iFood adapter's pt-BR pack. The reason labels are iFood's OWN, as its
 * merchant portal words them (from the portal's search snippets, 2026-11-11 —
 * unverified until a homologation run; see `./outbound.ts`). A host passes
 * this pack by hand: choosing the language is a line in the host's diff.
 */
export const IFOOD_ADAPTER_COPY_PT_BR = {
  reasonLabels: {
    "501": "Problemas de sistema",
    "502": "Pedido em duplicidade",
    "503": "Item indisponível",
    "504": "Restaurante sem motoboy",
    "505": "Cardápio desatualizado",
    "506": "Pedido fora da área de entrega",
    "507": "Cliente golpista / trote",
    "508": "Fora do horário do delivery",
    "509": "Dificuldades internas do restaurante",
    "511": "Área de risco",
    "512": "Restaurante abrirá mais tarde",
    "513": "Restaurante fechado",
  },
  missingStreetNumber: "s/n",
} as const satisfies IfoodAdapterCopy;
