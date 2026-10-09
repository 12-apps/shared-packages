/* eslint-disable test-flakiness/no-test-isolation --
   each case builds its own host and flow through `build()`; nothing is shared
   between cases. */
import { describe, expect, it } from "vitest";

import { createEmailCredentials } from "../../email-credentials";
import { FakeHost } from "../../email-credentials/__tests__/fake-host";
import { mountEmailAuth } from "../../hono/mount";
import { hashPassword } from "../../password";
import { parseCookieHeader, SIGNUP_BINDING_COOKIE } from "../auth-cookies";
import { createApiEmailAuth } from "../create-api-email-auth";
import { PT_BR_MESSAGES } from "../pt-BR";

/**
 * The sign-up binding cookie, seen on the wire through BOTH adapters
 * (FUT-3474).
 *
 * The property under test is the one the cookie could have broken: sign-up
 * must not say whether an address is taken. So a taken address and a free one
 * must answer the same status, the same body, and a cookie of the same name,
 * length, attributes and lifetime — only its random bytes differ.
 */

const PREFIX = "/api/auth/email";
const GOOD_PASSWORD = "uma senha boa 42";

async function build() {
  const host = new FakeHost();
  host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });
  const credentials = createEmailCredentials({
    store: host,
    mailer: host,
    settings: { enabled: true, requireEmailVerification: true },
    appUrl: "https://app.example.com",
  });
  return { host, credentials };
}

function signupRequest(email: string): Request {
  return new Request(`http://host${PREFIX}/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "outra senha 7" }),
  });
}

/** A Set-Cookie line with its value blanked, so two can be compared byte for byte. */
function cookieShape(response: Response): { shape: string; valueLength: number } {
  const line = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`^${SIGNUP_BINDING_COOKIE}=([^;]*)(;.*)$`).exec(line);
  if (!match) throw new Error(`no binding cookie in ${JSON.stringify(line)}`);
  const [, value = "", attributes = ""] = match;
  return { shape: `${SIGNUP_BINDING_COOKIE}=…${attributes}`, valueLength: value.length };
}

async function wire(response: Response) {
  return { status: response.status, body: await response.json(), cookie: cookieShape(response) };
}

describe("sign-up's binding cookie, through the Hono mount", () => {
  it("is indistinguishable between a taken and a free address", async () => {
    const { credentials } = await build();
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials,
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    const taken = await wire(await POST(signupRequest("ana@example.com")));
    const free = await wire(await POST(signupRequest("bia@example.com")));

    expect(taken).toEqual(free);
    expect(taken.status).toBe(200);
    expect(taken.body).toEqual({ data: { status: "verification-sent" } });
    // Every attribute, in order: the whole line is the contract.
    expect(taken.cookie.shape.split("; ")).toEqual([
      `${SIGNUP_BINDING_COOKIE}=…`,
      "Max-Age=86400",
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
    ]);
  });

  it("lets only the browser carrying it sign in from the verify answer", async () => {
    const { host, credentials } = await build();
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials,
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });
    const signedUp = await POST(signupRequest("bia@example.com"));
    const cookie = (signedUp.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const token = new URL(host.lastEmail("verification")?.link ?? "").searchParams.get("token");

    const verify = (headers: Record<string, string>) =>
      POST(
        new Request(`http://host${PREFIX}/verify`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ token }),
        }),
      ).then((response) => response.json());

    await expect(verify({})).resolves.toEqual({
      data: { email: "bia@example.com", canSignIn: false },
    });
    await expect(verify({ cookie })).resolves.toEqual({
      data: { email: "bia@example.com", canSignIn: true },
    });
  });
});

describe("sign-up's binding cookie, through the wiring view", () => {
  it("is indistinguishable between a taken and a free address", async () => {
    const { credentials } = await build();
    const route = createApiEmailAuth({ credentials, messages: PT_BR_MESSAGES }).routes.find(
      (candidate) => candidate.path === "/signup",
    );
    if (!route) throw new Error("no /signup route");

    const call = async (email: string) => {
      const answer = await route.handle({
        actor: null,
        params: {},
        query: {},
        body: { email, password: "outra senha 7" },
        request: signupRequest(email),
      });
      if (!("response" in answer)) throw new Error("the binding needs a raw answer");
      return wire(answer.response);
    };

    const taken = await call("ana@example.com");
    const free = await call("bia@example.com");
    expect(taken).toEqual(free);
    expect(taken.body).toEqual({ data: { status: "verification-sent" } });
  });

  it("sets no binding when the host passed no raw request to prove where it came from", async () => {
    const { credentials } = await build();
    const route = createApiEmailAuth({ credentials, messages: PT_BR_MESSAGES }).routes.find(
      (candidate) => candidate.path === "/signup",
    );
    const answer = await route?.handle({
      actor: null,
      params: {},
      query: {},
      body: { email: "bia@example.com", password: "outra senha 7" },
    });
    expect(answer && "status" in answer ? answer.status : "raw").toBe(200);
  });
});

describe("a sign-up another site forged (login CSRF)", () => {
  const forged = (headers: Record<string, string>) =>
    new Request(`http://host${PREFIX}/signup`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "bia@example.com", password: "outra senha 7" }),
    });

  it.each([
    ["a text/plain form", { "content-type": "text/plain" }],
    ["a urlencoded form", { "content-type": "application/x-www-form-urlencoded" }],
    ["no content type", {}],
    ["a cross-site fetch", { "content-type": "application/json", "sec-fetch-site": "cross-site" }],
    ["a sibling subdomain", { "content-type": "application/json", "sec-fetch-site": "same-site" }],
  ])("refuses %s, creates nothing and sets no cookie", async (_label, headers) => {
    const { host, credentials } = await build();
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials,
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });
    const response = await POST(forged(headers));

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await host.findByEmail("bia@example.com")).toBeNull();
  });

  it("refuses it through the wiring view too", async () => {
    const { credentials } = await build();
    const route = createApiEmailAuth({ credentials, messages: PT_BR_MESSAGES }).routes.find(
      (candidate) => candidate.path === "/signup",
    );
    const answer = await route?.handle({
      actor: null,
      params: {},
      query: {},
      body: { email: "bia@example.com", password: "outra senha 7" },
      request: forged({ "content-type": "text/plain" }),
    });
    expect(answer).toEqual({ status: 403, body: { error: "forbidden" } });
  });

  it("accepts the browser's own same-origin call", async () => {
    const { credentials } = await build();
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials,
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });
    const response = await POST(
      forged({ "content-type": "application/json", "sec-fetch-site": "same-origin" }),
    );
    expect(response.status).toBe(200);
  });
});

describe("parseCookieHeader", () => {
  it("keeps the first of two cookies with the same name", () => {
    expect(
      parseCookieHeader(`${SIGNUP_BINDING_COOKIE}=first; x=1; ${SIGNUP_BINDING_COOKIE}=second`)[
        SIGNUP_BINDING_COOKIE
      ],
    ).toBe("first");
  });
});
