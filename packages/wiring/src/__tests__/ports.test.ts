import { describe, expect, it } from "vitest";

import { memoryEmailPort, memoryLogger, memoryNotifyPort } from "../ports";

describe("the memory reference ports", () => {
  it("records email sends with the whole envelope", async () => {
    const email = memoryEmailPort();
    await email.port.send("owner@example.com", { subject: "s", text: "t", html: "<p>t</p>" });
    expect(email.sent).toEqual([
      { to: "owner@example.com", message: { subject: "s", text: "t", html: "<p>t</p>" } },
    ]);
  });

  it("accepts every notify emit and keeps the event", async () => {
    const notify = memoryNotifyPort();
    const outcome = await notify.port.emit({
      type: "notes.created",
      recipient: { tenantId: "t1", permission: "notes:read" },
      payload: { noteId: "n1" },
    });
    expect(outcome.accepted).toBe(true);
    expect(notify.events[0]?.type).toBe("notes.created");
  });

  it("keeps logger lines with their level", () => {
    const logger = memoryLogger();
    logger.port.info("hello");
    logger.port.error("boom");
    expect(logger.lines).toEqual(["info hello", "error boom"]);
  });
});
