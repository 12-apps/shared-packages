/* eslint-disable test-flakiness/no-test-isolation --
   each case builds its own lookup (and its own cache) through
   `createInboxLookup`; nothing is shared between cases. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmailCredentials } from "../../email-credentials";
import { FakeHost } from "../../email-credentials/__tests__/fake-host";
import { mountEmailAuth } from "../../hono/mount";
import { hashPassword } from "../../password";
import { createInboxLookup, inboxHostOfMx } from "../inbox-host";
import { PT_BR_MESSAGES } from "../pt-BR";

// No case reaches the network: the system resolver answers every MX query the
// way the cloud containers' egress does — an empty ENODATA.
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  class Resolver {
    resolveMx(): Promise<never> {
      return Promise.reject(Object.assign(new Error("queryMx ENODATA"), { code: "ENODATA" }));
    }
  }
  const promises = { ...actual.promises, Resolver };
  return { ...actual, promises, default: { ...actual, promises } };
});

/**
 * The webmail read off a sign-up's MX records (FUT-3806 follow-up): the table,
 * the cap, the cache, and the one property the sign-up must keep — the answer
 * is the domain's, so a taken and a free address get the same.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("inboxHostOfMx", () => {
  it.each([
    [["mx1.titan.email.", "mx2.titan.email."], "titan"],
    [["aspmx.l.google.com"], "google"],
    [["alt1.aspmx.l.googlemail.com"], "google"],
    [["paladira-com.mail.protection.outlook.com"], "microsoft"],
    [["smtpin.zoho.com"], "zoho"],
    [["mta5.am0.yahoodns.net"], "yahoo"],
    [["mx01.mail.icloud.com"], "icloud"],
    [["mail.protonmail.ch"], "proton"],
    [["MX1.TITAN.EMAIL"], "titan"],
  ])("names %j as %s", (hosts, expected) => {
    expect(inboxHostOfMx(hosts)).toBe(expected);
  });

  it("knows nobody else, and never a look-alike", () => {
    expect(inboxHostOfMx(["mx.a.locaweb.com.br"])).toBeNull();
    expect(inboxHostOfMx(["mx.zoho.eu"])).toBeNull();
    expect(inboxHostOfMx(["evilgoogle.com"])).toBeNull();
    expect(inboxHostOfMx(["google.com.attacker.net"])).toBeNull();
    expect(inboxHostOfMx([])).toBeNull();
  });

  it("judges by the first host it is handed, the highest priority", () => {
    expect(inboxHostOfMx(["mx1.titan.email", "aspmx.l.google.com"])).toBe("titan");
  });
});

describe("createInboxLookup", () => {
  it("reads the domain's MX and caches the answer per domain", async () => {
    const resolveMx = vi.fn(async () => ["mx1.titan.email."]);
    const lookup = createInboxLookup({ resolveMx });
    expect(await lookup("thom@paladira.com")).toBe("titan");
    expect(await lookup("ana@PALADIRA.com")).toBe("titan");
    expect(resolveMx).toHaveBeenCalledTimes(1);
    expect(resolveMx).toHaveBeenCalledWith("paladira.com");
  });

  it("asks nobody for a public domain the screen names itself", async () => {
    const resolveMx = vi.fn(async () => ["mx.example"]);
    const lookup = createInboxLookup({ resolveMx });
    expect(await lookup("ana@gmail.com")).toBeNull();
    expect(await lookup("ana@hotmail.com.br")).toBeNull();
    expect(await lookup("ana@aol.com")).toBeNull();
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it("asks nobody for a reserved or malformed domain", async () => {
    const resolveMx = vi.fn(async () => ["mx1.titan.email"]);
    const lookup = createInboxLookup({ resolveMx });
    for (const email of [
      "ana@example.test",
      "ana@mail.example.com",
      "ana@localhost",
      "ana@[127.0.0.1]",
      "ana@-bad-.com",
      "not-an-address",
      "a@b@c.com",
    ]) {
      expect(await lookup(email)).toBeNull();
    }
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it("gives up at the cap, and remembers that only briefly", async () => {
    vi.useFakeTimers();
    try {
      const resolveMx = vi.fn(() => new Promise<string[]>(() => {}));
      const lookup = createInboxLookup({ resolveMx, timeoutMs: 50, ttlMs: 60 * 60 * 1000 });
      const answer = lookup("ana@slow.com.br");
      await vi.advanceTimersByTimeAsync(50);
      expect(await answer).toBeNull();
      expect(await lookup("bia@slow.com.br")).toBeNull();
      expect(resolveMx).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
      void lookup("caio@slow.com.br");
      expect(resolveMx).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers null when the resolver throws", async () => {
    const lookup = createInboxLookup({ resolveMx: async () => Promise.reject(new Error("ENOTFOUND")) });
    expect(await lookup("ana@nowhere.com.br")).toBeNull();
  });

  it("drops the oldest domain past the cache's size", async () => {
    const resolveMx = vi.fn(async () => ["mx1.titan.email"]);
    const lookup = createInboxLookup({ resolveMx, maxEntries: 2 });
    await lookup("a@one.com");
    await lookup("a@two.com");
    await lookup("a@three.com");
    await lookup("a@one.com");
    expect(resolveMx).toHaveBeenCalledTimes(4);
  });
});

describe("the sign-up answer", () => {
  async function post(email: string) {
    const host = new FakeHost();
    host.withUser({ email: "ana@paladira.com", passwordHash: await hashPassword("uma senha boa 42") });
    const credentials = createEmailCredentials({
      store: host,
      mailer: host,
      settings: { enabled: true, requireEmailVerification: true },
      appUrl: "https://app.example.com",
    });
    const { POST } = mountEmailAuth({
      path: "/api/auth/email",
      credentials,
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
      inboxLookup: { resolveMx: async () => ["mx1.titan.email."] },
    });
    const response = await POST(
      new Request("http://host/api/auth/email/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "outra senha 7" }),
      }),
    );
    return { status: response.status, body: (await response.json()) as unknown };
  }

  it("carries the domain's webmail, the same for a taken and a free address", async () => {
    const taken = await post("ana@paladira.com");
    const free = await post("bia@paladira.com");
    expect(taken).toEqual(free);
    expect(taken.body).toEqual({ data: { status: "verification-sent", inbox: "titan" } });
  });

  it("carries nothing when the lookup is switched off", async () => {
    const host = new FakeHost();
    const credentials = createEmailCredentials({
      store: host,
      mailer: host,
      settings: { enabled: true, requireEmailVerification: true },
      appUrl: "https://app.example.com",
    });
    const { POST } = mountEmailAuth({
      path: "/api/auth/email",
      credentials,
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
      inboxLookup: false,
    });
    const response = await POST(
      new Request("http://host/api/auth/email/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "bia@paladira.com", password: "outra senha 7" }),
      }),
    );
    expect(await response.json()).toEqual({ data: { status: "verification-sent" } });
  });
});

describe("the default resolver's DNS-over-HTTPS fallback", () => {
  it("asks the configured endpoint for the domain only, and reads its answer by priority", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        Answer: [
          { type: 15, data: "20 mx2.titan.email." },
          { type: 15, data: "10 mx1.titan.email." },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // The (mocked) system resolver has no answer, so the lookup falls through.
    const lookup = createInboxLookup({ dohUrl: "https://doh.example.net/resolve", timeoutMs: 2000 });
    expect(await lookup("thom@paladira.com")).toBe("titan");
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe("https://doh.example.net/resolve?name=paladira.com&type=MX");
    expect(url).not.toContain("thom");
  });

  it("does not ask any endpoint unless the host names one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const lookup = createInboxLookup({ timeoutMs: 500 });
    await lookup("thom@paladira.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
