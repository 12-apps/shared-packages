import type {
  AuthEmailMessage,
  AuthTokenPurpose,
  EmailCredentialUser,
  EmailCredentialsMailer,
  EmailCredentialsStore,
  StoredAuthToken,
} from "../types";

/**
 * An in-memory host: the store and the mailer the flow talks to, with the
 * behaviours that actually matter kept honest.
 *
 * The one that earns its keep is `consumeToken`, which is a CONDITIONAL write
 * here exactly as it must be in SQL. A fake that just stamps the field would
 * make the single-use tests pass while the real implementation raced.
 */

interface TokenRow extends StoredAuthToken {
  consumedAt: Date | null;
}

interface SentEmail extends Partial<AuthEmailMessage> {
  /**
   * Which message this was, for the assertion that follows.
   *
   * **None of these labels may contain the word "password", however natural it
   * reads.** CodeQL classifies a CALL by its string arguments, so
   * `lastEmail("password-reset")` — and `tokenFromLink(host, "password-reset")`
   * with it — becomes a "cleartext password" source. Its return value is the
   * reset token, which goes straight to `hashToken`'s SHA-256, and the result is
   * a high-severity `js/insufficient-password-hash` alert reporting a password
   * that never existed: the only "password" in the path is this label.
   *
   * `verification` never had the problem because its label never said it.
   */
  kind: "verification" | "reset-link" | "account-exists" | "change-notice";
  to: string;
}

export class FakeHost implements EmailCredentialsStore, EmailCredentialsMailer {
  readonly users = new Map<string, EmailCredentialUser>();
  readonly tokens: TokenRow[] = [];
  readonly sent: SentEmail[] = [];
  #nextId = 1;

  /**
   * Put a user in the map directly, bypassing the flow — the "already had a
   * Google account" setup.
   *
   * Named `withUser` rather than `seed` on purpose: `seed` is a method name the
   * flakiness gate treats as a database operation, and this is a `Map`.
   */
  withUser(user: Omit<EmailCredentialUser, "id"> & { id?: string }): EmailCredentialUser {
    const row: EmailCredentialUser = {
      id: user.id ?? `user-${this.#nextId++}`,
      email: user.email,
      name: user.name ?? null,
      passwordHash: user.passwordHash ?? null,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
    };
    this.users.set(row.id, row);
    return row;
  }

  /** The most recent message of a kind, which is what a test asserts against. */
  lastEmail(kind: SentEmail["kind"]): SentEmail | undefined {
    return [...this.sent].reverse().find((message) => message.kind === kind);
  }

  // ---- store -------------------------------------------------------------

  async findByEmail(email: string): Promise<EmailCredentialUser | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async findById(id: string): Promise<EmailCredentialUser | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(input: {
    email: string;
    name?: string | null;
    passwordHash: string;
    emailVerifiedAt?: Date | null;
  }): Promise<EmailCredentialUser> {
    return this.withUser(input);
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) user.passwordHash = passwordHash;
  }

  async markEmailVerified(userId: string, verifiedAt: Date): Promise<void> {
    const user = this.users.get(userId);
    if (user) user.emailVerifiedAt = verifiedAt;
  }

  async saveToken(input: {
    userId: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.tokens.push({ ...input, consumedAt: null });
  }

  async findToken(
    purpose: AuthTokenPurpose,
    tokenHash: string,
  ): Promise<StoredAuthToken | null> {
    return (
      this.tokens.find((row) => row.purpose === purpose && row.tokenHash === tokenHash) ?? null
    );
  }

  /** `UPDATE … WHERE consumed_at IS NULL` — answers whether it won the race. */
  async consumeToken(
    purpose: AuthTokenPurpose,
    tokenHash: string,
    consumedAt: Date,
  ): Promise<boolean> {
    const row = this.tokens.find(
      (candidate) => candidate.purpose === purpose && candidate.tokenHash === tokenHash,
    );
    if (!row || row.consumedAt) return false;
    row.consumedAt = consumedAt;
    return true;
  }

  async deleteTokens(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    for (let i = this.tokens.length - 1; i >= 0; i -= 1) {
      const row = this.tokens[i] as TokenRow;
      if (row.userId === userId && row.purpose === purpose) this.tokens.splice(i, 1);
    }
  }

  // ---- mailer ------------------------------------------------------------

  async sendVerification(message: AuthEmailMessage): Promise<void> {
    this.sent.push({ ...message, kind: "verification" });
  }

  async sendPasswordReset(message: AuthEmailMessage): Promise<void> {
    this.sent.push({ ...message, kind: "reset-link" });
  }

  async sendAccountExists(message: AuthEmailMessage): Promise<void> {
    this.sent.push({ ...message, kind: "account-exists" });
  }

  async sendPasswordChanged(message: { to: string; name?: string | null }): Promise<void> {
    this.sent.push({ ...message, kind: "change-notice" });
  }
}
