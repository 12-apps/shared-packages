import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Chip } from "../Chip";
import { Button } from "../../form/Button";
import { DropdownMenu } from "../../navigation/DropdownMenu";
import { Box } from "../../../mui/Box";

import { BaseListCard } from "./base-list-card";
import { DragContainerProvider } from "./data-views-drag";

/**
 * BaseListCard is BaseCard's horizontal sibling: the full-width row the "Lista"
 * layout wanted and never had. A marker, a title over a subtitle, labelled
 * middle columns, a value, a status, inline actions and a menu.
 *
 * It answers its OWN width with a container query, not the viewport — the same
 * row renders full-bleed on a phone, inside a 300px board column, and beside an
 * open filter panel, which are three different widths at one viewport size.
 * Resize the Storybook canvas (or the wrappers below) to watch it collapse.
 */
const meta: Meta<typeof BaseListCard> = {
  title: "DataDisplay/DataViews/BaseListCard",
  component: BaseListCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    scale: { control: { type: "range", min: 0.9, max: 1.6, step: 0.05 } },
    divider: { control: "boolean" },
    selected: { control: "boolean" },
    dimmed: { control: "boolean" },
  },
};
export default meta;

type Story = StoryObj<typeof BaseListCard>;

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

const marker = <ReceiptLongOutlinedIcon sx={{ fontSize: 22, color: "text.disabled" }} />;

/** The row the Pedidos list draws, as the primitive rather than by hand. */
export const Pedido: Story = {
  args: {
    leading: marker,
    title: "B75A6858",
    subtitle: "Luiz Gustavo",
    meta: [
      { label: "Data", value: "05/08/2026, 13:45" },
      { label: "Método", value: "PIX" },
    ],
    value: "R$ 13,90",
    status: <Chip label="Em aberto" size="small" variant="outlined" color="info" />,
    menu: kebab,
    onToggleSelect: () => {},
    onClick: () => {},
    dataTestId: "pedido-row",
  },
};

/**
 * SELECTABLE. `onToggleSelect` is what puts the checkbox there at all — omit it
 * and the row is not selectable, rather than selectable-but-unclickable, which
 * is what every hand-rolled row shipped: a background tint for `selected` and
 * no control to set it.
 */
export const Selection: Story = {
  render: () => {
    const [picked, setPicked] = useState<Set<string>>(new Set(["B75A6858"]));
    const toggle = (id: string): void =>
      setPicked((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 900 }}>
        {["B75A6858", "1D970689", "0112CF89"].map((id) => (
          <BaseListCard
            key={id}
            leading={marker}
            title={id}
            subtitle="Luiz Gustavo"
            meta={[{ label: "Data", value: "05/08/2026" }]}
            value="R$ 13,90"
            selected={picked.has(id)}
            onToggleSelect={() => toggle(id)}
            checkboxTestId={`pick-${id}`}
          />
        ))}
        <Box sx={{ fontSize: "0.8125rem", color: "text.secondary" }}>
          {picked.size} selecionado(s)
        </Box>
      </Box>
    );
  },
};

/**
 * ACTIONS. Inline buttons for what is done often, the kebab for the rest. Both
 * stop propagation, so neither fires the row's own `onClick` — click "Ver" and
 * the row does not also open.
 */
export const Actions: Story = {
  render: () => {
    const [log, setLog] = useState<string[]>([]);
    const note = (what: string): void => setLog((prev) => [what, ...prev].slice(0, 4));
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 900 }}>
        <BaseListCard
          leading={marker}
          title="B75A6858"
          subtitle="Luiz Gustavo"
          value="R$ 13,90"
          status={<Chip label="Pago" size="small" variant="outlined" color="success" />}
          onClick={() => note("abriu a linha")}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => note('clicou "Ver"')}>
                Ver
              </Button>
              <Button variant="text" size="sm" onClick={() => note('clicou "Imprimir"')}>
                Imprimir
              </Button>
            </>
          }
          menu={kebab}
          onToggleSelect={() => {}}
        />
        <Box sx={{ fontSize: "0.8125rem", color: "text.secondary" }}>
          {log.length === 0 ? "nada ainda — experimente a linha e os botões" : log.join(" · ")}
        </Box>
      </Box>
    );
  },
};

