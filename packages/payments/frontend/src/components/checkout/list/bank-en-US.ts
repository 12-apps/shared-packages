import type { PixBankCopy } from "./types";

/** The Pix-to-bank flow's words, en-US (FUT-3612). */
export const EN_US_PIX_BANK_COPY: PixBankCopy = {
  names: {
    nubank: { name: "Nubank", the: "" },
    itau: { name: "Itaú", the: "" },
    bradesco: { name: "Bradesco", the: "" },
    bb: { name: "Banco do Brasil", the: "" },
    caixa: { name: "Caixa", the: "" },
    santander: { name: "Santander", the: "" },
  },
  generateAndCopy: "Create and copy the Pix",
  generateCopyAndOpen: (bank) => `Create, copy and open ${bank.name}`,
  copyAndOpen: (bank) => `Copy and open ${bank.name}`,
  openOther: "Open another bank",
  listTitle: "Open your bank and paste in Pix copia e cola",
  open: (bank) => `Open ${bank.name}`,
  opening: (bank) => `Opening **${bank.name}**…`,
  other: "Another bank",
  notOpened: (bank) => `We couldn't open ${bank.name}. Is the app installed on this phone?`,
  retry: "Try again",
  copied: "Pix code copied",
  copiedPick: "Pix code copied. Choose your bank.",
  copiedOpening: (bank) => `Pix code copied. Opening ${bank.name}…`,
};
