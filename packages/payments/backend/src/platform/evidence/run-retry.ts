import { threeDSSessionStep } from './orders-debit';
import { walletsConfig } from './orders-wallet';
import { mintPublicKey, openRun, readRun, sandboxSeller, unminted, type EvidenceRunDeps, type PreparedEvidenceRun } from './run';
import { saveIntoRun } from './run-sections';
import { PAGBANK_SANDBOX_DEBIT_TEST, type DebitTestData } from './sandbox-buyer';
import { clockOf } from './steps';

const PROVIDER = 'pagbank';

/**
 * Phase 1 again, for a retry of the latest run (FUT-5584): a fresh public key
 * and 3DS session for the SAME run, recorded in place of the first ones, so
 * the browser can encrypt and authenticate the cards the retry raises. Nothing
 * else of the run is touched, and no new run is started.
 */
export async function prepareEvidenceRetry(
  deps: EvidenceRunDeps,
  runId: string,
  debitTest: DebitTestData = PAGBANK_SANDBOX_DEBIT_TEST,
): Promise<PreparedEvidenceRun> {
  const record = openRun(await deps.store.latest(PROVIDER, 'RUN'), runId);
  const seller = await sandboxSeller(deps);
  if (typeof seller !== 'object') return { ...unminted(record, debitTest), wallets: await walletsConfig(deps, null) };
  const { publicKey, step: publicKeyStep } = await mintPublicKey(deps, seller.token);
  const threeDS = await threeDSSessionStep(deps, seller.token);
  const now = () => clockOf(deps)().toISOString();
  await saveIntoRun(deps, readRun(deps, runId), [publicKeyStep, threeDS.step], undefined, now);
  return {
    runId,
    publicKey,
    threeDSSession: threeDS.session,
    debitTest,
    wallets: await walletsConfig(deps, seller.accountId),
  };
}
