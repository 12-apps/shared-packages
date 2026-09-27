/**
 * ONE role="dialog", NOT TWO (FUT-2861).
 *
 * `DIALOG_STATIC_PROPS` used to spread its own static `role: 'dialog'` onto
 * MUI's `<Dialog>`. MUI's `Dialog` destructures `aria-labelledby` and
 * `aria-modal` by name and applies them (with its own hard-coded
 * `role="dialog"`) to the Paper slot — the element that is actually the
 * WAI-ARIA dialog — but `role` is not one of the props it destructures, so it
 * fell into `...other` and landed a SECOND, unlabelled `role="dialog"` on the
 * outer Modal root. Every open Lightbox therefore exposed two dialog-role
 * elements to assistive tech: one correctly labelled (the Paper, via
 * `aria-labelledby="lightbox-title"`), one with no accessible name at all
 * (the outer root).
 *
 * Queries go through `document.body` because the Lightbox is portalled: MUI's
 * `Dialog` renders into a `Portal` outside the container `render` returns.
 */
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Lightbox } from '../Lightbox';
import type { LightboxItem } from '../Lightbox.types';
import { PT_BR_LIGHTBOX_COPY } from '../../../../pt-BR';

afterEach(cleanup);

const items: LightboxItem[] = [{ src: 'data:image/svg+xml,<svg/>', alt: 'Foto de teste', type: 'image' }];

describe('Given an open Lightbox', () => {
  it('exposes exactly one role="dialog" element, and it has an accessible name', () => {
    render(
      <Lightbox copy={PT_BR_LIGHTBOX_COPY} isOpen items={items} onClose={() => {}} />,
    );

    const body = within(document.body);
    const dialogs = body.getAllByRole('dialog');

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName();
    expect(dialogs[0]).toHaveAttribute('aria-labelledby', 'lightbox-title');
  });
});
