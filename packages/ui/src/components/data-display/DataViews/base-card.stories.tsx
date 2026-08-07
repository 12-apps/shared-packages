import MoreVertIcon from "@mui/icons-material/MoreVert";
import TableRestaurantOutlinedIcon from "@mui/icons-material/TableRestaurantOutlined";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { InputType } from "storybook/internal/types";

import { Chip } from "../Chip";
import { Button } from "../../form/Button";
import { DropdownMenu } from "../../navigation/DropdownMenu";
import { Box } from "../../../mui/Box";

import { BaseCard } from "./base-card";
import { DragContainerProvider } from "./data-views-drag";
import { CARD_ASPECT_RATIOS, type CardAspectRatio } from "./data-views-types";

/**
 * BaseCard is the only card in `@12-apps/ui`: a fixed-ratio, selectable tile with an
 * image (or fallback), a title/subtitle caption, a top-right menu slot, and a
 * top-left select checkbox. Domain "kind cards" live in the app and compose it.
 */
/** Tag a block of controls with one table category, keeping the block's order. */
function category(name: string, knobs: Record<string, InputType>): Record<string, InputType> {
  return Object.fromEntries(
    Object.entries(knobs).map(([prop, knob]) => [
      prop,
      { ...knob, table: { ...knob.table, category: name } },
    ]),
  );
}

/** Plumbing: real props, but nothing anybody explores a component through. */
function hidden(...props: string[]): Record<string, InputType> {
  return Object.fromEntries(props.map((prop) => [prop, { table: { disable: true } }]));
}

/** A `ReactNode` slot, as a choice between real nodes rather than a JSON trap. */
function slot(mapping: Record<string, unknown>): InputType {
  return { control: "select", options: Object.keys(mapping), mapping };
}

const kebab = (
  <DropdownMenu
    size="sm"
    items={[
      { id: "edit", label: "Editar", onClick: () => {} },
      { id: "delete", label: "Excluir", color: "error", onClick: () => {} },
    ]}
    trigger={
      // `icon` and no children: `Button` renders an icon-only button square,
      // rather than putting three dots in MUI's 64px slab.
      <Button variant="text" size="sm" aria-label="Ações" icon={<MoreVertIcon sx={{ fontSize: 18 }} />} />
    }
  />
);

const meta: Meta<typeof BaseCard> = {
  title: "DataDisplay/DataViews/BaseCard",
  component: BaseCard,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  /**
   * Defaults only — declared for their ORDER, not their values, exactly as in
   * `base-list-card.stories`. Storybook opens a category's section wherever its
   * first member lands in the merged arg list, and args merge ahead of the
   * inferred props, so these decide the running order of the table.
   */
  args: {
    aspectRatio: "4:3",
    scale: 1,
    variant: "outline",
    color: "primary",
    emphasis: "none",
    state: "default",
  },
  argTypes: {
    // The same running order the row's table uses: what reshapes the card, then
    // how it is painted, then its text, then what it does, then its slots.
    ...category("Layout", {
      aspectRatio: {
        control: "select",
        options: Object.keys(CARD_ASPECT_RATIOS) as CardAspectRatio[],
      },
      scale: { control: { type: "range", min: 0.5, max: 1.6, step: 0.05 } },
      selectable: { control: "boolean" },
      selected: { control: "boolean" },
    }),
    ...category("Appearance", {
      variant: { control: "inline-radio", options: ["outline", "ghost", "text", "glass"] },
      color: {
        control: "select",
        options: ["primary", "secondary", "success", "warning", "error", "info"],
      },
      emphasis: { control: "inline-radio", options: ["none", "attention", "new"] },
      state: { control: "inline-radio", options: ["default", "cancelled", "disabled"] },
    }),
    ...category("Content", {
      title: { control: "text" },
      subtitle: { control: "text" },
    }),
    ...category("Behaviour", {
      href: { control: "text" },
      target: { control: "text" },
      onClick: { control: false },
      onToggleSelect: { control: false },
    }),
    ...category("Slots", {
      // Pick between real nodes: a `ReactNode` has no widget, and anything typed
      // into an element blob produces something React cannot render.
      menu: slot({ nenhum: undefined, "kebab (⋮)": kebab }),
      image: { control: false },
      imageFallback: { control: false },
      children: { control: "text" },
    }),
    // `draggable` is a VETO, not a switch: `useDragItem` is inert without a
    // DragContainerProvider AND a `dragId`, so on a standalone tile the toggle
    // could only ever render nothing — flip it to True and no grip appears.
    // Same call as the row's. `Draggable Inside A Container` is where it shows.
    ...hidden("className", "aria-label", "testId", "checkboxTestId", "dragId", "draggable"),
  },
};
export default meta;

