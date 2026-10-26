import { describe, expect, it, vi } from "vitest";

import { credentialsProvider } from "../credentials-provider";
import { PT_BR_CREDENTIALS_LABELS } from "../credentials-provider.pt-BR";

/**
 * What Auth.js's own sign-in page shows for the provider: the method's name
 * and its two fields. They were English literals no host could replace; they
 * are now the host's, and English only when it names nothing.
 */

interface ProviderOptions {
  name: string;
  credentials: { email: { label: string }; password: { label: string } };
}

function optionsOf(provider: ReturnType<typeof credentialsProvider>): ProviderOptions {
  return (provider as unknown as { options: ProviderOptions }).options;
}

describe("credentialsProvider labels", () => {
  it("reads in English when the host names nothing", () => {
    const options = optionsOf(credentialsProvider({ authenticate: vi.fn() }));
    expect(options.name).toBe("Email and password");
    expect(options.credentials.email.label).toBe("Email");
    expect(options.credentials.password.label).toBe("Password");
  });

  it("takes the host's pack", () => {
    const options = optionsOf(credentialsProvider({ authenticate: vi.fn(), labels: PT_BR_CREDENTIALS_LABELS }));
    expect(options.name).toBe("E-mail e senha");
    expect(options.credentials.email.label).toBe("E-mail");
    expect(options.credentials.password.label).toBe("Senha");
  });

  it("keeps an explicit name over the pack's", () => {
    const options = optionsOf(
      credentialsProvider({ authenticate: vi.fn(), name: "Senha da loja", labels: PT_BR_CREDENTIALS_LABELS }),
    );
    expect(options.name).toBe("Senha da loja");
  });
});
