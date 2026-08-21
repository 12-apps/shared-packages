import type { ReportSpec } from '../spec';

/**
 * The "Adicionar bloco" picker's CONTENTS are the host's; its SHAPE is ours.
 *
 * "Adicionar bloco" used to create an empty block, which then had to be decoded
 * through a config panel before it showed anything — asking a store owner to
 * know the shape of their own data model before they could see a number. The
 * templates fix that, and each one is a sentence about the host's product
 * ("Quanto a loja faturou a cada dia do período"), grouped by what someone is
 * trying to LOOK AT rather than by entity name.
 *
 * Which is exactly why they cannot live here. This module used to hold seven of
 * them — receita por dia, produtos mais vendidos, tempo de preparo por estação,
 * horas por estação, formas de pagamento, perdas por motivo, movimentações de
 * estoque — built from the origin host's starter specs, imported at module scope by
 * the editor canvas, and rendered to every host that mounted the surface. A
 * picker offering "Horas trabalhadas por estação" to a store with no kitchen is
 * not a default; it is another product's menu.
 *
 * The host passes its own groups to `createWebReportBuilder`. The blank
 * template below is this surface's own, and is always appended.
 */

export interface BlockTemplate {
  /** Stable id — what a picker returns and a test addresses. */
  id: string;
  title: string;
  /** What the block will show, in the reader's words rather than the schema's. */
  description: string;
  /**
   * The block's spec, or null for the blank template. Null is the escape hatch
   * that keeps the picker from being a cage: someone who knows exactly what
   * they want should not have to start from a template and delete its parts.
   */
  spec: ReportSpec | null;
}

export interface BlockTemplateGroup {
  id: string;
  title: string;
  templates: BlockTemplate[];
}

/**
 * The blank template, always offered, always last — the one entry that is about
 * the BUILDER rather than about any host's data, which is why it is the one
 * this package still ships.
 */
/**
 * The words the blank template and its group read as.
 *
 * REQUIRED, because they are the only copy left in a module that is otherwise
 * pure host data — and copy shipped as a default is exactly what a host cannot
 * see to decline. The ids stay the package's: they are keys, not words.
 */
export interface BlankBlockTemplateCopy {
  /** The template's own name in the picker. */
  title: string;
  /** What choosing it will leave the author holding. */
  description: string;
  /** The heading of the group it sits alone in. */
  groupTitle: string;
}

export function blankBlockTemplate(copy: BlankBlockTemplateCopy): BlockTemplate {
  return {
    id: 'blank',
    title: copy.title,
    description: copy.description,
    spec: null,
  };
}

/** The blank template's own group. */
function blankGroup(copy: BlankBlockTemplateCopy): BlockTemplateGroup {
  return {
    id: 'em-branco',
    title: copy.groupTitle,
    templates: [blankBlockTemplate(copy)],
  };
}

/**
 * The picker's contents: the host's groups, then the blank one on its own.
 *
 * A group with no templates is dropped rather than rendered empty — a heading
 * over nothing reads as a loading failure — and a host that passes none still
 * gets a working picker, because the blank template needs no catalog.
 */
export function blockTemplateGroups(
  groups: readonly BlockTemplateGroup[],
  copy: BlankBlockTemplateCopy,
): BlockTemplateGroup[] {
  return [...groups.filter((group) => group.templates.length > 0), blankGroup(copy)];
}
