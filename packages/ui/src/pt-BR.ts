import type { DataViewsCopy } from "./components/data-display/DataViews/data-views-copy";
import type { SavedViewsLabels } from "./components/layout/ContentToolbar/ContentToolbar.types";
import type {
  CategorySelectCopy,
  CepFieldCopy,
  ConfirmActionCopy,
  SectionOnboardingCopy,
  TableFilterCopy,
} from "./copy";

/**
 * The pt-BR packs — NAMED constants a host passes by hand, never defaults.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the components used to render, so a host adopting these sees no change on
 * screen — what changes is that the words are chosen in a diff.
 */
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

export const PT_BR_TABLE_FILTER_COPY: TableFilterCopy = {
  invalidRange: "O máximo deve ser maior ou igual ao mínimo.",
};

export const PT_BR_DATA_VIEWS_COPY: DataViewsCopy = {
  savedViewsMenu: PT_BR_SAVED_VIEWS_LABELS,
  confirmAction: PT_BR_CONFIRM_ACTION_COPY,
  categorySelect: PT_BR_CATEGORY_SELECT_COPY,
  board: {
    countOnPage: (label, count) => `${label}: ${count} nesta página`,
    onThisPage: (count) => `${count} nesta página`,
    pageSum: (sum) => `Soma desta página: ${sum}`,
    emptyColumn: "Nada nesta etapa",
    pageScopeNote:
      "As contagens e somas abaixo referem-se apenas aos itens desta página.",
  },
  deleteView: {
    title: "Excluir visão",
    target: (viewName) => `Excluir "${viewName}"?`,
    sharedWarning: "Esta visão está compartilhada — a equipe perderá o acesso a ela.",
    rowsUnaffected: (entityLabel) =>
      `${entityLabel} não são afetados; apenas o recorte salvo é removido.`,
    confirm: "Excluir visão",
    cancel: "Cancelar",
  },
  manageViews: {
    title: "Gerenciar visões",
    empty: "Nenhuma visão salva.",
    edit: "Editar",
    defaultTag: "Padrão",
    otherUserTag: "De outro usuário",
    deleteTitle: "Excluir a visão salva?",
    deleteBody: "Os filtros e colunas guardados nela são perdidos. Não é possível restaurar.",
    deleteConfirm: "Excluir",
  },
  saveView: {
    sharedDescription: "Qualquer pessoa da loja poderá abrir e usar esta visão.",
    setDefaultTitle: "Definir como padrão",
    setDefaultDescription: "Esta tela abre nesta visão em vez da Visão principal.",
    previewHeading: "O que esta visão guarda",
    previewUnchanged: "Nada foi alterado — esta visão ficará igual à Visão principal.",
    sortRowLabel: "Ordenação",
    saveFailed: "Não foi possível salvar a visão.",
    titleEditing: "Editar visão",
    titleCreating: "Salvar visão",
    descriptionLabel: "Descrição — opcional",
    descriptionPlaceholder: "Para que serve esta visão",
    submitEditing: "Salvar alterações",
    submitCreating: "Salvar visão",
    nameLabel: "Nome",
    cancel: "Cancelar",
    pinnedTitle: "Fixar na barra lateral",
    pinnedDescription: "Aparece como atalho no menu, abaixo desta tela.",
    sharedTitle: "Compartilhar com a equipe",
    namePlaceholder: "Ex.: Recusados no PIX desta semana",
    previewFilters: "Filtros",
    previewHiddenColumns: "Colunas ocultas",
  },
  columns: {
    visibleCount: (visible, total) => `${visible} de ${total} visíveis`,
    reset: "Padrão",
    showAll: "Mostrar todas",
    dragHint: "Arraste para reordenar as colunas.",
    moveUp: (columnLabel) => `Mover ${columnLabel} para cima`,
    moveDown: (columnLabel) => `Mover ${columnLabel} para baixo`,
  },
  display: {
    sortTab: "Ordenar",
    columnsTab: "Colunas",
    panelTab: "Exibição",
    direction: "Direção",
    layoutHints: {
      table: "Colunas comparáveis, boa para varrer números.",
      list: "Uma linha por item, com os dados principais.",
      cards: "Blocos maiores, bom para poucos itens.",
      board: "Colunas por etapa, para acompanhar o que está onde.",
    },
    densityHeadings: {
      table: "Altura das linhas",
      list: "Altura das linhas",
      cards: "Cards por linha",
      board: "Largura das colunas",
    },
    densityLabels: {
      table: { compact: "Baixa", cozy: "Média", comfortable: "Alta" },
      list: { compact: "Baixa", cozy: "Média", comfortable: "Alta" },
      cards: { compact: "Muitos", cozy: "Médio", comfortable: "Poucos" },
      board: { compact: "Estreita", cozy: "Média", comfortable: "Larga" },
    },
    boardUnavailable: "Esta tela não declara etapas, então não oferece quadro.",
    densityUnavailableNarrow:
      "Um card por linha nesta largura — a densidade volta em telas maiores.",
    trigger: "Exibir",
  },
  export: {
    formats: {
      json: { label: "JSON (.json)", hint: "Para integrações" },
    },
    visibleColumns: (columnCount) => `${columnCount} colunas visíveis, na ordem atual`,
    trigger: "Exportar",
  },
  grid: {
    rowActions: "Ações",
    bulkActions: (selectedCount) => `Ações (${selectedCount}) ▾`,
    emptyFilteredTitle: "Nenhum resultado para esses filtros",
    emptyFilteredHint: "Ajuste ou remova os filtros.",
    emptyFilteredAction: "Limpar filtros",
  },
  filters: {
    moreFilters: (count) => `Mais filtros: ${count} sem espaço na barra`,
    moreFiltersApplied: (count, appliedCount) =>
      `Mais filtros: ${count} sem espaço na barra, ${appliedCount} aplicado(s)`,
    overflowNote: "sem espaço na barra",
    rangeEnd: "Até",
    rangeInvalid: "O início precisa ser menor que o fim.",
    rangePresets: {
      hoje: "Hoje",
      ontem: "Ontem",
      semana: "Esta semana",
      mes: "Este mês",
      ano: "Este ano",
    },
    scopesLabel: "Situação",
    panelTitle: "Filtros",
    clear: "Limpar",
    clearAll: "Limpar filtros",
    clearRange: (label) => `Limpar ${label}`,
    allOption: "Todas",
    optionSearchPlaceholder: "Buscar…",
    optionsEmpty: "Nenhum resultado",
  },
  selection: {
    selectAllOnPage: "Selecionar todos nesta página",
    clearSelection: "Limpar seleção",
    selectAll: "Selecionar tudo",
    onThisPage: (count) => `${count} nesta página`,
    selectRow: "Selecionar",
    expandRow: "Expandir detalhes",
    collapseRow: "Recolher detalhes",
  },
  nav: {
    mainView: "Visão principal",
    defaultTag: "Padrão",
    viewOptions: (viewName) => `Opções de ${viewName}`,
    emptyHint: "Nenhuma visão salva. Ajuste filtros, colunas ou ordenação e salve abaixo.",
    setDefault: "Definir como padrão",
    deleteView: "Excluir visão",
    unsavedChanges: "Alterações não salvas",
    label: "Visão",
    update: "Atualizar visão",
    save: "Salvar visão",
    saveAs: "Salvar como nova",
    reset: "Redefinir",
    updateFailed: "Não foi possível atualizar a visão",
    saveFailed: "Não foi possível salvar a alteração da visão.",
    editView: "Renomear e editar",
    pinToSidebar: "Fixar na barra lateral",
    shareWithTeam: "Compartilhar com a equipe",
  },
  search: {
    placeholder: "Buscar…",
    allColumnsLabel: "Buscar em todas as colunas",
    keywordPlaceholder: "Pressione Enter para filtrar",
    open: "Buscar",
    close: "Fechar busca",
    clear: "Limpar busca",
  },
};

