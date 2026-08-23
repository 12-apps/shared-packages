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
}
