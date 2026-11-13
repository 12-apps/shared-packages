/**
 * `@12-apps/fiscal/danfe` — the DANFE NFC-e as ESC/POS-ready lines for 58 and
 * 80 mm rolls, from the authorised XML (or the signed one of a document issued
 * offline, which prints the contingency variant). The words come from the
 * host; `./danfe/pt-BR` carries the Manual's own words (`./danfe/en-US` an English pack for previews).
 */

export { DANFE_COLUMNS, money, renderDanfeNfce, wrap } from "./render";
export type { DanfeDivision, DanfeLine, DanfeNfceInput, PaperWidth } from "./render";
export { DANFE_LABEL_KEYS } from "./labels";
export type { DanfeNfceLabels } from "./labels";
