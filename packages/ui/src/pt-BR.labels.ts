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
  },
  dashboard: {
    breadcrumb: "Trilha de navegação",
  },
  navigationMenu: {
    collapse: "Recolher",
  },
  workflowStep: {
    step: (position, title) => `Etapa ${position}: ${title}`,
    progress: (position, total) => `Etapa ${position} de ${total}`,
  },
};
