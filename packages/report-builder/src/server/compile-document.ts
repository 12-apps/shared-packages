import { compileReport } from '../compile';
import { ReportBuilderError } from '../errors';
import { isDashboardSpec, type ReportDocument } from '../spec';
import type { FieldCatalog } from '../types';

/**
 * Compile-only validation for the SAVE paths — no execution, no adapter, no
 * database read.
 *
 * A stored spec is always compilable at write time, which is what lets the
 * viewer treat a compile failure as catalog drift rather than as "this was
 * never valid". `runDashboard` deliberately does the opposite at READ time
 * (a stale block degrades to an inline error so its neighbours still render);
 * saving is where the strictness belongs.
 */
export function compileDocument(document: ReportDocument, catalog: FieldCatalog): void {
  if (!isDashboardSpec(document)) {
    compileReport(document, catalog);
    return;
  }
  document.blocks.forEach((block, index) => {
    try {
      compileReport(block.spec, catalog);
    } catch (error) {
      if (error instanceof ReportBuilderError) {
        // Which block failed is the whole answer here: a twelve-block
        // dashboard rejected with a bare "unknown field" leaves the author
        // opening each block to find it.
        throw new ReportBuilderError(
          error.code,
          `blocks[${index}] ("${block.id}"): ${error.message}`,
        );
      }
      throw error;
    }
  });
}
