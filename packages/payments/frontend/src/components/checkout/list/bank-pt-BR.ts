import type { PixBankCopy } from "./types";

/** The Pix-to-bank flow's words, pt-BR (FUT-3612). */
export const PT_BR_PIX_BANK_COPY: PixBankCopy = {
  names: {
    nubank: { name: "Nubank", the: "o " },
    itau: { name: "Itaú", the: "o " },
    bradesco: { name: "Bradesco", the: "o " },
    bb: { name: "Banco do Brasil", the: "o " },
    caixa: { name: "Caixa", the: "a " },
    santander: { name: "Santander", the: "o " },
  },
  generateAndCopy: "Gerar e copiar o Pix",
  generateCopyAndOpen: (bank) => `Gerar, copiar e abrir ${bank.the}${bank.name}`,
  copyAndOpen: (bank) => `Copiar e abrir ${bank.the}${bank.name}`,
  openOther: "Abrir outro banco",
  listTitle: "Abra seu banco e cole em Pix copia e cola",
  open: (bank) => `Abrir ${bank.name}`,
  opening: (bank) => `Abrindo ${bank.the}**${bank.name}**…`,
  other: "Outro banco",
  notOpened: (bank) => `Não conseguimos abrir ${bank.the}${bank.name}. O app está instalado neste celular?`,
  retry: "Tentar de novo",
  appHint: "Abra o app do seu banco e cole em Pix copia e cola.",
  copied: "Código Pix copiado",
  copiedPick: "Código Pix copiado. Escolha o banco.",
  copiedOpening: (bank) => `Código Pix copiado. Abrindo ${bank.the}${bank.name}…`,
};
