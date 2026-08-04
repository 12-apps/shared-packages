import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { email, required } from "@12-apps/forms-core";

import { FormContainer, Fields, FormErrorSnackbar, SubmitButton } from "./index";
import type { FormSubmitHelpers } from "./index";
import type { CepAddress } from "../CepField";

interface LoginValues extends Record<string, string> {
  email: string;
}

function renderForm(onSubmit: (values: LoginValues, helpers: FormSubmitHelpers) => void) {
  return render(
    <FormContainer<LoginValues>
      initialValues={{ email: "" }}
      schema={{ email: [required(), email()] }}
      onSubmit={onSubmit}
    >
      <Fields.TextField name="email" label="Email" />
      <FormErrorSnackbar />
      <SubmitButton>Submit</SubmitButton>
    </FormContainer>,
  );
}

describe("total-form (RTL)", () => {
  it("surfaces a field-level error and the error snackbar when a required/email field is submitted empty", async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    // Presence evidence (the form rendered), then assert no error UI before the
    // first submit — wrapped in waitFor per the anti-flake rule.
    expect(screen.getByTestId("total-form-field-email")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("total-form-field-email-message")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("total-form-error-snackbar")).toBeNull());

    fireEvent.click(screen.getByTestId("total-form-submit"));

    const message = await screen.findByTestId("total-form-field-email-message");
    expect(message).toBeInTheDocument();
    expect(message.textContent?.trim()).not.toBe("");

    const snackbar = await screen.findByTestId("total-form-error-snackbar");
    expect(snackbar).toBeVisible();

    // Invalid input never reaches the submit handler.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears the field error and passes validated values to onSubmit once the input is valid", async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    fireEvent.click(screen.getByTestId("total-form-submit"));
    await screen.findByTestId("total-form-field-email-message");

    fireEvent.change(screen.getByTestId("total-form-field-email"), {
      target: { value: "valid@example.com" },
    });
    fireEvent.click(screen.getByTestId("total-form-submit"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("total-form-field-email-message"),
      ).toBeNull();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      { email: "valid@example.com" },
      expect.objectContaining({ setFieldErrors: expect.any(Function) }),
    );
  });

  it("highlights a field when onSubmit reports a server-side error via setFieldErrors", async () => {
    const onSubmit = vi.fn((_values: LoginValues, helpers: FormSubmitHelpers) => {
      helpers.setFieldErrors({ email: "Já existe uma conta com esse email." });
    });
    renderForm(onSubmit);

    fireEvent.change(screen.getByTestId("total-form-field-email"), {
      target: { value: "taken@example.com" },
    });
    fireEvent.click(screen.getByTestId("total-form-submit"));

    const message = await screen.findByTestId("total-form-field-email-message");
    expect(message.textContent).toContain("Já existe uma conta com esse email.");

    // Editing the field clears the server error.
    fireEvent.change(screen.getByTestId("total-form-field-email"), {
      target: { value: "fresh@example.com" },
    });
    await waitFor(() => {
      expect(screen.queryByTestId("total-form-field-email-message")).toBeNull();
    });
  });
});

/**
 * `Fields.CepField` autofill ownership (FUT-306). The adapter writes resolved
 * address parts into sibling fields, and the rule that keeps it honest runs in
 * BOTH directions: it must never overwrite what the user typed, and it must
 * never leave one CEP's address sitting under a different CEP.
 */
interface AddressValues extends Record<string, string> {
  postalCode: string;
  addressLine1: string;
  neighborhood: string;
  city: string;
  state: string;
}

const CEP_FILLS = {
  street: "addressLine1",
  neighborhood: "neighborhood",
  city: "city",
  state: "state",
} as const;

const PAULISTA: CepAddress = {
  cep: "01310100",
  street: "Avenida Paulista",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

/** A "CEP geral" — a small município's catch-all, which has no logradouro. */
const CEP_GERAL: CepAddress = {
  cep: "13800000",
  street: null,
  neighborhood: null,
  city: "Mogi Mirim",
  state: "SP",
};

function renderAddressForm(lookup: (cep: string) => Promise<CepAddress | null>) {
  return render(
    <FormContainer<AddressValues>
      initialValues={{
        postalCode: "",
        addressLine1: "",
        neighborhood: "",
        city: "",
        state: "",
      }}
      onSubmit={() => undefined}
    >
      <Fields.CepField name="postalCode" lookup={lookup} fills={CEP_FILLS} debounceMs={0} />
      <Fields.TextField name="addressLine1" label="Endereço" />
      <Fields.TextField name="neighborhood" label="Bairro" />
      <Fields.TextField name="city" label="Cidade" />
    </FormContainer>,
  );
}

const cepField = (name: string): HTMLInputElement =>
  screen.getByTestId(`total-form-field-${name}`) as HTMLInputElement;

const setCep = (value: string): void => {
  fireEvent.change(cepField("postalCode"), { target: { value } });
};

describe("Fields.CepField autofill ownership", () => {
  it("fills the mapped address fields from a resolved CEP", async () => {
    renderAddressForm(async () => PAULISTA);

    setCep("01310100");

    await waitFor(() => expect(cepField("addressLine1").value).toBe("Avenida Paulista"));
    expect(cepField("neighborhood").value).toBe("Bela Vista");
    expect(cepField("city").value).toBe("São Paulo");
  });

  it("clears parts the replacement CEP has no value for", async () => {
    renderAddressForm(async (cep) => (cep === "01310100" ? PAULISTA : CEP_GERAL));

    setCep("01310100");
    await waitFor(() => expect(cepField("addressLine1").value).toBe("Avenida Paulista"));

    setCep("13800000");

    // The new CEP names no logradouro or bairro, so the old ones must go —
    // otherwise Avenida Paulista would sit under a Mogi Mirim CEP.
    await waitFor(() => expect(cepField("city").value).toBe("Mogi Mirim"));
    expect(cepField("addressLine1").value).toBe("");
    expect(cepField("neighborhood").value).toBe("");
  });

  it("undoes its own autofill when a CEP stops resolving", async () => {
    let hit = true;
    renderAddressForm(async () => (hit ? PAULISTA : null));

    setCep("01310100");
    await waitFor(() => expect(cepField("city").value).toBe("São Paulo"));

    hit = false;
    setCep("99999999");

    await waitFor(() => expect(cepField("city").value).toBe(""));
    expect(cepField("addressLine1").value).toBe("");
  });

  it("leaves a field the user typed themselves alone", async () => {
    renderAddressForm(async () => PAULISTA);

    fireEvent.change(cepField("addressLine1"), { target: { value: "Rua que eu digitei" } });
    setCep("01310100");

    await waitFor(() => expect(cepField("city").value).toBe("São Paulo"));
    expect(cepField("addressLine1").value).toBe("Rua que eu digitei");
  });
});
