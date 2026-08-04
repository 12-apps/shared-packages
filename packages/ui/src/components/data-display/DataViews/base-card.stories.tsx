import TableRestaurantOutlinedIcon from "@mui/icons-material/TableRestaurantOutlined";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Chip } from "../Chip";
import { Button } from "../../form/Button";
import { DropdownMenu } from "../../navigation/DropdownMenu";
import { Box } from "../../../mui/Box";

import { BaseCard } from "./base-card";
import { CARD_ASPECT_RATIOS, type CardAspectRatio } from "./data-views-types";

/**
 * BaseCard is the only card in `@12-apps/ui`: a fixed-ratio, selectable tile with an
 * image (or fallback), a title/subtitle caption, a top-right menu slot, and a
 * top-left select checkbox. Domain "kind cards" live in the app and compose it.
 */
const meta: Meta<typeof BaseCard> = {
  title: "DataDisplay/DataViews/BaseCard",
  component: BaseCard,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    aspectRatio: {
      control: "select",
      options: Object.keys(CARD_ASPECT_RATIOS) as CardAspectRatio[],
    },
    scale: { control: { type: "range", min: 0.9, max: 1.6, step: 0.05 } },
  },
};
export default meta;

type Story = StoryObj<typeof BaseCard>;

const kebab = (
  <DropdownMenu
    size="sm"
    items={[
      { id: "edit", label: "Editar", onClick: () => {} },
      { id: "delete", label: "Excluir", color: "error", onClick: () => {} },
    ]}
    trigger={
      <Button variant="text" size="sm" aria-label="Ações">
        ⋮
      </Button>
    }
  />
);

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
