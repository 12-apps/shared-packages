import { z } from "zod";

import { DISCOUNT_BULK_MAX_IDS } from "../bulk";
import { isCalendarDay } from "../timezone";

/**
 * The bulk route's body and answer as zod (FUT-4420): the validators the route
 * enforces and the schemas the MCP tool advertises are these same objects, so
 * the two cannot drift. The plain types they must satisfy are in `../bulk`.
 */

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isCalendarDay, { message: "Not a real calendar day" });
const idList = z.array(z.string().min(1)).min(1).max(DISCOUNT_BULK_MAX_IDS);

/**
 * A state Desfazer would write back. It passes the rule a write passes: a
 * window that closes at or before it opens is never stored (review N4).
 */
const stateSchema = z
  .strictObject({
    active: z.boolean(),
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    windowInZone: z.boolean(),
  })
  .refine(
    (state) =>
      state.startsAt === null || state.endsAt === null || Date.parse(state.endsAt) > Date.parse(state.startsAt),
    { message: "The window must close after it opens", path: ["endsAt"] },
  );

const validateOnly = z
  .boolean()
  .optional()
  .describe("true to check every row and report what WOULD happen, writing nothing.");

const allOrNothingText =
  "true to refuse the whole call (422, every problem with its path, nothing written) when any row cannot take the change.";

/**
 * The body, for the SCREEN (`allOrNothing` absent = a per-row answer) or for the
 * MCP tool (`allOrNothing` defaults to true). Two builds of one shape, so the
 * advertised schema and the enforced one stay the same object per caller.
 */
function bulkBody(allOrNothing: z.ZodType<boolean | undefined>) {
  const setActiveBody = z.strictObject({
    operation: z.literal("setActive"),
    ids: idList.describe(`Discount ids, at most ${DISCOUNT_BULK_MAX_IDS}.`),
    active: z.boolean().describe("true to activate every row, false to deactivate."),
    validateOnly,
    allOrNothing,
  });
  const extendWindowBody = z.strictObject({
    operation: z.literal("extendWindow"),
    ids: idList.describe(`Discount ids, at most ${DISCOUNT_BULK_MAX_IDS}.`),
    days: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .optional()
      .describe("Whole days to add to each row's end day; an already ended discount counts from today."),
    endsOn: dayString
      .optional()
      .describe("Or the new last day, YYYY-MM-DD, for every row. Send exactly one of days and endsOn."),
    validateOnly,
    allOrNothing,
  });
  const undoBody = z.strictObject({
    operation: z.literal("undo"),
    rows: z
      .array(z.strictObject({ id: z.string().min(1), before: stateSchema, after: stateSchema }))
      .min(1)
      .max(DISCOUNT_BULK_MAX_IDS)
      .describe("The `ok` rows of the batch to undo, with their before and after exactly as the batch answered them."),
    validateOnly,
    allOrNothing,
  });
  return z.discriminatedUnion("operation", [setActiveBody, extendWindowBody, undoBody]).superRefine((body, context) => {
    if (body.operation !== "extendWindow") return;
    const sent = Number(body.days !== undefined) + Number(body.endsOn !== undefined);
    if (sent === 1) return;
    context.addIssue({
      code: "custom",
      path: [body.days === undefined ? "days" : "endsOn"],
      message: "Send exactly one of days and endsOn",
    });
  });
}

/** The screen's body: per-row unless it asks for `allOrNothing`. Refined after the union (days xor endsOn). */
export const bulkDiscountsBody = bulkBody(z.boolean().optional().describe(allOrNothingText));

/** The MCP tool's body: all-or-nothing unless the agent says otherwise (protocol, decided on FUT-4420). */
export const bulkDiscountsToolBody = bulkBody(z.boolean().default(true).describe(allOrNothingText));

const rowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  status: z.enum(["ok", "unchanged", "skipped", "failed"]),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  before: stateSchema.optional(),
  after: stateSchema.optional(),
  endsOn: z.string().nullable().optional(),
  revived: z.boolean().optional(),
});

export const bulkDiscountsResponse = z.object({
  data: z.object({
    operation: z.enum(["setActive", "extendWindow", "undo"]),
    validateOnly: z.boolean(),
    counts: z.object({ ok: z.number(), unchanged: z.number(), skipped: z.number(), failed: z.number() }),
    rows: z.array(rowSchema),
  }),
});
