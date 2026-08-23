/**
 * The pt-BR pack for the feedback family. Split out of `pt-BR.ts`, which is a
 * barrel over this folder — see that file for why.
 */
import type {
  ChromeCopy,
  TutorialCopy,
} from './copy';

export const PT_BR_TUTORIAL_COPY: TutorialCopy = {
  skip: "Pular",
  previous: "Anterior",
  next: "Próximo",
  restart: "Recomeçar",
};

export const PT_BR_CHROME_COPY: ChromeCopy = {
  dismissToast: "Fechar o aviso",
  goBack: "Voltar",
  closePanel: "Fechar",
  closeTab: "Fechar a aba",
  scrollRegion: "Conteúdo rolável",
  scrollToTop: "Voltar ao topo",
  share: "Compartilhar",
};
