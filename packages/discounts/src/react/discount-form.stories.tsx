import type { Meta, StoryObj } from "@storybook/react-vite";

import { createDiscountsApiClient, type DiscountWireRecord } from "./api";
import { DiscountForm } from "./discount-form";
import { createFormatters } from "./format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";
import {
  storyTransport,
  StoryCurrencyField,
  storyOnError,
  STORY_DISCOUNTS,
  STORY_GROUPS,
  type StoryWorldOptions,
} from "./__stories__/fixtures";

/**
 * The create/edit form on its own — fourteen inputs, four of which appear only
 * when another one says so.
 *
 * What these stories are for is the CONDITIONAL half. Reading the file tells
 * you the coupon input exists; only seeing it appear when Ativação flips tells
 * you it appears in the right place, and that the target picker underneath it
 * swaps rather than stacking.
 */

const formatters = createFormatters("pt-BR", "BRL");

function propsFor(editing: DiscountWireRecord | null, options: StoryWorldOptions = {}) {
  return {
    api: createDiscountsApiClient("/api/admin/minha-loja", storyTransport(options), formatters),
    copy: PT_BR_DISCOUNTS_WEB_COPY,
    formatters,
    currencyField: StoryCurrencyField,
    groups: STORY_GROUPS,
    editing,
    onSaved: () => {},
    onError: storyOnError,
  };
}

const meta: Meta<typeof DiscountForm> = {
  title: "Discounts/Form",
  component: DiscountForm,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Shared by the header's create dialog and the row menu's edit dialog, so the fields and the submit live in one place. Two kinds of value are deliberately not form values — the switches and the id lists — because `total-form` holds strings and neither is one; they sit beside it and merge in at submit.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DiscountForm>;

export const Create: Story = {
  name: "A new promotion",
  parameters: {
    docs: {
      description: {
        story:
          "The defaults are the promotion an operator creates most: a percentage, automatic, over the whole order. At ORDER scope the target block renders NOTHING — an order-wide rule covers everything, so a target list there is not empty, it is meaningless.",
      },
    },
  },
  args: propsFor(null),
};

export const EditingACoupon: Story = {
  name: "Editing a coupon",
  parameters: {
    docs: {
      description: {
        story:
          "Seeded from the record: basis points come back as the percentage the operator typed, cents as the amount, the ISO instant as a date input. Ativação is Código, so the coupon field is present — it is not there in the story above.",
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[0] as DiscountWireRecord),
};

export const EditingACategoryRule: Story = {
  name: "Editing a category rule",
  parameters: {
    docs: {
      description: {
        story:
          "Abrangência is Categoria, so the nesting picker appears — `CategorySelect`, not the flat combobox, because a flat list would put a subcategory beside its parent with nothing to tell them apart. Flip Abrangência to Item and the picker swaps live: it reads the scope from the form context rather than from a mirrored prop.",
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[1] as DiscountWireRecord),
};

export const EditingACombo: Story = {
  name: "Editing a combo",
  args: propsFor(STORY_DISCOUNTS[2] as DiscountWireRecord),
};

export const Refused: Story = {
  name: "The server refuses it",
  parameters: {
    docs: {
      description: {
        story:
          "Press Criar desconto. The banner carries the server's sentence and the named input turns red — the form re-states what the server could attribute instead of only shouting at the top. Every rule it checks locally is checked again there; this half exists for the operator's sake, never as the authority.",
      },
    },
  },
  args: propsFor(null, {
    refuseWith: {
      error: "Já existe um desconto com esse nome.",
      fieldErrors: { name: "Já existe um desconto com esse nome." },
    },
  }),
};
