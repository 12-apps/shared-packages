/**
 * The pt-BR labels pack. A host passes `PT_BR_UI_LABELS.<family>` to the
 * component's `labels` prop (or one entry to its `…Label` prop); see
 * `copy/labels.ts`.
 */
import type { UiLabels } from './copy/labels';

export const PT_BR_UI_LABELS: UiLabels = {
  common: {
    loading: "Carregando",
    close: "Fechar",
    delete: "Excluir",
  },
  stepper: {
    step: (position, label) => `Etapa ${position}: ${label}`,
    optional: "opcional",
    completed: "concluída",
    current: "atual",
  },
  timeline: {
    expandDetails: "Mostrar detalhes do item",
    collapseDetails: "Ocultar detalhes do item",
    item: (title) => `Item da linha do tempo: ${title}`,
  },
  lazyImage: {
    loadingAlt: (alt) => `${alt} (carregando)`,
    fallbackAlt: (alt) => `${alt} (imagem alternativa)`,
  },
  sonner: {
    hiddenCount: (count) => `+${count} a mais`,
  },
  richTextEditor: {
    placeholder: "Comece a digitar...",
    ariaLabel: "Editor de texto",
    listItem: "Item da lista",
    bold: "Negrito",
    italic: "Itálico",
    underline: "Sublinhado",
    strikethrough: "Tachado",
    numberedList: "Lista numerada",
    bulletedList: "Lista com marcadores",
    insertLink: "Inserir link",
    insertImage: "Inserir imagem",
    codeBlock: "Bloco de código",
    quote: "Citação",
    linkPrompt: "Informe a URL:",
    imagePrompt: "Informe a URL da imagem:",
  },
  table: {
    sortBy: (header) => `Ordenar por ${header}`,
    selectRow: (rowNumber) => `Selecionar a linha ${rowNumber}`,
    selectAllRows: "Selecionar todas as linhas",
  },
  code: {
    copy: "Copiar código",
    copied: "Copiado!",
  },
  contentToolbar: {
    gridView: "Grade",
    listView: "Lista",
    openFilters: "Abrir filtros",
    closeFilters: "Fechar filtros",
    filters: "Filtros",
    all: "Todos",
    search: "Buscar…",
    noResults: "Nenhum resultado",
  },
  dashboard: {
    breadcrumb: "Trilha de navegação",
    moreFilters: "Mais filtros",
  },
  navigationMenu: {
    collapse: "Recolher",
    expand: "Expandir",
  },
  workflowStep: {
    step: (position, title) => `Etapa ${position}: ${title}`,
    progress: (position, total) => `Etapa ${position} de ${total}`,
  },
  alertDialog: {
    cancel: "Cancelar",
    confirm: "Confirmar",
  },
  avatar: {
    name: "Avatar",
  },
  emptyState: {
    refresh: "Atualizar",
    create: "Criar novo",
  },
  errorState: {
    retry: "Tentar novamente",
  },
  loadingState: {
    skeleton: "Carregando conteúdo",
    spinner: "Carregando",
  },
  stackedModal: {
    loading: "Carregando...",
  },
  command: {
    placeholder: "Digite um comando ou pesquise...",
    empty: "Nenhum resultado encontrado",
    loading: "Carregando...",
  },
  formErrorSnackbar: {
    message: "Corrija os campos destacados e tente novamente.",
  },
  columnsMenu: {
    title: "Colunas",
    toggle: "Mostrar ou ocultar colunas",
  },
  drawer: {
    close: "Fechar painel",
  },
  settingsLayout: {
    navigation: "Configurações",
    searchPlaceholder: "Buscar configurações",
    emptySearch: "Nenhuma configuração corresponde à busca.",
    back: "Voltar",
  },
  tableFilter: {
    filters: "Filtros",
    keywordPlaceholder: "Pressione Enter para filtrar",
    keywordLabel: "Filtrar por palavra-chave",
  },
  appHeader: {
    disclose: (title) => `Detalhes de ${title}`,
  },
  breadcrumbs: {
    navigation: "Trilha de navegação",
  },
  animatedIcon: {
    name: (variant) => `Ícone animado: ${variant}`,
  },
  infiniteScroll: {
    loadFailed: "Ocorreu um erro ao carregar mais itens",
  },
  socialLogin: {
    title: "Entre para continuar",
    divider: "ou",
  },
  dateRangePicker: {
    calendar: "Calendário",
  },
  calendar: {
    chooseMonth: (month) => `${month}, escolher mês`,
    chooseYear: (year) => `${year}, escolher ano`,
    previousMonth: "Mês anterior",
    nextMonth: "Próximo mês",
    months: "Meses",
    years: "Anos",
  },
};
