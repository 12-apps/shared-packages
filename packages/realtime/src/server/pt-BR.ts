import type { EventsMessages } from "./types";

/**
 * The pt-BR pack — the wire sentences the origin host's SPAs already read,
 * now a NAMED export a host passes by hand (`messages: PT_BR_EVENTS_MESSAGES`)
 * instead of a silent default. The filename is what exempts this file from
 * the copy-portability gate: Portuguese may ship, it may not be silent.
 */
export const PT_BR_EVENTS_MESSAGES: EventsMessages = {
  unavailable: "Atualizações em tempo real indisponíveis.",
  invalidTopics: "Tópicos inválidos.",
  unknownTopic: (name) => `Tópico desconhecido: ${name}.`,
  tooMany: "Muitas conexões simultâneas.",
};
