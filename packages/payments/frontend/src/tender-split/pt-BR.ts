import type { TenderSplitCopy } from './copy';

/** `TenderSplit` in pt-BR — a named pack, never a default (see `./copy`). */
export const PT_BR_TENDER_SPLIT_COPY: TenderSplitCopy = {
  launchedLabel: 'Lançado',
  missingLabel: 'Falta',
  coveredLabel: 'Fechou',
  over: (amount) => `Passou ${amount}`,
  progressLabel: 'Quanto da conta já foi lançado',
  sharedHint: 'dividido',
  amountLabel: (tender) => `Valor em ${tender}`,
  remove: (tender) => `Tirar ${tender}`,
  changeLabel: 'Troco',
  pickFirst: 'Escolha a forma',
  missing: (amount) => `Falta ${amount}`,
  invalid: 'Valor inválido',
  confirm: (amount) => `Confirmar ${amount}`,
  cancel: 'Cancelar',
};
