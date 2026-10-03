import type { ChatServerCopy } from "./copy";

/** The routes' sentences in Brazilian Portuguese — pass by hand, never a default. */
export const PT_BR_CHAT_SERVER_COPY: ChatServerCopy = {
  notFound: "Conversa não encontrada.",
  closed: "Esta conversa foi encerrada. Você ainda pode ler as mensagens.",
  invalidBody: "Não entendemos a mensagem enviada.",
  empty: "Escreva uma mensagem antes de enviar.",
  tooLong: "A mensagem pode ter até {max} caracteres.",
  freeTextDisabled: "Use uma das respostas rápidas.",
  unknownQuickReply: "Essa resposta rápida não está disponível.",
  contactInfo: "Por segurança, não é permitido enviar telefone, e-mail, link ou perfil de rede social.",
  rateLimited: "Muitas mensagens seguidas. Aguarde um pouco e tente de novo.",
};
