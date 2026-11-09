import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../Button';
import { FormContainer, SubmitButton, TextField } from '../total-form';
import { FormHoldProvider, useFormBusy, useFormHold } from './FormHold';

/** A field whose upload the test switches on and off. */
function Uploader({ held, holdKey = 'photo' }: { held: boolean; holdKey?: string }): null {
  useFormHold(holdKey, held);
  return null;
}

/** A host control that opts in to the hold. */
function OptIn(): React.ReactElement {
  const busy = useFormBusy();
  return (
    <button type="button" disabled={busy} data-testid="opt-in">
      Replace
    </button>
  );
}

function HeldForm({ held, onSubmit }: { held: boolean; onSubmit: () => void }): React.ReactElement {
  return (
    <FormContainer initialValues={{ name: 'Soap' }} onSubmit={onSubmit} dataTestId="form">
      <Uploader held={held} />
      <TextField name="name" label="Name" />
      <OptIn />
      <Button dataTestId="close">Close</Button>
      <Button dataTestId="publish" progress={held ? { fraction: 0.4, label: 'Sending photo · ~5 s' } : undefined}>
        Publish
      </Button>
      <SubmitButton>Save</SubmitButton>
    </FormContainer>
  );
}

describe('FormHold — what busy holds', () => {
  it('holds the fields, the submit and an opted-in control; a plain Button stays live', () => {
    render(<HeldForm held onSubmit={vi.fn()} />);
    expect(screen.getByTestId('total-form-field-name')).toBeDisabled();
    expect(screen.getByTestId('total-form-submit')).toBeDisabled();
    expect(screen.getByTestId('opt-in')).toBeDisabled();
    expect(screen.getByTestId('close')).toBeEnabled();
  });

  it('keeps a Button with progress focusable: aria-disabled, never disabled', () => {
    render(<HeldForm held onSubmit={vi.fn()} />);
    const publish = screen.getByTestId('publish');
    expect(publish).toBeEnabled();
    expect(publish).toHaveAttribute('aria-disabled', 'true');
    // Still in the tab order: a disabled button would drop out of it.
    expect(publish).not.toHaveAttribute('tabindex', '-1');
  });

  it('releases everything when the hold ends', () => {
    const { rerender } = render(<HeldForm held onSubmit={vi.fn()} />);
    rerender(<HeldForm held={false} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('total-form-field-name')).toBeEnabled();
    expect(screen.getByTestId('total-form-submit')).toBeEnabled();
    expect(screen.getByTestId('opt-in')).toBeEnabled();
  });

  it('holds while ANY key holds', () => {
    const { rerender } = render(
      <FormHoldProvider>
        <Uploader holdKey="a" held />
        <Uploader holdKey="b" held />
        <OptIn />
      </FormHoldProvider>,
    );
    rerender(
      <FormHoldProvider>
        <Uploader holdKey="a" held={false} />
        <Uploader holdKey="b" held />
        <OptIn />
      </FormHoldProvider>,
    );
    expect(screen.getByTestId('opt-in')).toBeDisabled();
  });

  it('releases a key whose field unmounts', () => {
    const { rerender } = render(
      <FormHoldProvider>
        <Uploader held />
        <OptIn />
      </FormHoldProvider>,
    );
    rerender(
      <FormHoldProvider>
        <OptIn />
      </FormHoldProvider>,
    );
    expect(screen.getByTestId('opt-in')).toBeEnabled();
  });

  it('a hold in an inner provider holds the outer one, and an outer hold reaches inside', () => {
    function Outer({ inner, outer }: { inner: boolean; outer: boolean }): React.ReactElement {
      const Probe = ({ id }: { id: string }) => <span data-testid={id}>{String(useFormBusy())}</span>;
      return (
        <FormHoldProvider>
          <Uploader holdKey="outer" held={outer} />
          <Probe id="outer-busy" />
          <FormHoldProvider>
            <Uploader holdKey="inner" held={inner} />
            <Probe id="inner-busy" />
          </FormHoldProvider>
        </FormHoldProvider>
      );
    }
    const { rerender } = render(<Outer inner outer={false} />);
    expect(screen.getByTestId('outer-busy')).toHaveTextContent('true');
    rerender(<Outer inner={false} outer />);
    expect(screen.getByTestId('inner-busy')).toHaveTextContent('true');
    rerender(<Outer inner={false} outer={false} />);
    expect(screen.getByTestId('outer-busy')).toHaveTextContent('false');
    expect(screen.getByTestId('inner-busy')).toHaveTextContent('false');
  });

  it('sibling scopes under one shared provider hold each other through it', () => {
    function Probe({ id }: { id: string }): React.ReactElement {
      return <span data-testid={id}>{String(useFormBusy())}</span>;
    }
    render(
      <FormHoldProvider>
        <FormHoldProvider>
          <Uploader holdKey="a" held />
        </FormHoldProvider>
        <FormHoldProvider>
          <Probe id="sibling-busy" />
        </FormHoldProvider>
      </FormHoldProvider>,
    );
    expect(screen.getByTestId('sibling-busy')).toHaveTextContent('true');
  });

  it('an isolated scope sends nothing up and takes nothing in', () => {
    function Probe({ id }: { id: string }): React.ReactElement {
      return <span data-testid={id}>{String(useFormBusy())}</span>;
    }
    function Page({ inIsland, outside }: { inIsland: boolean; outside: boolean }): React.ReactElement {
      return (
        <FormHoldProvider>
          <Uploader holdKey="outside" held={outside} />
          <Probe id="page-busy" />
          <FormHoldProvider isolate>
            <Uploader holdKey="island" held={inIsland} />
            <Probe id="island-busy" />
          </FormHoldProvider>
          <FormHoldProvider>
            <Probe id="sibling-busy" />
          </FormHoldProvider>
        </FormHoldProvider>
      );
    }
    const { rerender } = render(<Page inIsland outside={false} />);
    expect(screen.getByTestId('island-busy')).toHaveTextContent('true');
    expect(screen.getByTestId('page-busy')).toHaveTextContent('false');
    expect(screen.getByTestId('sibling-busy')).toHaveTextContent('false');
    rerender(<Page inIsland={false} outside />);
    expect(screen.getByTestId('page-busy')).toHaveTextContent('true');
    expect(screen.getByTestId('island-busy')).toHaveTextContent('false');
  });

  it('is false, and holds nothing, outside any provider', () => {
    render(
      <>
        <Uploader held />
        <OptIn />
      </>,
    );
    expect(screen.getByTestId('opt-in')).toBeEnabled();
  });
});

