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
 * The create/edit form on its own — and the one question that decides what the
 * rest of it looks like.
 *
 * The form asks the KIND of promotion first (Porcentagem, Valor fixo, Combo,
 * Itens grátis) and derives everything else from it: a combo covers its own
 * groups, so it shows no Abrangência toggle at all; "leve 3, pague 2" gets a
 * one-group builder instead of the multi-group one; and only the plain two are
 * asked what they cover. See `../react/form-kind` for the mapping onto the
 * engine's `type`/`scope` pair, which is unchanged.
 *
 * What these stories are for is exactly that CONDITIONAL half. Reading the file
 * tells you the coupon input exists; only seeing it appear when Ativação flips
 * tells you it appears in the right place, and that the block underneath it
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
          "The defaults are the promotion an operator creates most: a percentage, automatic, over the whole order. Abrangência offers three scopes and not four — Combo is not one of them, it is what the Combo KIND means. At ORDER scope the target block renders NOTHING: an order-wide rule covers everything, so a target list there is not empty, it is meaningless. Switch Tipo to Combo and watch Abrangência disappear and the group builder take its place.",
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
          "Tipo is Valor fixo, so Abrangência is a real question — and it is Categoria, so the nesting picker appears: `CategorySelect`, not the flat combobox, because a flat list would put a subcategory beside its parent with nothing to tell them apart. Flip Abrangência to Item and the picker swaps live: it reads the form context rather than a mirrored prop.",
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[1] as DiscountWireRecord),
};

/*
 * What a combo can be (FUT-268), which is now exactly two things plus the one
 * shape that came before them.
 *
 * A combo is a DISCOUNT off the items it matches — a rate or an amount — and
 * the operator picks which beside the number, because "este combo dá 15% de
 * desconto" is one sentence. Getting the wrong input mounted is a 500 on a form
 * filled in correctly, since the four value columns are mutually exclusive at
 * the database, so each kind mounts exactly one.
 */

export const ComboPercentage: Story = {
  name: "Combo — 20% off the group",
  parameters: {
    docs: {
      description: {
        story:
          '"2 refrigerantes, 2 hambúrgueres e 2 batatas com 20% de desconto". Tipo is Combo, so there is no Abrangência toggle — a combo covers the groups it is made of — and the builder replaces the single picker: each group carries its own quantity and can name categories AND products at once, because a real menu mixes them. Desconto do combo picks between the two rewards; the rate is the one on screen. Combos por pedido sits with the builder rather than among the redemption limits: it is a fact about this combo, and beside "limite de usos" it read as a third cap.',
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[4] as DiscountWireRecord),
};

export const ComboFixedAmount: Story = {
  name: "Combo — R$ 5,00 off the group",
  parameters: {
    docs: {
      description: {
        story:
          'The other reward, and the whole reason Desconto do combo is a toggle: the same builder, R$ 5,00 off what the group adds up to. Flip it back to Porcentagem and the currency field is REPLACED, not hidden — an unmounted input cannot carry a stale number into a payload the database would refuse.',
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[5] as DiscountWireRecord),
};

export const FreeUnits: Story = {
  name: "Itens grátis — leve 3, pague 2",
  parameters: {
    docs: {
      description: {
        story:
          'Underneath it is a combo — one group of three, one free — but nobody describing "leve 3, pague 2" is building a combo, so this kind gets a shape of its own: how many the customer takes, how many are free, and which products count. PRODUCTS only, never categories: a single group is the whole promotion here, so it has to name things the customer recognises. The free count is the one number bounded by another — raise it to 3 and the form refuses, naming the ceiling, because "leve 3, pague 0" is a giveaway.',
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[3] as DiscountWireRecord),
};

export const LegacyBundlePrice: Story = {
  name: "A legacy bundle price, still editable",
  parameters: {
    docs: {
      description: {
        story:
          'A rule saved as "por R$ 25,00" before a combo became a discount. Preço de combo is no longer offered for a NEW promotion — a flat price reprices the group and goes silently wrong the first time one of its items changes price — but the kind toggle grows a fifth option on THIS form, and only on this form, so the rule opens, edits and saves as what it is instead of being quietly converted into something else.',
      },
    },
  },
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
