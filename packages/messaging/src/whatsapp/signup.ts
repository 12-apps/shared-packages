import { GraphError, graphRequest, type GraphConfig } from "./graph";

/**
 * Embedded Signup, server half. The browser half (Meta's SDK popup) hands the
 * host a short-lived `code`; these three calls turn it into a connection:
 *
 * 1. {@link exchangeSignupCode} — the code for a business token;
 * 2. {@link readSignupAccounts} — which WhatsApp Business Accounts the token
 *    was granted, and each one's phone numbers (id + display number);
 * 3. {@link subscribeAppToWaba} — subscribe the app to the chosen account's
 *    webhooks, so its messages reach the connector.
 *
 * Then the host calls `engine.connect(...)` with the phone number id, the
 * display number and the token, which the engine seals. None of these
 * functions logs or returns anything but what is named.
 */

type Json = Record<string, unknown>;

/** The app's own identity on Meta. The secret is the host's, read where it keeps secrets. */
export interface MetaAppCredentials {
  appId: string;
  appSecret: string;
}

/** Exchange Embedded Signup's code for a business integration token. */
export async function exchangeSignupCode(
  graph: GraphConfig,
  input: MetaAppCredentials & { code: string; redirectUri?: string },
): Promise<{ accessToken: string }> {
  const json = await graphRequest(graph, {
    method: "GET",
    path: "oauth/access_token",
    query: {
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.code,
      ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
    },
  });
  if (typeof json.access_token !== "string" || json.access_token.length === 0) {
    throw new GraphError(200, "NO_ACCESS_TOKEN", "Graph answered the code exchange without a token");
  }
  return { accessToken: json.access_token };
}

/** One phone number of a WhatsApp Business Account. */
export interface SignupPhoneNumber {
  /** The phone_number_id: the connection's external account id. */
  id: string;
  /** What a person reads (`+55 11 98765-4321`): the connection's display address. */
  displayPhoneNumber: string;
  verifiedName: string | null;
}

export interface SignupAccount {
  /** The WABA id: the connection's external parent id. */
  wabaId: string;
  phoneNumbers: SignupPhoneNumber[];
}

/**
 * The WhatsApp Business Accounts the token was granted (read from the token's
 * own granular scopes, with the app's token), and each one's phone numbers.
 */
export async function readSignupAccounts(
  graph: GraphConfig,
  input: MetaAppCredentials & { accessToken: string },
): Promise<SignupAccount[]> {
  const debug = await graphRequest(graph, {
    method: "GET",
    path: "debug_token",
    query: { input_token: input.accessToken },
    token: `${input.appId}|${input.appSecret}`,
  });
  const data = typeof debug.data === "object" && debug.data !== null ? (debug.data as Json) : {};
  const scopes = Array.isArray(data.granular_scopes) ? (data.granular_scopes as Json[]) : [];
  const wabaIds = new Set(
    scopes
      .filter((scope) => scope.scope === "whatsapp_business_management" && Array.isArray(scope.target_ids))
      .flatMap((scope) => (scope.target_ids as unknown[]).filter((id): id is string => typeof id === "string")),
  );
  const accounts: SignupAccount[] = [];
  for (const wabaId of wabaIds) {
    accounts.push({ wabaId, phoneNumbers: await readPhoneNumbers(graph, wabaId, input.accessToken) });
  }
  return accounts;
}

async function readPhoneNumbers(graph: GraphConfig, wabaId: string, accessToken: string): Promise<SignupPhoneNumber[]> {
  const json = await graphRequest(graph, {
    method: "GET",
    path: `${encodeURIComponent(wabaId)}/phone_numbers`,
    query: { fields: "id,display_phone_number,verified_name" },
    token: accessToken,
  });
  const rows = Array.isArray(json.data) ? (json.data as Json[]) : [];
  return rows
    .filter((row) => typeof row.id === "string" && typeof row.display_phone_number === "string")
    .map((row) => ({
      id: row.id as string,
      displayPhoneNumber: row.display_phone_number as string,
      verifiedName: typeof row.verified_name === "string" ? row.verified_name : null,
    }));
}

/** Subscribe the app to a WABA's webhooks. Resolves when Meta answers `success: true`. */
export async function subscribeAppToWaba(graph: GraphConfig, input: { wabaId: string; accessToken: string }): Promise<void> {
  const json = await graphRequest(graph, {
    method: "POST",
    path: `${encodeURIComponent(input.wabaId)}/subscribed_apps`,
    token: input.accessToken,
  });
  if (json.success !== true) throw new GraphError(200, "NOT_SUBSCRIBED", "Graph did not confirm the subscription");
}
