/**
 * The pt-BR pack for the shared family. Split out of `pt-BR.ts`, which is a
 * barrel over this folder — see that file for why.
 */
import type { SavedViewsLabels } from "./components/layout/ContentToolbar/ContentToolbar.types";
import type {
  CategorySelectCopy,
  CepFieldCopy,
  ConfirmActionCopy,
  SectionOnboardingCopy,
} from './copy';

export const PT_BR_SECTION_ONBOARDING_COPY: SectionOnboardingCopy = {
  edit: "Editar",
  collapse: "Ocultar",
  start: "Começar",
};

export const PT_BR_CONFIRM_ACTION_COPY: ConfirmActionCopy = {
  cancel: "Cancelar",
  defaultError: "Não foi possível concluir a ação. Tente novamente.",
  irreversible: "Esta ação não pode ser desfeita.",
  typeToConfirm: (expected) => `Digite "${expected}" para confirmar.`,
};

export const PT_BR_CATEGORY_SELECT_COPY: CategorySelectCopy = {
  purpose: "Categorias organizam o cardápio e os filtros da loja.",
  clearSelection: "Limpar seleção",
  selectAll: "Marcar tudo",
  deselectAll: "Desmarcar tudo",
  expandAll: "Expandir tudo",
  collapseAll: "Recolher tudo",
  expandCategory: (name) => `Expandir ${name}`,
  collapseCategory: (name) => `Recolher ${name}`,
  placeholderSingle: "Mover para…",
  placeholderMulti: "Categoria",
  emptyTitle: "Nenhuma categoria ainda",
  createCategory: "Criar categoria",
  noResults: {
    title: (query) => `Nada encontrado para “${query}”`,
    hint: "Tente outro termo ou verifique a grafia.",
    clearSearch: "Limpar busca",
    create: (query) => `Criar “${query}”`,
  },
  search: {
    placeholderSingle: "Buscar categoria…",
    placeholderMulti: "Buscar categoria ou subcategoria",
    clear: "Limpar busca",
    removeChip: (label) => `Remover ${label}`,
    pinnedLabel: (count) => `Selecionadas · ${count}`,
  },
  footer: {
    selectedCount: (count) => `${count} selecionada${count === 1 ? "" : "s"}`,
    clear: "Limpar",
    apply: "Aplicar",
    close: "Fechar",
    singleHint: "Escolha uma categoria",
    cancel: "Cancelar",
  },
};

export const PT_BR_CEP_FIELD_COPY: CepFieldCopy = {
  loading: "Buscando endereço…",
  found: "Endereço preenchido pelo CEP.",
  notfound: "CEP não encontrado — preencha o endereço manualmente.",
};

/**
 * The saved-views dropdown's labels.
 *
 * Typed as the package's OWN `SavedViewsLabels` rather than a parallel shape:
 * that interface already named every string, including the seven with no
 * diacritics the copy gate could not see (`Aplicar`, `Fixar na barra lateral`,
 * `Editar`…). The prop was `Partial<SavedViewsLabels>` with a pt-BR default —
 * configurable in the type, inherited in practice.
 */
export const PT_BR_SAVED_VIEWS_LABELS: SavedViewsLabels = {
  trigger: "Visões",
  mainView: "Visão principal",
  pinned: "Fixadas",
  recent: "Recentes",
  empty: "Nenhuma visão salva ainda.",
  saveCurrent: "+ Salvar visão atual",
  manageAll: "Gerenciar visões",
  apply: "Aplicar",
  setDefault: "Definir como padrão",
  pin: "Fixar na barra lateral",
  unpin: "Desafixar",
  share: "Compartilhar com a equipe",
  unshare: "Tornar privada",
  edit: "Editar",
  remove: "Excluir",
  defaultTag: "Padrão",
};
