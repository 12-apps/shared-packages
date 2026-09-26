/**
 * The pt-BR pack for the layout family. Split out of `pt-BR.ts`, which is a
 * barrel over this folder — see that file for why.
 */
import type {
  SettingCardCopy,
  SettingSwitchCopy,
  TableFilterCopy,
} from './copy';

export const PT_BR_TABLE_FILTER_COPY: TableFilterCopy = {
  clearAllFilters: "Limpar todos os filtros",
  clearKeyword: "Limpar a busca",
  invalidRange: "O máximo deve ser maior ou igual ao mínimo.",
  rangeMin: "Mínimo",
  rangeMax: "Máximo",
};

export const PT_BR_SETTING_CARD_COPY: SettingCardCopy = {
  edit: "Editar",
  cancel: "Cancelar",
  save: "Salvar",
  saving: "Salvando…",
  learnMore: "Saiba mais",
  saveFailed: "Não foi possível salvar. Tente novamente.",
};

export const PT_BR_SETTING_SWITCH_COPY: SettingSwitchCopy = {
  saving: "Salvando…",
  saveFailed: "Não foi possível salvar. Tente novamente.",
};
