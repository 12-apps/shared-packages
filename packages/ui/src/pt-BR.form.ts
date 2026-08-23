/**
 * The pt-BR pack for the form family. Split out of `pt-BR.ts`, which is a
 * barrel over this folder — see that file for why.
 */
import type {
  AddressAutocompleteCopy,
  AutocompleteCopy,
  CodeEditorCopy,
  PasswordStrengthCopy,
  PhoneInputCopy,
  RichEditorToolbarCopy,
  UploadButtonCopy,
} from './copy';

export const PT_BR_ADDRESS_AUTOCOMPLETE_COPY: AddressAutocompleteCopy = {
  loadingMaps: "Carregando o Google Maps…",
  mapsLoadFailed:
    "Não foi possível carregar a API do Google Maps. Verifique a chave da API e a conexão com a internet.",
  useCurrentLocation: "Usar a localização atual",
};

export const PT_BR_AUTOCOMPLETE_COPY: AutocompleteCopy = {
  loading: "Carregando…",
  noResults: "Nenhum resultado encontrado",
  placeholder: "Digite para buscar…",
};

export const PT_BR_CODE_EDITOR_COPY: CodeEditorCopy = {
  loading: "Carregando o editor…",
  readOnly: "Somente leitura",
  formatCode: "Formatar o código (Ctrl+Shift+F)",
  enableWrap: "Quebrar as linhas",
  disableWrap: "Não quebrar as linhas",
  copyToClipboard: "Copiar para a área de transferência",
  copied: "Copiado!",
  enterFullscreen: "Tela cheia",
  exitFullscreen: "Sair da tela cheia",
};

export const PT_BR_PASSWORD_STRENGTH_COPY: PasswordStrengthCopy = {
  strengthHeading: "Força da senha",
  requirementsHeading: "Requisitos:",
  suggestionsHeading: "Sugestões:",
  bands: {
    veryWeak: "Muito fraca",
    weak: "Fraca",
    fair: "Razoável",
    good: "Boa",
    strong: "Forte",
  },
  requirements: {
    minLength: (count) => `Pelo menos ${count} caracteres`,
    uppercase: "Uma letra maiúscula",
    lowercase: "Uma letra minúscula",
    numbers: "Um número",
    special: "Um caractere especial",
  },
  suggestions: {
    minLength: (count) => `Use pelo menos ${count} caracteres`,
    uppercase: "Adicione letras maiúsculas",
    lowercase: "Adicione letras minúsculas",
    numbers: "Inclua números",
    special: "Adicione caracteres especiais",
  },
};

export const PT_BR_RICH_EDITOR_TOOLBAR_COPY: RichEditorToolbarCopy = {
  bold: "Negrito",
  italic: "Itálico",
  underline: "Sublinhado",
  bulletList: "Lista com marcadores",
  numberedList: "Lista numerada",
  quote: "Citação",
  code: "Código",
  insertLink: "Inserir link",
  textColor: "Cor do texto",
  backgroundColor: "Cor de fundo",
  linkPrompt: "Informe a URL:",
};

export const PT_BR_PHONE_INPUT_COPY: PhoneInputCopy = {
  selectCountry: "Selecionar o país",
  invalidNumber: (countryName) => `Telefone inválido para ${countryName}`,
  unknownCountry: "o país selecionado",
};

export const PT_BR_UPLOAD_BUTTON_COPY: UploadButtonCopy = {
  buttonLabel: "Enviar arquivo",
  dropzoneHint: "Solte o arquivo aqui ou clique para escolher",
  dropzoneRole: (label) => `Área de upload de arquivo. ${label}`,
  uploading: "Enviando…",
  dropReady: "Arquivo pronto para soltar",
  percentUploaded: (percent) => `${percent}% enviado`,
  uploadInProgress: (percent) => `Envio em andamento: ${percent}%`,
  errorAnnouncement: (message) => `Erro: ${message}`,
};
