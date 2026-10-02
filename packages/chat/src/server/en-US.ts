import type { ChatServerCopy } from "./copy";

/** The routes' sentences in US English — pass by hand, never a default. */
export const EN_US_CHAT_SERVER_COPY: ChatServerCopy = {
  notFound: "Conversation not found.",
  closed: "This conversation is closed. You can still read the messages.",
  invalidBody: "We could not read that message.",
  empty: "Write a message before sending.",
  tooLong: "A message can be up to {max} characters.",
  freeTextDisabled: "Use one of the quick replies.",
  unknownQuickReply: "That quick reply is not available.",
  contactInfo: "For safety, phone numbers, e-mail addresses, links and social profiles cannot be sent.",
  rateLimited: "Too many messages in a row. Wait a moment and try again.",
};
