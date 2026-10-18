/**
 * The checkout as THE ORIGIN HOST dresses it (FUT-3685 child 3): what that host
 * hands the package, rebuilt here so a journey proven in the harness proves
 * something about the screen a shopper actually sees (FUT-765).
 *
 * The look of the checkout lives in what the HOST passes, not in the package's
 * defaults — which stay raw MUI on purpose (the package never imports
 * `@12-apps/ui`). The origin host passes:
 *
 *  - the `@12-apps/ui` bindings for the slot contract (its
 *    `@repo/spa-shared/payments-ui`), plus a sticky bottom bar as `ActionBar`;
 *  - the cart's lines and its money rows (the delivery fee);
 *  - the ONE list (`paymentList`): its pt-BR pack, the bar's first line, the
 *    door group ("PAGAR NA ENTREGA" — Dinheiro, Maquininha) and the amount due
 *    that prices the wallets' sheets.
 *
 * So does this file, with the same cart the `L-entrega` boards draw. Its
 * provider names stay the harness's own (`aurora`, never a real acquirer), and
 * its theme stays the harness's: the brand is the one difference a side-by-side
 * is expected to show.
 */
import type {
  CheckoutActionBarProps,
  CheckoutCartView,
  CheckoutCheckboxProps,
  CheckoutComponents,
  CheckoutDoorOption,
  CheckoutPaymentList,
  CheckoutRadioGroupProps,
} from '@12-apps/payments-frontend';
import { PAYMENT_LIST_COPY } from '@12-apps/payments-frontend/locales';
import { Alert } from '@12-apps/ui/data-display/Alert';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Stepper } from '@12-apps/ui/data-display/Stepper';
import { Button } from '@12-apps/ui/form/Button';
import { Checkbox } from '@12-apps/ui/form/Checkbox';
import { Input } from '@12-apps/ui/form/Input/outlined';
import { RadioGroup } from '@12-apps/ui/form/RadioGroup';
import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';
import { useMemo, useState, type JSX } from 'react';

import { brlLabel } from './adapter';

/** `variant="default"` pre-bound — what the origin host's binding pre-binds. */
function StorefrontCheckbox(props: CheckoutCheckboxProps): JSX.Element {
  return <Checkbox variant="default" {...props} />;
}

/** The saved-cards list's presentation in the origin host's binding. */
function StorefrontRadioGroup(props: CheckoutRadioGroupProps): JSX.Element {
  return <RadioGroup variant="default" color="primary" direction="column" {...props} />;
}

/**
 * The storefront's bottom bar: fixed to the bottom edge, on the paper colour,
 * a hairline and a soft shadow above it — where every commerce CTA of that
 * host sits.
 */
function StickyActionBar({ children, dataTestId }: CheckoutActionBarProps): JSX.Element {
  return (
    <>
      {/* Room at the end of the page, so the last row scrolls out from under the bar. */}
      <Box aria-hidden sx={{ height: (t: Theme) => t.spacing(18) }} />
      <Box
        data-testid={dataTestId}
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: (t: Theme) => t.zIndex.appBar,
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          boxShadow: (t: Theme) => `0 -8px 28px -16px ${alpha(t.palette.common.black, 0.28)}`,
          px: 2,
          pt: 1.5,
          pb: 2.25,
        }}
      >
        <Box sx={{ maxWidth: (t: Theme) => t.spacing(85), mx: 'auto', display: 'flex' }}>{children}</Box>
      </Box>
    </>
  );
}

/** Every slot, filled the way the origin host's storefront fills them. */
export const STOREFRONT_SLOTS: Partial<CheckoutComponents> = {
  Text,
  Button,
  Input,
  Checkbox: StorefrontCheckbox,
  Alert,
  LoadingState,
  Stepper,
  RadioGroup: StorefrontRadioGroup,
  ActionBar: StickyActionBar,
};

/** The `L-entrega` cart: two lines, a delivery fee, R$ 27,00. */
export const STOREFRONT_CART_CENTS = 2700;
const FEE_CENTS = 500;

/** The money row under the lines, as the host words it. */
function FeeRow(): JSX.Element {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Text variant="body" size="sm" as="span">
        Taxa de entrega
      </Text>
      <Text variant="body" size="sm" as="span">
        {brlLabel(FEE_CENTS)}
      </Text>
    </Box>
  );
}

/** The cart The origin host passes for that basket: its lines and its fee row. */
export const STOREFRONT_CART: Partial<CheckoutCartView> = {
  totalItems: 2,
  lines: [
    { key: 'combo', quantity: 1, name: 'Combo', totalLabel: brlLabel(1500) },
    { key: 'suco', quantity: 1, name: 'Suco de laranja', totalLabel: brlLabel(700) },
  ],
  discountLines: <FeeRow />,
};

/** "Pagar na entrega": cash with the troco question, or the card machine. */
function useDoorGroup(onSend: () => void): readonly CheckoutDoorOption[] {
  const [troco, setTroco] = useState<string | null>(null);
  return useMemo(
    () => [
      {
        id: 'cash',
        // The troco answers ARE the way to choose cash (FUT-3715): they show on
        // the idle row, and one tap chooses the row and answers it.
        label: troco === null ? 'Dinheiro, troco para?' : troco === 'Sem troco' ? 'Dinheiro, sem troco' : `Dinheiro, troco para ${troco}`,
        action: 'Enviar pedido',
        blocked: troco === null ? 'Diga se precisa de troco.' : null,
        onSend,
        showContentWhileIdle: true,
        content: ({ choose }) => (
          <Box role="group" aria-label="Troco" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
            {['Sem troco', 'R$ 50', 'R$ 100'].map((label) => (
              <Button
                key={label}
                variant={troco === label ? 'solid' : 'outline'}
                color="primary"
                size="sm"
                aria-pressed={troco === label}
                onClick={() => {
                  setTroco(label);
                  choose();
                }}
              >
                {label}
              </Button>
            ))}
          </Box>
        ),
      },
      {
        id: 'reader',
        label: 'Maquininha',
        hint: 'O motoboy leva a maquininha',
        action: 'Enviar pedido',
        blocked: null,
        onSend,
      },
    ],
    [troco, onSend],
  );
}

/**
 * The ONE list as the origin host's entrega mounts it: the package's own pt-BR
 * pack, the bar's first line, the door group, and the amount due.
 */
export function useStorefrontPaymentList(amountCents: number, onDoorSend: () => void): CheckoutPaymentList {
  const door = useDoorGroup(onDoorSend);
  return useMemo(
    () => ({
      copy: { ...PAYMENT_LIST_COPY['pt-BR'], doorHeading: 'Pagar na entrega' },
      summary: (
        <Text variant="body" size="sm" as="span">
          2 itens · Taxa de entrega {brlLabel(FEE_CENTS)}
        </Text>
      ),
      door,
      totalCents: amountCents,
    }),
    [door, amountCents],
  );
}
