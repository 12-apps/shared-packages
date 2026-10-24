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
  SocialLoginCopy,
  UploadButtonCopy,
} from './copy';

export const PT_BR_ADDRESS_AUTOCOMPLETE_COPY: Required<AddressAutocompleteCopy> = {
  loadingMaps: "Carregando o Google Maps…",
  mapsLoadFailed:
    "Não foi possível carregar a API do Google Maps. Verifique a chave da API e a conexão com a internet.",
  useCurrentLocation: "Usar a localização atual",
  label: "Endereço",
  placeholder: "Digite um endereço",
  typeToSearch: "Digite ao menos 3 caracteres",
  noAddressesFound: "Nenhum endereço encontrado",
  mapsApiLoadFailed: "Não foi possível carregar o mapa",
  mapsServicesInitFailed: "Não foi possível iniciar o mapa",
  fetchSuggestionsFailed: "Não foi possível buscar sugestões de endereço",
  addressDetailsNotFound: "Detalhes do endereço não encontrados",
  addressDetailsFailed: "Não foi possível obter os detalhes do endereço",
  noMockLocation: "Nenhuma localização de teste disponível",
  mockLocationNotFound: "Detalhes da localização de teste não encontrados",
  locationAddressFailed: "Não foi possível obter o endereço da localização atual",
  geolocationUnsupported: "Este navegador não oferece geolocalização",
  geocoderUnavailable: "Serviço de geocodificação indisponível",
  locationFailed: "Não foi possível obter a sua localização",
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

export const PT_BR_RICH_EDITOR_TOOLBAR_COPY: Required<RichEditorToolbarCopy> = {
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
  editorLabel: "Editor de texto",
};

// Built on first use, not at import: a host that never mounts the phone field
// pays nothing, and a runtime without `Intl.DisplayNames` keeps the English name.
let ptBrRegionNames: Intl.DisplayNames | null | undefined;
const ptBrCountryName = (code: string): string | undefined => {
  if (ptBrRegionNames === undefined) {
    ptBrRegionNames =
      typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["pt-BR"], { type: "region", fallback: "none" })
        : null;
  }
  return ptBrRegionNames?.of(code);
};

export const PT_BR_PHONE_INPUT_COPY: Required<PhoneInputCopy> = {
  selectCountry: "Selecionar o país",
  invalidNumber: (countryName) => `Telefone inválido para ${countryName}`,
  unknownCountry: "o país selecionado",
  countryName: (code, englishName) => ptBrCountryName(code) ?? englishName,
};

export const PT_BR_UPLOAD_BUTTON_COPY: Required<UploadButtonCopy> = {
  buttonLabel: "Enviar arquivo",
  dropzoneHint: "Solte o arquivo aqui ou clique para escolher",
  dropzoneRole: (label) => `Área de upload de arquivo. ${label}`,
  uploading: "Enviando…",
  dropReady: "Arquivo pronto para soltar",
  percentUploaded: (percent) => `${percent}% enviado`,
  uploadInProgress: (percent) => `Envio em andamento: ${percent}%`,
  errorAnnouncement: (message) => `Erro: ${message}`,
  fileTooLarge: (maxSizeMB) => `O arquivo deve ter menos de ${maxSizeMB} MB`,
  uploadFailed: "Falha no envio",
};

export const PT_BR_SOCIAL_LOGIN_COPY: SocialLoginCopy = {
  google: "Continuar com o Google",
  facebook: "Continuar com o Facebook",
  apple: "Continuar com a Apple",
};
