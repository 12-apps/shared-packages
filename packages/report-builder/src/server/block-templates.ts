import type { ReportSpec } from '../spec';

import { REPORT_ENTITY_STARTERS } from './starters';

/**
 * The blocks someone can add without composing a query (FUT-391).
 *
 * "Adicionar bloco" used to create an EMPTY block, which then had to be decoded
 * through a config panel before it showed anything. That asks a store owner to
 * know the shape of their own data model before they can see a number.
 *
 * Every template's spec is a {@link REPORT_ENTITY_STARTERS} entry rather than a
 * new literal. Those are already compile-validated against the live catalog by
 * the starter test, so a catalog rename breaks the SUITE rather than a tenant's
 * first click — inventing specs here would create a second set with no such
 * guarantee.
 *
 * The grouping is by what someone is trying to LOOK AT, not by entity name: an
 * owner asking "how are sales doing" does not know whether that lives in
 * `orders` or `order_items`.
 */

export interface BlockTemplateGroup {
  id: string;
  title: string;
  templates: BlockTemplate[];
}

export interface BlockTemplate {
  /** Stable id — what a picker returns and a test addresses. */
  id: string;
  title: string;
  /** What the block will show, in the owner's words rather than the schema's. */
  description: string;
  /**
   * The block's spec, or null for the blank template. Null is the escape hatch
   * that keeps the picker from being a cage: someone who knows exactly what
   * they want should not have to start from a template and delete its parts.
   */
  spec: ReportSpec | null;
}

/**
 * `entity` here names a STARTER key. A template whose starter is missing is
 * dropped rather than shipped broken — see {@link blockTemplateGroups}.
 */
const DEFINITIONS: Array<{
  id: string;
  title: string;
  templates: Array<{ id: string; title: string; description: string; entity: string }>;
}> = [
  {
    id: 'vendas',
    title: 'Vendas',
    templates: [
      {
        id: 'receita-por-dia',
        title: 'Receita por dia',
        description: 'Quanto a loja faturou a cada dia do período',
        entity: 'orders',
      },
      {
        id: 'produtos-mais-vendidos',
        title: 'Produtos mais vendidos',
        description: 'Os dez produtos que mais renderam',
        entity: 'order_items',
      },
    ],
  },
  {
    id: 'movimento',
    title: 'Movimento',
    templates: [
      {
        id: 'preparo-por-estacao',
        title: 'Tempo de preparo por estação',
        description: 'Onde a cozinha demora, sem apontar para uma pessoa',
        entity: 'kitchen_ticket_items',
      },
      {
        id: 'horas-por-estacao',
        title: 'Horas trabalhadas por estação',
        description: 'Horas lançadas e linhas produzidas em cada estação',
        entity: 'kitchen_shifts',
      },
    ],
  },
  {
    id: 'pagamentos-e-perdas',
    title: 'Pagamentos e perdas',
    templates: [
      {
        id: 'formas-de-pagamento',
        title: 'Formas de pagamento',
        description: 'Quanto entrou por PIX, cartão e garçom',
        entity: 'payments',
      },
      {
        id: 'perdas-por-motivo',
        title: 'Perdas por motivo',
        description: 'Quanto foi perdido, e por quê',
        entity: 'loss_events',
      },
      {
        id: 'movimentacoes-de-estoque',
        title: 'Movimentações de estoque',
        description: 'Entradas e saídas por tipo de movimento',
        entity: 'stock_movements',
      },
    ],
  },
];

/** The blank template, always offered, always last. */
export const BLANK_BLOCK_TEMPLATE: BlockTemplate = {
  id: 'blank',
  title: 'Bloco em branco',
  description: 'Monte a consulta do zero',
  spec: null,
};

/**
 * The picker's contents: every group whose templates resolve to a starter,
 * then the blank one on its own.
 *
 * A template naming a starter that no longer exists is DROPPED, not rendered
 * disabled or shipped with an empty spec — a picker entry that does nothing
 * when clicked is worse than one that is absent, and this is the failure mode
 * of a catalog losing an entity.
 */
export function blockTemplateGroups(): BlockTemplateGroup[] {
  const groups = DEFINITIONS.map((group) => ({
    id: group.id,
    title: group.title,
    templates: group.templates
      .filter((template) => REPORT_ENTITY_STARTERS[template.entity] !== undefined)
      .map((template) => ({
        id: template.id,
        title: template.title,
        description: template.description,
        spec: REPORT_ENTITY_STARTERS[template.entity] as ReportSpec,
      })),
  })).filter((group) => group.templates.length > 0);

  return [
    ...groups,
    { id: 'em-branco', title: 'Do zero', templates: [BLANK_BLOCK_TEMPLATE] },
  ];
}

/** Look one up by id, for a picker returning an id rather than a whole spec. */
export function findBlockTemplate(id: string): BlockTemplate | undefined {
  return blockTemplateGroups()
    .flatMap((group) => group.templates)
    .find((template) => template.id === id);
}
