import type { AccessCopy } from "./copy";

/**
 * Brazilian Portuguese for the access surface — the first locale this ships
 * with, and the prototype's own words.
 *
 * One bundled pack rather than none, because "supply thirty sentences before
 * anything renders" is a poor first five minutes; and one rather than five,
 * because a translation nobody has read is worse than an obvious gap. The type
 * makes a missing case a compile error rather than a silently English string in
 * a Portuguese screen.
 */
export const PT_BR_ACCESS: AccessCopy = {
  checkEmail: {
    title: "Confira seu e-mail",
    description: (email) => `Enviamos um link de confirmação para ${email}.`,
    resend: "Reenviar o link",
    changeEmail: "Usar outro e-mail",
    resent: "Pronto, enviamos outro link.",
    resending: "Enviando…",
  },
  rateLimit: {
    // Singular and plural are the pack's job, not the formatter's: the rule
    // differs per language, and a package that guessed would be wrong in most.
    seconds: (count) => (count === 1 ? "1 segundo" : `${count} segundos`),
    minutes: (count) => (count === 1 ? "1 minuto" : `${count} minutos`),
    retryIn: (remaining) => `Muitas tentativas. Tente de novo em ${remaining}.`,
    retryUnknown: "Muitas tentativas. Aguarde um instante e tente de novo.",
  },
  states: {
    errorTitle: "Não foi possível carregar",
    retry: "Tentar de novo",
    noMethods: {
      title: "Esta loja ainda não abriu o acesso",
      description:
        "Nenhuma forma de entrar está ligada no momento. Fale com a loja para conseguir acesso.",
    },
    noPassword: {
      title: "Esta loja não usa senha",
      description: "Entre por um dos provedores disponíveis para acessar sua conta.",
    },
    signupClosed: {
      title: "Cadastro por e-mail fechado",
      description: "Esta loja não abre cadastro por e-mail. Você ainda pode entrar por um provedor.",
    },
    accountHasNoPassword: {
      title: "Sua conta ainda não tem senha",
      description:
        "Você entrou por um provedor. Crie uma senha para poder entrar das duas formas.",
    },
  },
};
