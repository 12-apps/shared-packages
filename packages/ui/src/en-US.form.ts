/**
 * The en-US pack for the form family. Split the same way `pt-BR.form.ts` is —
 * see `en-US.ts` for why.
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

export const EN_US_ADDRESS_AUTOCOMPLETE_COPY: Required<AddressAutocompleteCopy> = {
  loadingMaps: "Loading Google Maps…",
  mapsLoadFailed:
    "Could not load the Google Maps API. Check the API key and the internet connection.",
  useCurrentLocation: "Use my current location",
  label: "Address",
  placeholder: "Enter an address",
  typeToSearch: "Type at least 3 characters",
  noAddressesFound: "No addresses found",
  // MUI's own words for the row, which the field showed before it had a key.
  loadingSuggestions: "Loading…",
  mapsApiLoadFailed: "Failed to load Google Maps API",
  mapsServicesInitFailed: "Failed to initialize Google Maps services",
  fetchSuggestionsFailed: "Failed to fetch address suggestions",
  addressDetailsNotFound: "Address details not found",
  addressDetailsFailed: "Failed to get address details",
  noMockLocation: "No mock location available",
  mockLocationNotFound: "Mock location details not found",
  locationAddressFailed: "Unable to retrieve address for current location",
  geolocationUnsupported: "Geolocation is not supported by this browser",
  geocoderUnavailable: "Geocoding service not available",
  locationFailed: "Unable to retrieve your location",
};

export const EN_US_AUTOCOMPLETE_COPY: AutocompleteCopy = {
  loading: "Loading…",
  noResults: "No results found",
  placeholder: "Type to search…",
};

export const EN_US_CODE_EDITOR_COPY: CodeEditorCopy = {
  loading: "Loading the editor…",
  readOnly: "Read only",
  // The shortcut is the editor's own binding and is not translated — it is what
  // the reader must press, not something they read.
  formatCode: "Format code (Ctrl+Shift+F)",
  enableWrap: "Wrap lines",
  disableWrap: "Do not wrap lines",
  copyToClipboard: "Copy to clipboard",
  copied: "Copied!",
  enterFullscreen: "Full screen",
  exitFullscreen: "Leave full screen",
};

export const EN_US_PASSWORD_STRENGTH_COPY: PasswordStrengthCopy = {
  strengthHeading: "Password strength",
  requirementsHeading: "Requirements:",
  suggestionsHeading: "Suggestions:",
  bands: {
    veryWeak: "Very weak",
    weak: "Weak",
    fair: "Fair",
    good: "Good",
    strong: "Strong",
  },
  requirements: {
    // The count is the HOST's configured minimum, interpolated rather than
    // written out: a host raising it must not end up with a requirement naming
    // the old number.
    minLength: (count) => `At least ${count} characters`,
    uppercase: "One uppercase letter",
    lowercase: "One lowercase letter",
    numbers: "One number",
    special: "One special character",
  },
  suggestions: {
    minLength: (count) => `Use at least ${count} characters`,
    uppercase: "Add uppercase letters",
    lowercase: "Add lowercase letters",
    numbers: "Include numbers",
    special: "Add special characters",
  },
};

export const EN_US_RICH_EDITOR_TOOLBAR_COPY: Required<RichEditorToolbarCopy> = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  bulletList: "Bulleted list",
  numberedList: "Numbered list",
  quote: "Quote",
  code: "Code",
  insertLink: "Insert link",
  textColor: "Text colour",
  backgroundColor: "Background colour",
  linkPrompt: "Enter the URL:",
  editorLabel: "Rich text editor",
};

export const EN_US_PHONE_INPUT_COPY: Required<PhoneInputCopy> = {
  selectCountry: "Select country",
  invalidNumber: (countryName) => `Not a valid phone number for ${countryName}`,
  // Substituted into the sentence above when no country is chosen, so it has to
  // read as a noun phrase inside it rather than as a sentence of its own.
  unknownCountry: "the selected country",
  countryName: (_code, englishName) => englishName,
  label: "Phone Number",
  placeholder: "Enter phone number",
};

export const EN_US_UPLOAD_BUTTON_COPY: Required<UploadButtonCopy> = {
  buttonLabel: "Upload a file",
  dropzoneHint: "Drop the file here, or click to choose one",
  dropzoneRole: (label) => `File upload area. ${label}`,
  uploading: "Uploading…",
  dropReady: "File ready to drop",
  percentUploaded: (percent) => `${percent}% uploaded`,
  uploadInProgress: (percent) => `Upload in progress: ${percent}%`,
  errorAnnouncement: (message) => `Error: ${message}`,
  fileTooLarge: (maxSizeMB) => `File size must be less than ${maxSizeMB}MB`,
  uploadFailed: "Upload failed",
};

export const EN_US_SOCIAL_LOGIN_COPY: SocialLoginCopy = {
  google: "Continue with Google",
  facebook: "Continue with Facebook",
  apple: "Continue with Apple",
};
