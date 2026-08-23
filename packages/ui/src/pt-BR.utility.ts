/**
 * The pt-BR pack for the utility family. Split out of `pt-BR.ts`, which is a
 * barrel over this folder — see that file for why.
 */
import type {
  InstallPromptCopy,
  UserAvatarCopy,
} from './copy';

export const PT_BR_INSTALL_PROMPT_COPY: InstallPromptCopy = {
  title: "Instalar este aplicativo",
  installLabel: "Instalar",
  dismissLabel: "Dispensar o convite de instalação",
  iosTapBefore: "Toque em",
  iosTapAfter: 'e depois em "Adicionar à Tela de Início"',
  shareLabel: "Compartilhar",
};

export const PT_BR_USER_AVATAR_COPY: UserAvatarCopy = {
  signOut: "Sair",
};
