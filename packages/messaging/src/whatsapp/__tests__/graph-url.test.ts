import { describe, expect, it } from "vitest";

import { sendWhatsAppMessage, type FetchPort } from "../graph";

/** The URL the Graph call went to, for a given configured base URL. */
async function urlFor(baseUrl: string): Promise<string> {
  const urls: string[] = [];
  const fetch: FetchPort = async (url) => {
    urls.push(url);
    return { status: 200, text: async () => JSON.stringify({ messages: [{ id: "wamid.1" }] }) };
  };
  await sendWhatsAppMessage(
    { fetch, baseUrl, apiVersion: "v23.0" },
    { token: "t", phoneNumberId: "123", to: "5511987654321", content: { kind: "TEXT", text: "oi" } },
  );
  return urls[0]!;
}

describe("the Graph base URL", () => {
  it("is trimmed of trailing slashes, however many", async () => {
    expect(await urlFor("https://graph.example.test///")).toBe("https://graph.example.test/v23.0/123/messages");
    expect(await urlFor("https://graph.example.test")).toBe("https://graph.example.test/v23.0/123/messages");
  });

  // The vitest timeout is the clock: a backtracking trim takes minutes on these inputs.
  it("is trimmed in linear time on a 100 000-character run of slashes", { timeout: 1_000 }, async () => {
    expect(await urlFor(`https://graph.example.test${"/".repeat(100_000)}`)).toBe("https://graph.example.test/v23.0/123/messages");
  });

  it("returns quickly when a long run of slashes is not at the end", { timeout: 1_000 }, async () => {
    const url = await urlFor(`https://graph.example.test${"/".repeat(100_000)}x`);
    expect(url.endsWith("/x/v23.0/123/messages")).toBe(true);
  });
});
