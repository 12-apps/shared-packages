/**
 * Why an upload was refused, the status that describes it, and the sentence the
 * person uploading reads.
 *
 * ONE table for all of it, because the same refusal has to serve two entrances:
 * a browser POSTing bytes and a host write carrying them base64 in its body (an
 * agent's only option — a tool call is JSON). Two tables would let the two
 * entrances tell one store owner two different things about one file.
 *
 * The messages are pt-BR because they reach a Brazilian store owner, directly
 * or relayed by an agent. They are product copy, not developer strings: a host
 * with another audience passes `messages` to the mount rather than translating
 * the package.
 */

/** Everything an upload can be refused for, across both entrances. */
export type StorageProblem =
  /** The base64 field is not base64. */
  | 'invalid_base64'
  /** Zero bytes arrived. */
  | 'empty_file'
  /** Over the configured `maxBytes`. */
  | 'file_too_large'
  /** The bytes' magic number contradicts the declared `Content-Type`. */
  | 'content_mismatch'
  /** A `Content-Type` outside the accepted formats. */
  | 'unsupported_content_type'
  /** The pipeline could not decode the bytes. */
  | 'image_unreadable'
  /** Decoding would allocate more than the pipeline's pixel ceiling. */
  | 'image_dimensions_too_large'
  /** No driver could store the bytes — an operator problem, not the caller's. */
  | 'storage_not_configured'
  /** The driver refused for any other reason. */
  | 'storage_unavailable';

/** The HTTP status each refusal answers with. */
export const STORAGE_PROBLEM_STATUS: Readonly<Record<StorageProblem, number>> = {
  invalid_base64: 400,
  empty_file: 400,
  content_mismatch: 400,
  unsupported_content_type: 400,
  image_unreadable: 400,
  file_too_large: 413,
  image_dimensions_too_large: 413,
  storage_not_configured: 503,
  storage_unavailable: 502,
};

/** The sentence each refusal is stated in. */
export type StorageMessages = Readonly<Record<StorageProblem, string>>;

/** Copy that only makes sense with the configured ceiling in it. */
export interface StorageMessageContext {
  /** `8 MB`, already formatted. */
  limit: string;
}

/**
 * The default pt-BR copy. `limit` is interpolated rather than hard-coded so a
 * host that raises `maxBytes` cannot end up with a message naming the old
 * number — the single commonest way this kind of copy goes stale.
 */
export function defaultStorageMessages(context: StorageMessageContext): StorageMessages {
  return {
    invalid_base64: 'A imagem enviada não está codificada corretamente em base64.',
    empty_file: 'A imagem enviada está vazia.',
    file_too_large: `A imagem enviada é maior que o limite de ${context.limit}.`,
    content_mismatch:
      'O conteúdo da imagem não corresponde ao formato informado. Envie um PNG, JPEG, WebP ou GIF.',
    unsupported_content_type: 'Formato não suportado. Envie PNG, JPG, WebP ou GIF.',
    image_unreadable:
      'Não foi possível ler a imagem enviada — o arquivo parece estar corrompido.',
    image_dimensions_too_large:
      'A imagem enviada tem dimensões grandes demais para ser processada.',
    storage_not_configured: 'O armazenamento de imagens ainda não foi configurado nesta loja.',
    storage_unavailable:
      'Não foi possível salvar a imagem agora. Tente novamente em instantes.',
  };
}

/**
 * A refusal, carrying the status and the finished sentence.
 *
 * Thrown by the write path so a host write (`createProduct` with bytes in the
 * body) fails with a usable status instead of creating a row whose photo is
 * silently missing — the same status and the same sentence the endpoint answers.
 */
export class StorageProblemError extends Error {
  readonly problem: StorageProblem;
  readonly status: number;

  constructor(problem: StorageProblem, message: string) {
    super(message);
    this.name = 'StorageProblemError';
    this.problem = problem;
    this.status = STORAGE_PROBLEM_STATUS[problem];
  }
}

/** Is `error` one of this package's refusals? */
export function isStorageProblem(error: unknown): error is StorageProblemError {
  return error instanceof StorageProblemError;
}

/**
 * Missing configuration is an OPERATOR problem, not a runtime bug — a driver
 * raises this and the write path maps it to the 503 an admin UI can explain,
 * rather than to the generic "try again" a bucket timeout gets.
 */
export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageNotConfiguredError';
  }
}
