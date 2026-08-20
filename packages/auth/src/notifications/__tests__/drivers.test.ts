import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSinkDriver, createUnconfiguredDriver } from "../drivers";

const AT = 1_700_000_000_000;
const MESSAGE = {
  subject: "Confirme seu e-mail",
  text: "Olá,\n\nhttps://loja.example/verify-email?token=abc\n",
  html: "<p>…</p>",
};

const dirs: string[] = [];
const tempFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "auth-sink-"));
  dirs.push(dir);
  return join(dir, "sink.jsonl");
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createSinkDriver", () => {
  it("writes the whole message, LINK INCLUDED, one JSON line per send", async () => {
    // The link is the entire point: a harness that could not read it back would
    // have to seed a token instead, which proves nothing about the link a real
    // person receives.
    const filePath = tempFile();
    const driver = createSinkDriver({ filePath, now: () => AT });

    await driver.send("ana@b.co", MESSAGE);

    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      to: "ana@b.co",
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      at: AT,
    });
  });

  it("appends rather than truncating, so a run's messages accumulate", async () => {
    const filePath = tempFile();
    const driver = createSinkDriver({ filePath, now: () => AT });

    await driver.send("ana@b.co", MESSAGE);
    await driver.send("bob@b.co", MESSAGE);

    expect(readFileSync(filePath, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("is inert with no path — still reports the send, writes nothing", async () => {
    // What makes it safe to leave wired in a host whose harness only sometimes
    // wants a file.
    const onSend = vi.fn();
    const driver = createSinkDriver({ onSend });

    await expect(driver.send("ana@b.co", MESSAGE)).resolves.toBeUndefined();
    expect(onSend).toHaveBeenCalledWith("ana@b.co", MESSAGE);
  });

  it("swallows a write it cannot make rather than failing the send", async () => {
    // The harness reads what did get written; a lost line fails its own step,
    // which is a better signal than an exception thrown out of a mailer.
    const driver = createSinkDriver({ filePath: "/nonexistent-dir/sink.jsonl" });

    await expect(driver.send("ana@b.co", MESSAGE)).resolves.toBeUndefined();
  });

  it("hands the message to the host's logger rather than choosing one", async () => {
    const onSend = vi.fn();
    const driver = createSinkDriver({ filePath: tempFile(), onSend, now: () => AT });

    await driver.send("ana@b.co", MESSAGE);

    expect(onSend).toHaveBeenCalledWith("ana@b.co", MESSAGE);
  });
});

describe("createUnconfiguredDriver", () => {
  it("reports the refusal instead of sending", async () => {
    // The person waiting has no other way in and no way to tell nothing was
    // sent, so this must be loud.
    const onRefused = vi.fn();
    const driver = createUnconfiguredDriver({ onRefused });

    await driver.send("ana@b.co", MESSAGE);

    expect(onRefused).toHaveBeenCalledWith({ to: "ana@b.co", subject: MESSAGE.subject });
  });

  it("resolves rather than throwing", async () => {
    // A throw here would change the flow's answer based on whether the mail
    // left — and those answers are deliberately identical, which is what keeps
    // sign-up and password-reset non-enumerating.
    const driver = createUnconfiguredDriver({ onRefused: () => {} });

    await expect(driver.send("ana@b.co", MESSAGE)).resolves.toBeUndefined();
  });

  it("never writes the body anywhere — only who and what subject", async () => {
    // It exists so a deployment with no provider does NOT write reset links
    // into a log aggregator. Passing the text to the callback would undo that.
    const onRefused = vi.fn();
    const driver = createUnconfiguredDriver({ onRefused });

    await driver.send("ana@b.co", MESSAGE);

    const [info] = onRefused.mock.calls[0] ?? [];
    expect(Object.keys(info ?? {}).sort()).toEqual(["subject", "to"]);
  });
});
