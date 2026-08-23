import type { EmailAuthSettingsCopy } from "./copy";

/**
 * The platform sign-in console, in Brazilian Portuguese.
 *
 * Passed by name (`copy: PT_BR_SETTINGS`), never applied by default — the
 * distinction `react/screens/pt-BR.ts` sets out, and it matters more here than
 * anywhere: these two sentences are the screen's entire reason to exist.
 *
 * An operator flipping a platform switch has to be told what it COSTS, and a
 * host writing that from scratch will write "turns e-mail login off" and stop.
 * The verification one in particular is the sentence nobody writes unprompted:
 * ON is not merely "safer", it also makes sign-up non-enumerating, and turning
 * it off buys a shorter funnel by giving that property away.
 */
export const PT_BR_SETTINGS: EmailAuthSettingsCopy = {
  title: "Login",
  intro:
    // "toda a plataforma", not "todas as lojas": these switches are platform-
    // wide, and a package's own pack must not assume its host sells anything.
    // A backoffice adopting this had a sentence about stores it does not have.
    "Como as pessoas entram na plataforma. As duas opções valem para toda a " +
    "plataforma e passam a valer na próxima requisição — não é preciso publicar nada.",

  methodLabel: "Login com e-mail e senha",
  methodDescription:
    "Permite criar conta e entrar com e-mail e senha, além dos provedores " +
    "sociais. Desligar recusa o método para todo mundo, inclusive para quem já " +
    "tem senha — nada é apagado, e religar devolve essas contas como estavam.",

  verificationLabel: "Exigir confirmação de e-mail",
  verificationDescription:
    "Liga: a conta só entra depois de clicar no link enviado — e o cadastro " +
    "deixa de revelar se um e-mail já tem conta, porque a resposta passa a ser " +
    "a mesma nos dois casos. Desliga: a conta funciona na hora, e em troca o " +
    "cadastro passa a poder dizer que o e-mail já está em uso.",

  verificationInertNote:
    "A confirmação de e-mail só tem efeito com o login por e-mail e senha ligado.",

  saveFailedTitle: "Não foi possível salvar",
  saveFailedDescription: "A alteração não foi aplicada. Tente novamente.",
  saveFailedDismiss: "Fechar o aviso",

  loadFailedTitle: "Não foi possível carregar as configurações de login",
  retry: "Tentar novamente",

  lastChanged: (when, who) => `Última alteração em ${when}${who ? ` por ${who}` : ""}.`,
};
