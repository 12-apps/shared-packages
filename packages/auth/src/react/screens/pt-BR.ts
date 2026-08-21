import type { EmailAuthCopy } from "./copy";

/**
 * Everything these screens say, in Brazilian Portuguese.
 *
 * ## Why a shipped pack is not the "default" `copy.ts` argues against
 *
 * That argument is about a SILENT default — copy that appears when a host
 * supplies none, so a forgotten group renders English at a Brazilian shopper
 * and nothing fails until somebody sees it. `EmailAuthCopy` is still required
 * at the call site and this pack is still passed by name:
 *
 * ```ts
 * createEmailAuthScreens({ client, useSession, copy: PT_BR });
 * ```
 *
 * A host that wants other words writes its own object and never imports this
 * file; a host that wants these writes one identifier instead of ~90 strings.
 * Nothing is chosen on anyone's behalf, which is the whole distinction — and it
 * is the same shape `PT_BR_MESSAGES` (the server's refusals) and `PT_BR_MAIL`
 * (the four e-mails) already have.
 *
 * The first pack, and today the only one. One is enough to make the seam real;
 * a translation nobody has read is worse than an obvious gap.
 *
 * Do not "translate" any of this to English while tidying: these strings are
 * read by end users, and the org's rule is English for developers and the
 * product's own language for the people using it.
 *
 * The failure sentences are deliberately NOT copies of the server's. The
 * server's message answers an API caller; these answer a person looking at a
 * specific form, and the two differ where context lets the screen be more
 * useful — "já existe uma conta" on the SIGN-UP form can point at the login
 * link, while the same code reaching an API client cannot.
 */
export const PT_BR: EmailAuthCopy = {
  failures: {
    "method-disabled": "O login com e-mail e senha está desativado no momento.",
    "invalid-email": "Informe um e-mail válido.",
    "weak-password": "Escolha uma senha mais forte.",
    "email-taken": "Já existe uma conta com este e-mail. Tente entrar.",
    "invalid-credentials": "E-mail ou senha incorretos.",
    "email-not-verified": "Confirme seu e-mail para entrar.",
    "token-invalid": "Este link expirou ou já foi usado. Peça um novo.",
    "rate-limited": "Muitas tentativas. Aguarde alguns minutos.",
    "current-password-required": "Informe sua senha atual.",
    "current-password-invalid": "Senha atual incorreta.",
    "no-account": "Conta não encontrada.",
    // The person at the form cannot fix a missing provider, so this says
    // what happened and who can, and nothing about the deployment.
    "verification-unavailable":
      "Não foi possível concluir o cadastro agora. Tente novamente mais tarde ou fale com o suporte.",
    unknown: "Não foi possível concluir. Tente novamente.",
  },
  passwordField: {
    show: "Mostrar",
    hide: "Ocultar",
    showAria: "Mostrar senha",
    hideAria: "Ocultar senha",
  },
  signIn: {
    emailLabel: "E-mail",
    passwordLabel: "Senha",
    submit: "Entrar",
    forgotPassword: "Esqueci minha senha",
    failureTitle: "Não foi possível entrar",
    unverifiedTitle: "Confirme seu e-mail",
    unverifiedDescription:
      "Sua senha está correta, mas falta confirmar seu e-mail para entrar.",
    resentDescription: "Enviamos um novo link. Confira sua caixa de entrada.",
    resend: "Reenviar o link de confirmação",
  },
  signUp: {
    nameLabel: "Seu nome",
    emailLabel: "E-mail",
    passwordLabel: "Senha",
    passwordHint: "Pelo menos 8 caracteres, com uma letra e um número.",
    submit: "Criar conta",
    failureTitle: "Não foi possível criar a conta",
    sentTitle: "Confira seu e-mail",
    sentDescription: (email) =>
      `Enviamos um link de confirmação para ${email}. Depois de confirmar, você já pode entrar.`,
  },
  forgotPassword: {
    title: "Esqueceu sua senha?",
    intro: "Informe seu e-mail e enviaremos um link para criar uma nova senha.",
    emailLabel: "E-mail",
    submit: "Enviar o link",
    backToLogin: "Voltar para entrar",
    failureTitle: "Não foi possível enviar",
    sentTitle: "Confira seu e-mail",
    sentAlertTitle: "Link enviado",
    // Says a message went out IF the address is registered, rather than
    // implying it definitely was — an honest "não encontramos esse e-mail"
    // would let anyone check who has an account here.
    sentDescription: (email) =>
      `Se existir uma conta com ${email}, enviamos um link para criar uma nova senha. O link vale por 1 hora.`,
  },
  resetPassword: {
    title: "Criar uma nova senha",
    intro: "Escolha uma senha com pelo menos 8 caracteres, incluindo uma letra e um número.",
    newPasswordLabel: "Nova senha",
    confirmationLabel: "Repita a nova senha",
    mismatch: "As senhas não são iguais.",
    submit: "Salvar a nova senha",
    failureTitle: "Não foi possível alterar",
    okAlertTitle: "Pronto",
    invalidAlertTitle: "Link inválido",
    doneTitle: "Senha alterada",
    doneMessage: "Sua nova senha já está valendo. Entre com ela para continuar.",
    doneAction: "Entrar",
    missingTokenMessage: "Este endereço não traz um código válido. Peça um novo link.",
    expiredMessage: "Este link expirou ou já foi usado. Peça um novo.",
    requestNewLink: "Pedir um novo link",
  },
  verifyEmail: {
    verifying: "Confirmando seu e-mail...",
    doneTitle: "E-mail confirmado",
    failedTitle: "Não foi possível confirmar",
    successAlertTitle: "Pronto",
    successDescription: "Seu e-mail está confirmado. Agora você já pode entrar com sua senha.",
    failedAlertTitle: "Link inválido",
    continueSignIn: "Entrar",
    continueBack: "Voltar para entrar",
  },
  securityCard: {
    addTitle: "Criar uma senha",
    changeTitle: "Alterar sua senha",
    addIntro:
      "Você entra com sua conta social. Crie uma senha para também poder entrar com e-mail e senha — os dois métodos continuam funcionando.",
    changeIntro: "Escolha uma nova senha. Você continua podendo entrar com sua conta social.",
    currentPasswordLabel: "Senha atual",
    newPasswordLabelAdd: "Sua senha",
    newPasswordLabelChange: "Nova senha",
    confirmationLabel: "Repita a senha",
    mismatch: "As senhas não são iguais.",
    submitAdd: "Criar senha",
    submitChange: "Salvar nova senha",
    savedTitleAdd: "Senha criada",
    savedTitleChange: "Senha alterada",
    savedDescription: "Pronto. Você já pode entrar com seu e-mail e sua nova senha.",
    failureTitle: "Não foi possível salvar",
  },
};
