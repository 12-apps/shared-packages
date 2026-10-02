import type { ChatAccess, ChatRoleConfig, ChatServerConfig } from "../server/context";
import { EN_US_CHAT_SERVER_COPY } from "../server/en-US";
import { memoryChatDb } from "./memory-db";

/** Three generic roles, the shape a host configures — a client, a field agent, a team. */
export const ROLES: Record<string, ChatRoleConfig> = {
  client: {
    label: "Client",
    shared: false,
    maxLength: 500,
    freeText: true,
    blockContact: [],
    quickReplies: [],
    rateLimit: { max: 20, windowMs: 60_000 },
  },
  agent: {
    label: "Agent",
    shared: false,
    maxLength: 160,
    freeText: true,
    blockContact: ["phone", "email", "url", "handle"],
    quickReplies: [
      { key: "arrived", text: "I have arrived." },
      { key: "on-the-way", text: "On my way." },
    ],
    rateLimit: { max: 3, windowMs: 60_000 },
  },
  team: {
    label: "Team",
    shared: true,
    maxLength: 1000,
    freeText: true,
    blockContact: [],
    quickReplies: [],
    rateLimit: { max: 30, windowMs: 60_000 },
  },
};

export function seat(overrides: Partial<ChatAccess> = {}): ChatAccess {
  return {
    tenantId: "t1",
    threadKey: "job:1",
    role: "client",
    authorId: "u-client",
    readerId: "u-client",
    canWrite: true,
    ...overrides,
  };
}

/** A config whose `authorize` answers whatever the request's actor says it is. */
export function configWith(overrides: Partial<ChatServerConfig<ChatAccess | null>> = {}) {
  const db = memoryChatDb();
  const config: ChatServerConfig<ChatAccess | null> = {
    db: async () => db,
    authorize: async (request) => request.actor,
    roles: ROLES,
    copy: EN_US_CHAT_SERVER_COPY,
    clock: () => new Date("2026-10-02T12:00:00.000Z"),
    ...overrides,
  };
  return { db, config };
}
