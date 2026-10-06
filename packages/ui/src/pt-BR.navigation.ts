/**
 * The pt-BR pack for the navigation family. Split out of `pt-BR.ts`, which is a
 * barrel over this folder — see that file for why.
 */
import type {
  BreadcrumbCopy,
  CommandPaletteCopy,
  SectionNavCopy,
} from './copy';

export const PT_BR_COMMAND_PALETTE_COPY: CommandPaletteCopy = {
  execute: "Executar",
  navigate: "↑↓ Navegar",
  close: "ESC Fechar",
  recent: "Recentes",
  tryAnotherTerm: "Tente outro termo",
};

export const PT_BR_BREADCRUMB_COPY: BreadcrumbCopy = {
  showMore: "Mostrar mais",
  moreItems: "Mais itens",
};

export const PT_BR_SECTION_NAV_COPY: SectionNavCopy = {
  close: "Fechar",
  badge: (count) => (count === 1 ? "1 pendente" : `${count} pendentes`),
  attention: "Precisa de atenção",
};
