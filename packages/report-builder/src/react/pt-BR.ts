/**
 * The pt-BR pack for the report SCREENS — a NAMED constant a host passes by
 * hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the components used to render, so a host adopting it sees no change on
 * screen — what changes is that the words are chosen in a diff.
 */
import type { ReportScreensCopy } from "./screens-copy";

export const PT_BR_REPORT_SCREENS_COPY: ReportScreensCopy = {
  list: {
    title: "Relatórios",
    subtitle: "Seus painéis: escolha um para ver, ou monte outro com os blocos que quiser.",
    loadFailedTitle: "Não foi possível carregar os relatórios",
    loadFailedBody: "Tente novamente em instantes.",
    retry: "Tentar novamente",
    scopes: {
      active: "Todos",
      mine: "Meus",
      archived: "Arquivados",
    },
    search: "Buscar relatório",
    create: "Novo relatório",
    emptyTitle: "Nenhum relatório aqui.",
    emptyBody: "Monte o primeiro com receita por dia, top produtos e ticket médio.",
    emptySearchBody: "Tente outro termo.",
    chipDraft: "Rascunho",
    chipArchived: "Arquivado",
    chipUnpublished: "Alterações não publicadas",
    noDescription: "Sem descrição.",
    blockCount: (count) => `${count} ${count === 1 ? "bloco" : "blocos"}`,
    visibility: {
      private: "Só você",
      roles: "Cargos específicos",
      tenant: "Toda a equipe",
    },
    relativeTime: {
      now: "agora",
      minutes: (count) => `há ${count} min`,
      hours: (count) => `há ${count} ${count === 1 ? "hora" : "horas"}`,
      yesterday: "ontem",
      days: (count) => `há ${count} dias`,
      weeks: (count) => `há ${count} ${count === 1 ? "semana" : "semanas"}`,
    },
    edit: "Editar",
    archive: "Arquivar",
    restore: "Restaurar",
    cardMenu: (reportName) => `Mais ações de ${reportName}`,
    newCardTitle: "Novo relatório",
    newCardHint: "Comece de um modelo",
  },
  view: {
    noDescription: "Sem descrição.",
    visibleTo: (audience) => `visível para ${audience.toLocaleLowerCase("pt-BR")}`,
    editedAt: (relativeTime) => `editado ${relativeTime}`,
    breadcrumbList: "Relatórios",
    export: "Exportar",
    loadFailedTitle: "Não foi possível carregar o relatório",
    loadFailedBody: "Ele pode ter sido excluído, ou você não tem permissão.",
  },
};
