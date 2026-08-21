import type { Meta, StoryObj } from "@storybook/react-vite";

import { createWebDiscounts } from "./create-web-discounts";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";
import {
  storyTransport,
  StoryCurrencyField,
  storyOnError,
  STORY_GROUPS,
  type StoryWorldOptions,
} from "./__stories__/fixtures";

/**
 * The whole promotions admin, as a host mounts it.
 *
 * Every story here builds the surface through `createWebDiscounts` rather than
 * rendering the screen directly, because the FACTORY is the contract: if a
 * config shape stops working, these stories stop rendering, which is exactly
 * the feedback a book should give.
 *
 * The transport is substituted per story. That is the seam doing its job — and
 * it is what makes the two states nobody can produce on demand in a real
 * environment (a refused write, a backend that will not answer) ordinary things
 * to look at.
 */

/**
 * One surface per story, built OUTSIDE the render — the rule the factory's own
 * docstring states, followed here rather than only described.
 */
function screenWith(options: StoryWorldOptions = {}) {
  const { Screen } = createWebDiscounts({
    apiBase: "/api/admin/minha-loja",
    copy: PT_BR_DISCOUNTS_WEB_COPY,
    locale: "pt-BR",
    currency: "BRL",
    currencyField: StoryCurrencyField,
    onError: storyOnError,
    transport: storyTransport(options),
    breadcrumb: [{ label: "Início", href: "/admin" }, { label: "Descontos" }],
  });
  return Screen;
}

const meta: Meta = {
  title: "Discounts/Screen",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The promotions list: a server-driven grid whose query IS the URL, a create dialog in the header, and a self-contained menu on every row and card. Built through `createWebDiscounts` — one config in, an object of component types out.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  name: "The list",
  parameters: {
    docs: {
      description: {
        story:
          "Five promotions covering every branch the row renders: a coupon, a category rule inside its window, a scheduled combo, a paused one that has hit its cap, and an item rule. The value column is pre-formatted once per page so the grid, the cards and the export cannot disagree about what a promotion is worth.",
      },
    },
  },
  render: () => {
    const Screen = screenWith();
    return <Screen />;
  },
};

export const Filtered: Story = {
  name: "Arrived on a filtered link",
  parameters: {
    initialUrl: "/discounts?scope_in=CATEGORY,ITEM&active=true&q=bebidas",
    docs: {
      description: {
        story:
          "The grid seeds its applied state from the URL — once, in an initializer. Without that, the empty client state emits an unfiltered query on first render and wipes the params the operator arrived with, which is how a shared link turns into an unfiltered list.",
      },
    },
  },
  render: () => {
    const Screen = screenWith();
    return <Screen />;
  },
};

export const Empty: Story = {
  name: "A store with no promotions",
  render: () => {
    const Screen = screenWith({ rows: [] });
    return <Screen />;
  },
};

export const Loading: Story = {
  name: "While the first page loads",
  parameters: {
    docs: {
      description: {
        story:
          "Only the FIRST load shows this. A refetch keeps the previous page on screen, so paging and filtering do not flash an empty table.",
      },
    },
  },
  render: () => {
    const Screen = screenWith({ neverSettle: true });
    return <Screen />;
  },
};

export const ReadFailed: Story = {
  name: "The backend would not answer",
  parameters: {
    docs: {
      description: {
        story:
          "The operator gets a sentence and a retry. Separately — and this is the half a screenshot cannot show — `onError` is called with `discounts.list`, which is how anybody other than this operator learns it happened.",
      },
    },
  },
  render: () => {
    const Screen = screenWith({ failList: "Falha ao consultar o servidor." });
    return <Screen />;
  },
};

export const CatalogUnavailable: Story = {
  name: "The catalog would not load",
  parameters: {
    docs: {
      description: {
        story:
          "A failed CATALOG read is not a failed page: the grid is perfectly readable without it. What is withheld is the edit form, because opening one with empty pickers and saving would silently clear a target list it never had the chance to display. Only delete is offered on each row.",
      },
    },
  },
  render: () => {
    const Screen = screenWith({ groups: [] });
    return <Screen />;
  },
};

export const WriteRefused: Story = {
  name: "The server refuses a write",
  parameters: {
    docs: {
      description: {
        story:
          "Open “Novo desconto”, fill it in and save. The server's sentence lands in the banner AND its per-field messages paint the inputs red — the form re-states what it can attribute rather than only shouting at the top of the dialog.",
      },
    },
  },
  render: () => {
    const Screen = screenWith({
      refuseWith: {
        error: "Já existe um desconto com esse nome.",
        fieldErrors: { name: "Já existe um desconto com esse nome." },
      },
    });
    return <Screen />;
  },
};

export const OneCollection: Story = {
  name: "A host that registered one collection",
  parameters: {
    docs: {
      description: {
        story:
          "Which collections are discountable is a host registration, not a schema fact. Here only products are registered, so the category picker does not exist — the form is the same file, and nothing in it names a collection.",
      },
    },
  },
  render: () => {
    const Screen = screenWith({ groups: STORY_GROUPS.filter((g) => g.targetType === "ITEM") });
    return <Screen />;
  },
};
