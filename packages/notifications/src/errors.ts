/** Thrown by `notify` when no generator is registered for the event type. */
export class UnknownNotificationTypeError extends Error {
  readonly type: string;
  constructor(type: string) {
    super(`No notification generator registered for type "${type}".`);
    this.name = 'UnknownNotificationTypeError';
    this.type = type;
    Object.setPrototypeOf(this, UnknownNotificationTypeError.prototype);
  }
}

/** Thrown by `notify` when the recipient has no contact record in the host. */
export class UnknownNotificationRecipientError extends Error {
  readonly userId: string;
  constructor(userId: string) {
    super(`notify(): unknown recipient user "${userId}".`);
    this.name = 'UnknownNotificationRecipientError';
    this.userId = userId;
    Object.setPrototypeOf(this, UnknownNotificationRecipientError.prototype);
  }
}
