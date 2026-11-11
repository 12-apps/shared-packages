import { z } from "zod";

import { DISCOUNT_BULK_MAX_IDS } from "../bulk";

/**
 * The bulk route's body and answer as zod (FUT-4420): the validators the route
 * enforces and the schemas the MCP tool advertises are these same objects, so
 * the two cannot drift. The plain types they must satisfy are in `../bulk`.
 */

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const idList = z.array(z.string().min(1)).min(1);

const stateSchema = z.strictObject({
  active: z.boolean(),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  windowInZone: z.boolean(),
});

const validateOnly = z
  .boolean()
  .optional()
  .describe("true to check every row and report what WOULD happen, writing nothing.");

const setActiveBody = z.strictObject({
  operation: z.literal("setActive"),
  ids: idList.describe(`Discount ids, at most ${DISCOUNT_BULK_MAX_IDS}.`),
  active: z.boolean().describe("true to activate every row, false to deactivate."),
  validateOnly,
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
});

const undoBody = z.strictObject({
  operation: z.literal("undo"),
  rows: z
    .array(z.strictObject({ id: z.string().min(1), before: stateSchema, after: stateSchema }))
    .min(1)
    .describe("The `ok` rows of the batch to undo, with their before and after exactly as the batch answered them."),
  validateOnly,
});

/**
 * The write body. Refined AFTER the union: exactly one of `days` and `endsOn`
 * on an extension (both is a contradiction, neither is nothing to do), and no
 * more than the cap - the sentence for the cap is the host's copy, so the
 * route says it, not zod.
 */
export const bulkDiscountsBody = z
  .discriminatedUnion("operation", [setActiveBody, extendWindowBody, undoBody])
  .superRefine((body, context) => {
    if (body.operation !== "extendWindow") return;
    const sent = Number(body.days !== undefined) + Number(body.endsOn !== undefined);
    if (sent === 1) return;
    context.addIssue({
      code: "custom",
      path: [body.days === undefined ? "days" : "endsOn"],
      message: "Send exactly one of days and endsOn",
    });
  });

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
