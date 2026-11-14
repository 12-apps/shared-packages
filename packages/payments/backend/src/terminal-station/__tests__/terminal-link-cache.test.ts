import { describe, expect, it } from "vitest";

import { openStoredLinks, parseStoredTerminalLinks, readTerminalLinks, sealLinks } from "../terminal-link-cache";
import { fakeSealer, link } from "./harness";

/**
 * The station's links: read strictly from the server's answer, kept
 * on disk with each secret sealed, and read back with no internet.
 */

describe("readTerminalLinks", () => {
  it("keeps well-formed links, one per device and one per provider", () => {
    const pos = { ...link("pos-1"), lanAddress: "192.168.0.20:7380" };
    expect(readTerminalLinks([pos, link("pos-1"), link("pos-2")])).toEqual([pos]);
  });

  it.each([
    ["an unknown provider", { ...link("pos-1"), provider: "STONE" }],
    ["a short secret", { ...link("pos-1"), secret: "c2hvcnQ=" }],
    ["a secret that is not base64", { ...link("pos-1"), secret: "%%%%%%%%%%%%%%%%%%%%%%%%" }],
    ["an address with a path", { ...link("pos-1"), lanAddress: "192.168.0.20:7380/x" }],
    ["a device id with a space", { ...link("pos 1") }],
  ])("drops a link with %s", (_label, entry) => {
    expect(readTerminalLinks([entry])).toEqual([]);
  });

  it("reads anything but a list as none", () => {
    expect(readTerminalLinks({ links: [] })).toEqual([]);
  });
});

describe("the links on disk", () => {
  it("are sealed, never in clear, and open back to the same links", async () => {
    const sealer = fakeSealer();
    const links = [link("pos-1")];
    const stored = await sealLinks(links, sealer);
    expect(JSON.stringify(stored)).not.toContain(links[0]!.secret);
    expect(await openStoredLinks(parseStoredTerminalLinks(stored), sealer)).toEqual(links);
  });

  it("are not written, nor read, without the key store", async () => {
    expect(await sealLinks([link("pos-1")], fakeSealer(false))).toEqual([]);
    expect(await openStoredLinks(await sealLinks([link("pos-1")], fakeSealer()), fakeSealer(false))).toEqual([]);
  });

  it("drop a secret sealed somewhere else", async () => {
    const stored = [{ deviceId: "pos-1", provider: "PAGBANK" as const, lanAddress: null, sealedSecret: Buffer.from("other").toString("base64") }];
    expect(await openStoredLinks(stored, fakeSealer())).toEqual([]);
  });

  it("say once when the key store asks for them to be sealed again", async () => {
    const stored = await sealLinks([link("pos-1")], fakeSealer());
    const asked: string[] = [];
    expect(await openStoredLinks(stored, fakeSealer(true, { reseal: true }), () => asked.push("reseal"))).toHaveLength(1);
    expect(asked).toEqual(["reseal"]);
    await openStoredLinks(stored, fakeSealer(), () => asked.push("again"));
    expect(asked).toEqual(["reseal"]);
  });

  it("read back from the settings file as strictly: a malformed entry dropped, anything but a list read as none", async () => {
    const sealed = await sealLinks([link("pos-1")], fakeSealer());
    const kept = JSON.parse(JSON.stringify([...sealed, { deviceId: "x", provider: "PAGBANK", sealedSecret: 7 }])) as unknown;
    expect(parseStoredTerminalLinks(kept)).toEqual(sealed);
    expect(parseStoredTerminalLinks("x")).toEqual([]);
  });
});
