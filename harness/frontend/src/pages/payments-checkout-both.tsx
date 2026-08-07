/**
 * Both methods offered, and what switching between them must do (FUT-743).
 *
 * A store whose chain declares PIX and CARD renders two tiles and preselects
 * neither — a choice with two options is a real choice. The fact under test is
 * what happens on the second tap: the controller DROPS the order raised for the
 * previous method before raising the other one. Without that, a buyer who
 * changes their mind is looking at a card form with a live PIX QR behind it,
 * and two charges exist for one payable.
 *
 * Nobody has paid the QR here (`settlesOnPoll: false`). That is the ordinary
 * state a buyer sits in while changing their mind, and it is the state this
 * page is about: with the code settling underneath them the flow advances to
 * the confirmation and there is no picker left to switch on.
 */
import type { JSX } from 'react';

import { MountedCheckout, mintable } from '../payments/cases';
import { PageIntro } from '../payments/panel';

export function PaymentsCheckoutBothPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · PIX and card">
        Both tiles offered, nothing preselected. Switching method drops the order raised for the
        previous one and raises the other, so no stale QR ever sits behind a card form.
      </PageIntro>
      <MountedCheckout
        spec={{ chain: [mintable('aurora', ['PIX', 'CARD'], { settlesOnPoll: false })] }}
        label="both"
      />
    </>
  );
}
