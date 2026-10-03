/** Thrown at ASSEMBLY for a miswired host — at the call site, never at a user's tap. */
export class ChatConfigError extends Error {
  readonly code = "invalid_config";

  constructor(message: string) {
    super(`@12-apps/chat: ${message}`);
    this.name = "ChatConfigError";
  }
}
