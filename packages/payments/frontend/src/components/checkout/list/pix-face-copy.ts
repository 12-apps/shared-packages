/**
 * The words of the raised Pix in the one list (`list-pix.tsx`), split out of
 * `./types.ts` when the countdown (FUT-1181) took that file past its size gate.
 */
export interface PixFaceCopy {
  /** "Pague R$ 22,00 com Pix". */
  title: (total: string) => string;
  /**
   * How to pay with the code, under it: "Copie e cole no app do seu banco, em
   * **Pix Copia e Cola**. A confirmação é automática." — without the last
   * sentence when the store confirms the Pix (`storeConfirms`). `**…**` is
   * drawn bold. The deadline is the countdown's (`expiresIn`), not this line's.
   */
  howToPay: (storeConfirms: boolean) => string;
  /** The countdown beside the title: "expira em 12:34" (FUT-1181). */
  expiresIn: (clock: string) => string;
  /** Under the countdown in its last two minutes: "Menos de 2 minutos. Se expirar, é só gerar outro — nada é cobrado." */
  lastMinutes: string;
  /** The same, for a Pix the store confirms: "Menos de 2 minutos. Se você já pagou, não pague de novo — a loja confirma." */
  lastMinutesByStore: string;
  /** "Mostrar QR code (para outro aparelho)". */
  showQr: string;
  /** "Ocultar QR code". */
  hideQr: string;
  /** Beside the QR on a phone: "Para pagar de outro celular: no app do banco, Pix › Ler QR code." */
  qrCaption: string;
  changeMethod: string;
  /** The bar's action, and the accessible name of the tappable code. */
  copyCode: string;
  waiting: string;
}
