import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { email, required } from "@repo/shared-helpers/forms";

import { FormContainer, Fields, FormErrorSnackbar, SubmitButton } from "./index";
import type { FormSubmitHelpers } from "./index";

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