/**
 * DRAGGABLE — but only inside a container that says so.
 *
 * The card owns no drag library. A {@link DragContainerProvider} publishes the
 * props (dnd-kit, react-dnd or plain HTML5) and every card inside it grows a
 * grip; outside one, `dragId` is inert and no handle appears. This story wires
 * the native HTML5 API, which is enough to show the seam without adding a
 * dependency to `@12-apps/ui`.
 */
export const DraggableInsideAContainer: Story = {
  render: () => {
    const [order, setOrder] = useState(["B75A6858", "1D970689", "0112CF89", "89E40634"]);
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
          // Handle props only, so text stays selectable and the checkbox still
          // takes a click without the row sliding away.
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
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 900 }}>
          {order.map((id) => (
            <BaseListCard
              key={id}
              dragId={id}
              leading={marker}
              title={id}
              subtitle="arraste pelo punho à esquerda"
              value="R$ 13,90"
              onToggleSelect={() => {}}
              menu={kebab}
            />
          ))}
        </Box>
      </DragContainerProvider>
    );
  },
};

/** The same row with no provider above it: no grip, nothing to drag. */
export const NotDraggableWithoutAContainer: Story = {
  args: {
    dragId: "B75A6858",
    leading: marker,
    title: "B75A6858",
    subtitle: "dragId is set, but there is no container — so no handle",
    value: "R$ 13,90",
    onToggleSelect: () => {},
  },
};

/**
 * The container query, at three widths. Below ~520px the labelled middle
 * columns go; below ~360px the value and status drop to their own line rather
 * than squeezing the title to two characters.
 */
export const RespondsToItsOwnWidth: Story = {
  render: () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {[900, 480, 320].map((width) => (
        <Box key={width}>
          <Box sx={{ mb: 0.5, fontSize: "0.75rem", color: "text.secondary" }}>{width}px</Box>
          <Box sx={{ width }}>
            <BaseListCard
              leading={marker}
              title="B75A6858"
              subtitle="Luiz Gustavo"
              meta={[
                { label: "Data", value: "05/08/2026, 13:45" },
                { label: "Método", value: "PIX" },
              ]}
              value="R$ 13,90"
              status={<Chip label="Em aberto" size="small" variant="outlined" color="info" />}
              menu={kebab}
              onToggleSelect={() => {}}
            />
          </Box>
        </Box>
      ))}
    </Box>
  ),
};

/** Outlined (default) vs `divider`, for a host drawing its own gapless list. */
export const Variants: Story = {
  render: () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 900 }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ fontSize: "0.75rem", color: "text.secondary" }}>outlined + gap (default)</Box>
        {["B75A6858", "1D970689"].map((id) => (
          <BaseListCard key={id} leading={marker} title={id} value="R$ 13,90" onToggleSelect={() => {}} />
        ))}
      </Box>
      <Box>
        <Box sx={{ fontSize: "0.75rem", color: "text.secondary", mb: 1 }}>divider, no gap</Box>
        {["B75A6858", "1D970689"].map((id) => (
          <BaseListCard key={id} divider leading={marker} title={id} value="R$ 13,90" onToggleSelect={() => {}} />
        ))}
      </Box>
    </Box>
  ),
};

/** Selected, dimmed, and a row with no controls at all. */
export const States: Story = {
  render: () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 900 }}>
      <BaseListCard title="Selecionada" value="R$ 13,90" selected onToggleSelect={() => {}} />
      <BaseListCard title="Cancelada" value="R$ 8,90" dimmed onToggleSelect={() => {}} />
      <BaseListCard title="Somente leitura" subtitle="sem checkbox, sem menu" value="R$ 5,90" />
    </Box>
  ),
};
