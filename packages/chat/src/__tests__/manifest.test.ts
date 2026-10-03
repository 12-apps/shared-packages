import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertDbMirror,
  assertExportsMirror,
  defineManifest,
  defineNativeManifest,
  defineServerManifest,
  defineWebManifest,
} from "@12-apps/wiring/producer";
import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import { chatManifest } from "../manifest/index";
import { chatNativeManifest } from "../manifest/native";
import { chatServerManifest } from "../manifest/server";
import { chatWebManifest } from "../manifest/web";

/**
 * The wiring compliance suite: the producer's assertions, run here because the
 * manifests themselves are plain `satisfies` values (wiring stays a type-only
 * edge). Inventory drift, the export map and the db mirror all fail HERE,
 * before any host adopts a broken manifest.
 */


describe("the chat manifests", () => {
  it("declare a valid shared manifest", () => {
    expect(defineManifest(chatManifest)).toBe(chatManifest);
  });

  it("match the inventory for all three runtimes", () => {
    expect(defineServerManifest(chatManifest, chatServerManifest)).toBe(chatServerManifest);
    expect(defineWebManifest(chatManifest, chatWebManifest)).toBe(chatWebManifest);
    expect(defineNativeManifest(chatManifest, chatNativeManifest)).toBe(chatNativeManifest);
  });

  it("mirror every runtime and the db contribution in package.json", () => {
    expect(() => assertExportsMirror(chatManifest, packageJson)).not.toThrow();
    expect(() => assertDbMirror(chatManifest, packageJson)).not.toThrow();
  });

  it("ship the partial and the migration the db contribution points at", () => {
    const root = join(__dirname, "../..");
    /* eslint-disable-next-line test-flakiness/no-unmocked-fs --
       the assertion IS that the shipped file exists with this content; a mock would prove nothing. */
    const partial = readFileSync(join(root, chatManifest.db.partial), "utf8");
    /* eslint-disable-next-line test-flakiness/no-unmocked-fs -- same: the shipped migration itself. */
    const migration = readFileSync(join(root, "prisma/migrations/20261002120000_add_chat/migration.sql"), "utf8");
    expect(partial).toContain("model ChatThread");
    expect(migration).toContain('CREATE TABLE "chat_messages"');
  });
});
