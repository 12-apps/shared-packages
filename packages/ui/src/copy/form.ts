/**
 * The form family's words. The largest group, and the one where the leak was
 * least visible: half of these are tooltips and announcements that only a
 * screen reader ever receives, so a language pass over the rendered text
 * walked straight past them.
 *
 * Split out of `copy.ts`, which is a barrel over this folder: one file
 * listing every family is the file that grows on every port, and it stopped
 * fitting the 400-line budget the rest of this package holds itself to.
 */

/**
 * The address field's three sentences. Two of them are about Google Maps
 * failing to arrive — read by the shopper while the field is unusable, which
 * is the worst moment to be spoken to in the wrong language.
 */
export interface AddressAutocompleteCopy {
  /** Placeholder while the Maps script is still loading. */
  loadingMaps: string;
  /** The alert shown when the script never arrived. */
  mapsLoadFailed: string;
  /** The pin button's tooltip, which is also its accessible name. */
  useCurrentLocation: string;
  /**
   * Everything below is optional so a host's existing pack keeps compiling; the
   * shipped packs carry all of it and the field falls back to the English pack.
   */
  /** The field's label and placeholder, unless the `label`/`placeholder` props win. */
  label?: string;
  placeholder?: string;
  /** The empty list's text: nothing typed yet, then typed with no match. */
  typeToSearch?: string;
  noAddressesFound?: string;
  /** The list's row while suggestions are being fetched. */
  loadingSuggestions?: string;
  /** Shown as the field's helper text when Google Maps or Places fails. */
  mapsApiLoadFailed?: string;
  mapsServicesInitFailed?: string;
  fetchSuggestionsFailed?: string;
  addressDetailsNotFound?: string;
  addressDetailsFailed?: string;
  /** The current-location button's failures. */
  noMockLocation?: string;
  mockLocationNotFound?: string;
  locationAddressFailed?: string;
  geolocationUnsupported?: string;
  geocoderUnavailable?: string;
  locationFailed?: string;
}

/** What an `Autocomplete` renders that is not one of the host's own options. */
export interface AutocompleteCopy {
  /** The two rows shown in place of options: fetching, and came back empty. */
  loading: string;
  noResults: string;
  /** The input's own prompt, used when the host does not override it. */
  placeholder: string;
}

/**
 * The code editor's chrome. Every one of the four action buttons is a glyph
 * whose tooltip IS its accessible name, so this object is the whole of what a
 * screen reader reads out for the toolbar.
 */
export interface CodeEditorCopy {
  /** Shown while the editor bundle is still arriving. */
  loading: string;
  /** The badge beside the language when the buffer cannot be edited. */
  readOnly: string;
  /** The format button's tooltip. Carries its own keyboard shortcut. */
  formatCode: string;
  /** The wrap toggle, in its two states. */
  enableWrap: string;
  disableWrap: string;
  /** The copy button, before and after it has been pressed. */
  copyToClipboard: string;
  copied: string;
  /** The fullscreen toggle, in its two states. */
  enterFullscreen: string;
  exitFullscreen: string;
}

/** The five strength bands, weakest first. */
export interface PasswordStrengthBandCopy {
  veryWeak: string;
  weak: string;
  fair: string;
  good: string;
  strong: string;
}

/**
 * One line per requirement. `minLength` takes the configured count because the
 * number is part of the sentence, and a language may not put it where English
 * does.
 */
export interface PasswordRequirementCopy {
  minLength(count: number): string;
  uppercase: string;
  lowercase: string;
  numbers: string;
  special: string;
}

/** Everything the password meter renders. */
export interface PasswordStrengthCopy {
  /** The three headings: the meter, the checklist, the tips. */
  strengthHeading: string;
  requirementsHeading: string;
  suggestionsHeading: string;
  bands: PasswordStrengthBandCopy;
  /** The checklist rows, and the tip shown for each unmet one. */
  requirements: PasswordRequirementCopy;
  suggestions: PasswordRequirementCopy;
}

/**
 * The rich-text toolbar. Ten glyph buttons, every one of them named ONLY by
 * its tooltip — so this object is the whole of what a screen reader reads out
 * for the editor's controls.
 */
export interface RichEditorToolbarCopy {
  bold: string;
  italic: string;
  underline: string;
  bulletList: string;
  numberedList: string;
  quote: string;
  code: string;
  insertLink: string;
  textColor: string;
  backgroundColor: string;
  /** The browser prompt the link button opens, asking for the URL. */
  linkPrompt: string;
  /**
   * The editing area's accessible name when the field has no placeholder to
   * lend it. Optional; the shipped packs carry it and the field falls back to
   * the English one.
   */
  editorLabel?: string;
}

/**
 * What the phone field says on its own account. The picker's name is the whole
 * of what a screen reader gets for a control rendered as a flag and a dial
 * code, and the invalid sentence is read by the shopper at the checkout.
 */
export interface PhoneInputCopy {
  /** The country picker's accessible name. */
  selectCountry: string;
  /**
   * The number does not validate for the chosen country. Takes the country's
   * own name, because a language may not place it where English does.
   */
  invalidNumber(countryName: string): string;
  /** Stands in for the country's name before one has been resolved. */
  unknownCountry: string;
  /**
   * A country's name in the picker and in `invalidNumber`, from its ISO 3166
   * code and the English name the field ships. Optional: without it the
   * English name is shown, as it always was. The pt-BR pack answers through
   * `Intl.DisplayNames`, so every country the field lists is covered.
   */
  countryName?: (code: string, englishName: string) => string;
  /**
   * The field's label when the host passes no `label` prop. Optional: without
   * it the field reads "Phone Number", as it always did.
   */
  label?: string;
  /**
   * The field's placeholder when the host passes no `placeholder` prop.
   * Optional: without it the field reads "Enter phone number", as it always
   * did. Keep it short — it shares a 320px field with the country picker.
   */
  placeholder?: string;
}

/**
 * What the upload control says beyond the host's own button label. Three of
 * the four are announcements a screen reader reads and nothing renders — which
 * is why they stayed English through every language pass.
 */
export interface UploadButtonCopy {
  /** The control's own label, used when the host does not override it. */
  buttonLabel: string;
  /** The dropzone's second line, under the host's own label. */
  dropzoneHint: string;
  /**
   * The dropzone's accessible name, which prefixes the host's label — it says
   * what KIND of control this is before saying what it uploads.
   */
  dropzoneRole(label: string): string;
  /** The button's label while an upload is in flight. */
  uploading: string;
  /** Announced when a dragged file is over the zone and would be accepted. */
  dropReady: string;
  /** The caption under the progress bar. */
  percentUploaded(percent: number): string;
  /** The same progress, announced rather than shown. */
  uploadInProgress(percent: number): string;
  /** The component's own error, announced. Takes the message it wraps. */
  errorAnnouncement(message: string): string;
  /**
   * The two errors the control raises itself. Optional so a host's existing
   * pack keeps compiling; the shipped packs carry both and the control falls
   * back to the English one.
   */
  /** A file over `maxSizeMB`. */
  fileTooLarge?: (maxSizeMB: number) => string;
  /** `onUpload` rejected with something that is not an `Error`. */
  uploadFailed?: string;
}

/**
 * The social sign-in buttons' three labels (FUT-1263).
 *
 * One key per provider rather than a single string, because the buttons are
 * rendered from a dynamic provider list — a host mapping over `['google',
 * 'facebook']` indexes this, instead of growing a switch at the call site.
 */
export interface SocialLoginCopy {
  google: string;
  facebook: string;
  apple: string;
}
