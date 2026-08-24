import type { EventsMessages } from "./types";

/**
 * The en-US pack — the same four wire sentences for an English-reading
 * audience. The filename is what exempts this file from the copy-portability
 * gate, the same way `pt-BR.ts` beside it is exempt: a language may ship, it
 * may not be silent.
 *
 * These are the SENTENCES only. The status codes, the topic grammar and the
 * deliberate conflation in {@link EventsMessages.unknownTopic} — one message
 * for "unknown domain" and for "that domain takes no qualifier", so a prober
 * cannot learn which half failed — are the package's and do not vary by
 * language. A translation that split them into two clearer messages would be a
 * security regression dressed as an improvement.
 */
export const EN_US_EVENTS_MESSAGES: EventsMessages = {
  unavailable: "Real-time updates are unavailable.",
  invalidTopics: "Invalid topics.",
  unknownTopic: (name) => `Unknown topic: ${name}.`,
  tooMany: "Too many simultaneous connections.",
};