type Story = StoryObj<typeof BaseCard>;



/** Title-first card (no image): the fallback icon fills the media region. */
export const TitleWithFallback: Story = {
  args: {
    aspectRatio: "4:3",
    scale: 1,
    title: "Mesa 12",
    subtitle: "4 lugares",
    imageFallback: <TableRestaurantOutlinedIcon sx={{ fontSize: 48, opacity: 0.4 }} />,
    menu: kebab,
    onToggleSelect: () => {},
  },
  render: (args) => (
    <Box sx={{ width: 220 }}>
      <BaseCard {...args} />
    </Box>
  ),
};

/** With a display image. */
export const WithImage: Story = {
  args: {
    aspectRatio: "1:1",
    scale: 1,
    title: "Espresso Duplo",
    subtitle: "R$ 12,00",
    image: <img src="https://placehold.co/300x300?text=☕" alt="" />,
    menu: kebab,
    onToggleSelect: () => {},
  },
  render: (args) => (
    <Box sx={{ width: 220 }}>
      <BaseCard {...args} />
    </Box>
  ),
};

/** mesa-style centered body content via `children` (no image, no caption). */
export const CenteredBody: Story = {
  args: {
    aspectRatio: "4:3",
    scale: 1,
    menu: kebab,
    onToggleSelect: () => {},
    children: (
      <>
        <strong>Mesa 12</strong>
        <Chip label="Livre" size="small" color="success" variant="outlined" />
      </>
    ),
  },
  render: (args) => (
    <Box sx={{ width: 220 }}>
      <BaseCard {...args} />
    </Box>
  ),
};

/** Every aspect ratio at a glance. */
export const AllRatios: Story = {
  render: () => (
    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", maxWidth: 720 }}>
      {(Object.keys(CARD_ASPECT_RATIOS) as CardAspectRatio[]).map((ratio) => (
        <Box key={ratio} sx={{ width: 160 }}>
          <BaseCard
            aspectRatio={ratio}
            title={ratio}
            imageFallback={<Box sx={{ fontSize: 24 }}>{ratio}</Box>}
            onToggleSelect={() => {}}
          />
        </Box>
      ))}
    </Box>
  ),
};

/** Selected + dimmed states. */
export const States: Story = {
  render: () => (
    <Box sx={{ display: "flex", gap: 2 }}>
      <Box sx={{ width: 180 }}>
        <BaseCard aspectRatio="4:3" title="Selecionada" selected onToggleSelect={() => {}} />
      </Box>
      <Box sx={{ width: 180 }}>
        <BaseCard aspectRatio="4:3" title="Desativada" dimmed onToggleSelect={() => {}} />
      </Box>
    </Box>
  ),
};

/**
 * THE GRIP, which no toggle on a standalone tile can produce.
 *
 * `draggable` only ever vetoes: a tile needs a `dragId` AND an enclosing
 * DragContainerProvider before `useDragItem` returns anything, because a handle
 * that does nothing is worse than no handle at all. Here both exist, so the grip
 * renders — bottom-left, opposite the menu and clear of the checkbox.
 */
export const DraggableInsideAContainer: Story = {
  render: () => {
    const [order, setOrder] = useState(["Mesa 12", "Mesa 14", "Mesa 16"]);
    const [active, setActive] = useState<string | number | null>(null);
    const move = (from: string, to: string): void =>
      setOrder((prev) => {
        const next = prev.filter((id) => id !== from);
        next.splice(prev.indexOf(to), 0, from);
        return next;
      });
    return (
      <DragContainerProvider
        value={{
          activeId: active,
          handleProps: (id) => ({
            draggable: true,
            onDragStart: (event: React.DragEvent) => {
              event.dataTransfer.setData("text/plain", String(id));
              setActive(id);
            },
            onDragEnd: () => setActive(null),
          }),
          itemProps: (id) => ({
            onDragOver: (event: React.DragEvent) => event.preventDefault(),
            onDrop: (event: React.DragEvent) => {
              event.preventDefault();
              move(event.dataTransfer.getData("text/plain"), String(id));
              setActive(null);
            },
          }),
        }}
      >
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {order.map((id) => (
            <Box key={id} sx={{ width: 180 }}>
              <BaseCard
                dragId={id}
                aspectRatio="4:3"
                title={id}
                subtitle="4 lugares"
                imageFallback={<TableRestaurantOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />}
                menu={kebab}
                onToggleSelect={() => {}}
              />
            </Box>
          ))}
        </Box>
      </DragContainerProvider>
    );
  },
};
