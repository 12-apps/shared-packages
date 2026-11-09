/**
 * The pieces a step form needs on top of the total-form layer (FUT-4476):
 * `setFieldErrors` on the context, `SubmitButton`'s `disabled` / `describedBy`
 * and `FormErrorSnackbar`'s `show`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormContainer, FormContext, FormErrorSnackbar, Fields, SubmitButton, useFormContext } from "./index";
import type { TotalFormContextValue } from "./index";

interface Values extends Record<string, string> {
  name: string;
}

/** A caller that validates live: it paints errors from the context, and again after each edit. */
function LiveValidation(): React.ReactElement {
  const { setFieldErrors, setFieldValue } = useFormContext();
  return (
    <>
      <button type="button" onClick={() => setFieldErrors({ name: "Name is wrong" })}>
        paint
      </button>
      <button type="button" onClick={() => setFieldErrors({})}>
        clear
      </button>
      <button type="button" onClick={() => setFieldValue("name", "typed")}>
        type
      </button>
    </>
  );
}

function renderForm(children: React.ReactNode) {
  return render(
    <FormContainer<Values> initialValues={{ name: "" }} onSubmit={() => undefined}>
      <Fields.TextField name="name" label="Name" />
      {children}
    </FormContainer>,
  );
}

describe("setFieldErrors on the total-form context", () => {
  it("paints the errors it is given on their fields", async () => {
    renderForm(<LiveValidation />);
    await waitFor(() => expect(screen.queryByTestId("total-form-field-name-message")).toBeNull());

    fireEvent.click(screen.getByText("paint"));

    expect((await screen.findByTestId("total-form-field-name-message")).textContent).toContain("Name is wrong");
  });

  it("replaces the whole map, so {} clears every error", async () => {
    renderForm(<LiveValidation />);
    fireEvent.click(screen.getByText("paint"));
    await screen.findByTestId("total-form-field-name-message");

    fireEvent.click(screen.getByText("clear"));

    await waitFor(() => expect(screen.queryByTestId("total-form-field-name-message")).toBeNull());
  });

  it("still lets setFieldValue clear the edited field's error", async () => {
    renderForm(<LiveValidation />);
    fireEvent.click(screen.getByText("paint"));
    await screen.findByTestId("total-form-field-name-message");

    fireEvent.click(screen.getByText("type"));

    await waitFor(() => expect(screen.queryByTestId("total-form-field-name-message")).toBeNull());
    expect(screen.getByTestId("total-form-field-name")).toHaveValue("typed");
  });
});

describe("SubmitButton disabled and describedBy", () => {
  it("is enabled and carries no description by default", () => {
    renderForm(<SubmitButton>Go</SubmitButton>);
    const button = screen.getByTestId("total-form-submit");
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("is disabled by `disabled` and points at the element that says why", () => {
    renderForm(
      <>
        <p id="why">Missing: name</p>
        <SubmitButton disabled describedBy="why">
          Go
        </SubmitButton>
      </>,
    );
    const button = screen.getByTestId("total-form-submit");
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Missing: name");
  });

  it("stays disabled while the form submits, even when `disabled` is false", async () => {
    render(
      <FormContainer<Values>
        initialValues={{ name: "" }}
        onSubmit={() => new Promise<void>((resolve) => setTimeout(resolve, 50))}
      >
        <SubmitButton disabled={false}>Go</SubmitButton>
      </FormContainer>,
    );
    fireEvent.click(screen.getByTestId("total-form-submit"));
    await waitFor(() => expect(screen.getByTestId("total-form-submit")).toBeDisabled());
    await waitFor(() => expect(screen.getByTestId("total-form-submit")).toBeEnabled());
  });
});

describe("FormErrorSnackbar show", () => {
  const snackbar = () => screen.queryByTestId("total-form-error-snackbar");

  it("keeps today's behaviour when `show` is omitted: shown once any field has an error", async () => {
    renderForm(
      <>
        <LiveValidation />
        <FormErrorSnackbar />
      </>,
    );
    expect(snackbar()).toBeNull();
    fireEvent.click(screen.getByText("paint"));
    await waitFor(() => expect(snackbar()).not.toBeNull());
  });

  it("renders nothing while `show` is false, even with errors", async () => {
    renderForm(
      <>
        <LiveValidation />
        <FormErrorSnackbar show={false} />
      </>,
    );
    fireEvent.click(screen.getByText("paint"));
    await screen.findByTestId("total-form-field-name-message");
    expect(snackbar()).toBeNull();
  });

  it("renders only while `show` is true AND errors exist", async () => {
    renderForm(
      <>
        <LiveValidation />
        <FormErrorSnackbar show />
      </>,
    );
    expect(snackbar()).toBeNull();
    fireEvent.click(screen.getByText("paint"));
    await waitFor(() => expect(snackbar()).not.toBeNull());
    fireEvent.click(screen.getByText("clear"));
    await waitFor(() => expect(snackbar()).toBeNull());
  });
});

describe("setFieldErrors is optional on the exported value type", () => {
  // Compile fixture: a hand-built value written before `setFieldErrors` existed
  // (a test double of the context) must keep type-checking. `check-types` fails
  // this file if the member becomes required again.
  const handBuilt: TotalFormContextValue = {
    values: {},
    errors: {},
    submitting: false,
    setFieldValue: () => undefined,
  };

  function Probe(): React.ReactElement {
    const { setFieldErrors } = useFormContext();
    // Non-optional for callers of the hook: no `?.` needed.
    const result: void = setFieldErrors({ name: "x" });
    return <span data-testid="probe">{typeof setFieldErrors}:{String(result)}</span>;
  }

  it("lets the hook return a callable setFieldErrors under a hand-built provider", () => {
    render(
      <FormContext.Provider value={handBuilt}>
        <Probe />
      </FormContext.Provider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("function:undefined");
  });

  it("returns the container's own setter under a FormContainer", async () => {
    renderForm(<LiveValidation />);
    fireEvent.click(screen.getByText("paint"));
    expect(await screen.findByTestId("total-form-field-name-message")).toBeInTheDocument();
  });
});