describe('FormContainer with a drawer scope inside it', () => {
  /** The product editor: a variation drawer is its own (portal-safe) scope inside the form. */
  function Editor({ main, drawer }: { main: boolean; drawer: boolean }): React.ReactElement {
    return (
      <FormContainer initialValues={{ name: 'Soap' }} onSubmit={vi.fn()} dataTestId="form">
        <Uploader holdKey="main-photo" held={main} />
        <TextField name="name" label="Name" />
        <SubmitButton>Save</SubmitButton>
        <FormHoldProvider>
          <Uploader holdKey="variation-photo" held={drawer} />
          <OptIn />
        </FormHoldProvider>
      </FormContainer>
    );
  }

  it('a hold in the drawer holds the whole form', () => {
    render(<Editor main={false} drawer />);
    expect(screen.getByTestId('total-form-submit')).toBeDisabled();
    expect(screen.getByTestId('total-form-field-name')).toBeDisabled();
    expect(screen.getByTestId('opt-in')).toBeDisabled();
  });

  it('a hold in the form holds the drawer', () => {
    render(<Editor main drawer={false} />);
    expect(screen.getByTestId('opt-in')).toBeDisabled();
    expect(screen.getByTestId('total-form-submit')).toBeDisabled();
  });
});

describe('FormContainer — onSubmit while held', () => {
  it('is not called while held, even through requestSubmit(), and is once released', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<HeldForm held onSubmit={onSubmit} />);
    const form = screen.getByTestId('form') as HTMLFormElement;

    await act(async () => {
      form.requestSubmit();
    });
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<HeldForm held={false} onSubmit={onSubmit} />);
    await act(async () => {
      form.requestSubmit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('says it is busy while held', () => {
    render(<HeldForm held onSubmit={vi.fn()} />);
    expect(screen.getByTestId('form')).toHaveAttribute('aria-busy', 'true');
  });
});
