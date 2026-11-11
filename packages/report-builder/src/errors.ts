/**
 * Validation/compilation error with a message written for programmatic
 * authors (builder UIs and LLMs over MCP): states what was wrong AND what is
 * available instead, so a retry can self-correct.
 */
export class ReportBuilderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReportBuilderError';
    this.code = code;
  }
}

export function unknownEntityError(entity: string, available: string[]): ReportBuilderError {
  return new ReportBuilderError(
    'unknown_entity',
    `Unknown entity "${entity}". Available entities: ${available.join(', ')}.`,
  );
}

export function unknownFieldError(
  entity: string,
  field: string,
  available: string[],
): ReportBuilderError {
  return new ReportBuilderError(
    'unknown_field',
    `Unknown field "${field}" on entity "${entity}". Available fields: ${available.join(', ')}.`,
  );
}

export function invalidSpecError(message: string): ReportBuilderError {
  return new ReportBuilderError('invalid_spec', message);
}

/** One thing wrong with a request input, and where (dotted path, empty for the whole input). */
export interface InputProblem {
  path: string;
  message: string;
}

/**
 * A request input the strict schema refused: answered 422 with every problem
 * and its path, and nothing is written. The message is the first problem, in
 * the compiler's own register, for a caller that reads only `error`.
 */
export class InvalidInputError extends ReportBuilderError {
  readonly problems: InputProblem[];

  constructor(message: string, problems: InputProblem[]) {
    super('invalid_input', message);
    this.name = 'InvalidInputError';
    this.problems = problems;
  }
}
