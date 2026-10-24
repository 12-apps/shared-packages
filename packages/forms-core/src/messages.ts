/** The sentences this package falls back to, in one host-chosen language. */
export interface FormsMessages {
  /** `createServerAction`'s answer to an unexpected throw. */
  genericError: string;
  /** `required()`. */
  required: string;
  /** `email()`. */
  email: string;
  /** `minLength(n)`. */
  minLength: (length: number) => string;
}
