import { z } from 'zod';

import type { ResearchRunProgressEvent } from '../ports';
import { sourceStatSchema } from '../schemas';
import type { SourceStat } from '../types';

/**
 * The run-progress WIRE vocabulary (FUT-439): what a host puts on its
 * realtime channel and what a client decodes back. Defined once, here, so the
 * publisher (the host's event-port bridge) and the subscriber (the research
 * screens' host adapter) can never disagree about a type name or a payload
 * field. Deliberately transport-agnostic — plain `{ type, data }` pairs; the
 * envelope (topic, timestamps, ids) belongs to whatever channel carries them.
 */

/**
 * The channel domain a host should scope run-progress topics under, e.g.
 * `tenant:<clientId>:research-run:<runId>` in the FUT-438 topic convention.
 */
export const RESEARCH_RUN_REALTIME_DOMAIN = 'research-run';

/** Wire event type names — stable on the wire, never rename. */
const WIRE_TYPES = {
  sourceStarted: 'research-run.source-started',
  sourceSettled: 'research-run.source-settled',
  finished: 'research-run.finished',
} as const;

const wireScopeSchema = z.object({ runId: z.string().min(1), requestId: z.string().min(1) });

const sourceStartedSchema = wireScopeSchema.extend({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  sourceName: z.string(),
});

const sourceSettledSchema = wireScopeSchema.extend({ stat: sourceStatSchema });

const finishedSchema = wireScopeSchema.extend({ status: z.enum(['COMPLETED', 'FAILED']) });

/** One decoded run-progress wire event, discriminated by `type`. */
export type ResearchRunWireEvent =
  | { type: typeof WIRE_TYPES.sourceStarted; data: z.infer<typeof sourceStartedSchema> }
  | { type: typeof WIRE_TYPES.sourceSettled; data: { runId: string; requestId: string; stat: SourceStat } }
  | { type: typeof WIRE_TYPES.finished; data: z.infer<typeof finishedSchema> };

/**
 * Map a pipeline progress event to its wire form. The `clientId` and `at` are
 * deliberately dropped: the topic is already tenant-scoped and the channel
 * envelope carries its own timestamp — payloads stay minimal.
 */
export function toResearchRunWireEvent(event: ResearchRunProgressEvent): ResearchRunWireEvent {
  const scope = { runId: event.runId, requestId: event.requestId };
  if (event.kind === 'source-started') {
    return {
      type: WIRE_TYPES.sourceStarted,
      data: {
        ...scope,
        sourceId: event.sourceId,
        sourceType: event.sourceType,
        sourceName: event.sourceName,
      },
    };
  }
  if (event.kind === 'source-settled') {
    return { type: WIRE_TYPES.sourceSettled, data: { ...scope, stat: event.stat } };
  }
  return { type: WIRE_TYPES.finished, data: { ...scope, status: event.status } };
}

/**
 * Decode one received channel message back into a typed wire event, or `null`
 * for anything that is not a run-progress event (other event types on a
 * shared connection, malformed payloads) — a client must never trust the
 * wire's shape.
 */
export function decodeResearchRunWireEvent(message: {
  type: string;
  data: unknown;
}): ResearchRunWireEvent | null {
  if (message.type === WIRE_TYPES.sourceStarted) {
    const parsed = sourceStartedSchema.safeParse(message.data);
    return parsed.success ? { type: WIRE_TYPES.sourceStarted, data: parsed.data } : null;
  }
  if (message.type === WIRE_TYPES.sourceSettled) {
    const parsed = sourceSettledSchema.safeParse(message.data);
    return parsed.success ? { type: WIRE_TYPES.sourceSettled, data: parsed.data } : null;
  }
  if (message.type === WIRE_TYPES.finished) {
    const parsed = finishedSchema.safeParse(message.data);
    return parsed.success ? { type: WIRE_TYPES.finished, data: parsed.data } : null;
  }
  return null;
}
