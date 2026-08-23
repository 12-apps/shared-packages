/**
 * The pt-BR pack for the data-display family. Split out of `pt-BR.ts`, which is a
 * barrel over this folder — see that file for why.
 */
import type { DataViewsCopy } from "./components/data-display/DataViews/data-views-copy";
import type {
  CarouselCopy,
  DataStateCopy,
  LightboxCopy,
  MapPreviewCopy,
  TimingDiagramCopy,
} from './copy';
import { PT_BR_TABLE_FILTER_COPY } from './pt-BR.layout';
import {
  PT_BR_CATEGORY_SELECT_COPY,
  PT_BR_CONFIRM_ACTION_COPY,
  PT_BR_SAVED_VIEWS_LABELS,
} from './pt-BR.shared';

export const PT_BR_LIGHTBOX_COPY: LightboxCopy = {
  close: "Fechar",
  previous: "Anterior",
  next: "Próximo",
  zoomIn: "Aproximar",
  zoomOut: "Afastar",
  resetZoom: "Restaurar o zoom",
  play: "Iniciar a apresentação",
  pause: "Pausar a apresentação",
};

export const PT_BR_MAP_PREVIEW_COPY: MapPreviewCopy = {
  zoomIn: "Aproximar",
  zoomOut: "Afastar",
  center: "Centralizar o mapa",
  mapType: "Trocar o tipo de mapa",
  fullscreen: "Tela cheia",
  search: "Buscar endereço",
};

export const PT_BR_CAROUSEL_COPY: CarouselCopy = {
  previous: "Anterior",
  next: "Próximo",
};

export const PT_BR_TIMING_DIAGRAM_COPY: TimingDiagramCopy = {
  regionLabel: "Diagrama de tempos",
  heading: "Tempo da requisição",
};

export const PT_BR_DATA_STATE_COPY: DataStateCopy = {
  empty: "Nenhum dado por aqui",
  loading: "Carregando…",
  endOfList: "Não há mais itens para carregar",
  dismissAlert: "Fechar o aviso",
  dismissBanner: "Fechar a faixa",
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
    fieldHeading: "Campo",
    formatHeading: "Formato",
    cardZoom: "Tamanho dos cards",
  },
  export: {
    formats: {
      json: { label: "JSON (.json)", hint: "Para integrações" },
    },
    visibleColumns: (columnCount) => `${columnCount} colunas visíveis, na ordem atual`,
    trigger: "Exportar",
    triggerLabel: "Exportar",
  },
  tableFilter: PT_BR_TABLE_FILTER_COPY,
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
    moreTriggerLabel: "Mais",
    moreHeading: "Mais filtros",
    overflowNote: "sem espaço na barra",
    rangeEnd: "Até",
    rangeInvalid: "O início precisa ser menor que o fim.",
    rangeInclusiveNote: "Ambas as datas entram no resultado.",
    rangeStart: "De",
    dayMask: "dd/mm/aaaa",
    clearAllFilters: "Limpar todos os filtros",
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
    optionsHeading: "Opções",
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
    dismissError: "Fechar o aviso",
    goBack: "Voltar",
    pageSize: "Mostrar:",
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
