import { describe, expect, it } from 'vitest';

import { compileReport } from '../../compile';
import { BLANK_BLOCK_TEMPLATE, blockTemplateGroups, findBlockTemplate } from '../block-templates';
import { reportCatalog } from '../catalog';

/**
 * FUT-391: "Adicionar bloco" offers templates instead of an empty block.
 *
 * The guarantee that matters is that every template RUNS. A picker entry that
 * produces a spec the compiler rejects is worse than no picker: the owner made
 * a reasonable choice and got an error they cannot act on.
 */

const everyTemplate = blockTemplateGroups().flatMap((group) => group.templates);

describe('blockTemplateGroups', () => {
  it('offers a blank template, last', () => {
    const groups = blockTemplateGroups();
    const lastGroup = groups.at(-1);
    expect(lastGroup?.templates).toEqual([BLANK_BLOCK_TEMPLATE]);
    // Someone who knows what they want should not start from a template and
    // delete its parts.
    expect(BLANK_BLOCK_TEMPLATE.spec).toBeNull();
  });

  it('groups by what someone wants to look at, not by entity name', () => {
    // An owner asking "how are sales doing" does not know whether that lives
    // in `orders` or `order_items` — both belong under Vendas.
    const vendas = blockTemplateGroups().find((group) => group.id === 'vendas');
    expect(vendas?.templates.map((template) => template.id)).toEqual([
      'receita-por-dia',
      'produtos-mais-vendidos',
    ]);
  });

  it('gives every template a distinct id', () => {
    const ids = everyTemplate.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes each template in the owner\'s words, not the schema\'s', () => {
    for (const template of everyTemplate) {
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      // A description that just repeats the entity id helps nobody.
      expect(template.description).not.toMatch(/_/);
    }
  });
});

describe('every template compiles against the live catalog', () => {
  const runnable = everyTemplate.filter((template) => template.spec !== null);

  it('has templates to check', () => {
    // Guards the loop below from passing vacuously if the definitions are
    // dropped or every starter goes missing at once.
    expect(runnable.length).toBeGreaterThan(4);
  });

  it.each(runnable.map((template) => [template.id, template] as const))(
    'compiles %s',
    (_id, template) => {
      expect(() => compileReport(template.spec!, reportCatalog)).not.toThrow();
    },
  );
});

describe('findBlockTemplate', () => {
  it('finds a template by id, including the blank one', () => {
    expect(findBlockTemplate('receita-por-dia')?.title).toBe('Receita por dia');
    expect(findBlockTemplate('blank')).toEqual(BLANK_BLOCK_TEMPLATE);
  });

  it('returns undefined for an id it does not know', () => {
    // A picker returning a stale id must not resolve to some other template.
    expect(findBlockTemplate('nope')).toBeUndefined();
  });
});
