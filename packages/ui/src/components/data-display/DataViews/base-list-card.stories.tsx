import MoreVertIcon from "@mui/icons-material/MoreVert";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { InputType } from "storybook/internal/types";

import { Button } from "../../form/Button";
import { DropdownMenu } from "../../navigation/DropdownMenu";
import { Box } from "../../../mui/Box";

import { BaseListCard, type BaseListCardProps } from "./base-list-card";
import { DragContainerProvider } from "./data-views-drag";
import { ListCardGroup } from "./list-card-rails";

/**
 * BaseListCard is BaseCard's horizontal sibling: the full-width row the "Lista"
 * layout wanted and never had. A marker, a title over a subtitle, labelled
 * middle columns, a value, inline actions and a menu.
 *
 * It answers its OWN width with a container query, not the viewport — the same
 * row renders full-bleed on a phone, inside a 300px board column, and beside an
 * open filter panel, which are three different widths at one viewport size.
 * Resize the Storybook canvas (or the wrappers below) to watch it collapse.
 */
/**
 * Tag a block of controls with one table category, keeping the block's own
 * order. Categories are how the table gets a running order at all — Storybook
 * merges the inferred prop list with these, and the inferred list is in
 * declaration order, which is the order the props were CONVENIENT TO WRITE
 * rather than the order anybody reads them in.
 */
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

const kebab = (
  <DropdownMenu
    size="sm"
    items={[
      { id: "edit", label: "Editar", onClick: () => {} },
      { id: "delete", label: "Excluir", color: "error", onClick: () => {} },
    ]}
    trigger={
      // `icon` and no children, which is what makes `Button` render it square
      // rather than in MUI's 64px slab. No local `sx` — the size is the
      // component's now, so every overflow menu in the library matches.
      //
      // `lg`, not `sm`, so the row's two ends are the same control. Icon-only
      // sizing is glyph + 2x padding: `lg` is 20px in 9px, which is exactly how
      // MUI builds its small Checkbox (20px glyph, 9px hit padding, 38px box).
      // At `sm` the kebab came out 28px against the checkbox's 38 — centred on
      // the same line, but visibly the lighter of the two.
      <Button variant="text" size="lg" aria-label="Ações" icon={<MoreVertIcon sx={{ fontSize: 20 }} />} />
    }
  />
);

const marker = <ReceiptLongOutlinedIcon sx={{ fontSize: 22, color: "text.disabled" }} />;

/**
 * WHAT A REACTNODE SLOT CAN OFFER A CONTROL.
 *
 * A `ReactNode` has no widget: Storybook's object editor shows it as
 * `$$typeof: Symbol(react.transitional.element)` and anything typed into that
 * blob produces an element React cannot render. So each slot names a few REAL
 * nodes and the control picks between them — `options` for the labels, `mapping`
 * for the values. That is an editable slot without a JSON trap in it.
 */
function slot(mapping: Record<string, unknown>): InputType {
  return { control: "select", options: Object.keys(mapping), mapping };
}

/**
 * `leading` takes ANY node — the slot is "a marker", not "an icon", and the row
 * never inspects what it was given. The control offered only a receipt glyph,
 * which made a generic slot read as a pedidos-only one, so it now names the
 * three kinds of marker a list actually uses: an icon, an avatar with initials,
 * and a square thumbnail.
 */
const avatar = (
  <Box
    sx={{
      width: 28,
      height: 28,
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      fontWeight: 700,
      color: "primary.contrastText",
      bgcolor: "primary.light",
    }}
  >
    LG
  </Box>
);

const thumbnail = (
  <Box sx={{ width: 28, height: 28, borderRadius: 1, bgcolor: "action.selected" }} />
);

const LEADING = {
  nenhum: undefined,
  ícone: marker,
  avatar,
  miniatura: thumbnail,
};
const MENU = { nenhum: undefined, "kebab (⋮)": kebab };
const ACTIONS = {
  nenhuma: undefined,
  Ver: <Button variant="outline" size="sm">Ver</Button>,
  "Ver + Imprimir": (
    <>
      <Button variant="outline" size="sm">Ver</Button>
      <Button variant="text" size="sm">Imprimir</Button>
    </>
  ),
};

const meta: Meta<typeof BaseListCard> = {
  title: "Cards/BaseListCard",
  component: BaseListCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  /**
   * EVERY VALUE HERE IS THE COMPONENT'S OWN DEFAULT, so no story renders any
   * differently for their presence. They are declared for their ORDER.
   *
   * Storybook builds the table by merging the story's args over the props it
   * inferred from the type, and a category's section is created where its FIRST
   * member lands. Args are merged first, so these seven keys open the Layout and
   * Appearance sections before anything inferred can open one of its own —
   * which is the whole reason the table no longer opens on `leading`.
   *
   * Reordering or removing them silently reshuffles the docs. `sort` in
   * `parameters.controls` cannot fix it: it orders rows WITHIN a section and
   * never the sections themselves.
   */
  args: {
    density: "cozy",
    scale: 1,
    divider: false,
    variant: "outline",
    color: "primary",
    emphasis: "none",
    state: "default",
  },
  argTypes: {
    // ORDERED BY WHAT SOMEBODY WOULD ACTUALLY REACH FOR.
    //
    // Left alone, the table opens on `leading`, `meta` and `menu` —
    // a React element rendered as `$$typeof: Symbol(react.transitional.element)`
    // and an array of objects behind a raw JSON editor. Nobody tunes a row by
    // hand-editing that blob, so the knobs that DO change what you see were
    // below the fold, under four controls that cannot be used.
    //
    // So: the things that reshape the row first, then how it is painted, then
    // its text, then what it does. Composition slots keep their documentation
    // but lose their useless widgets, and the plumbing leaves the table.
    ...category("Layout", {
      density: { control: "inline-radio", options: ["compact", "cozy", "comfortable"] },
      scale: { control: { type: "range", min: 0.5, max: 1.6, step: 0.05 } },
      divider: { control: "boolean" },
      selectable: { control: "boolean" },
      selected: { control: "boolean" },
      // The chevron is not its own switch — it is a consequence of `children`.
      // Clear the body and the control disappears with it, which is the rule
      // worth being able to try from the panel rather than read about.
      defaultExpanded: { control: "boolean" },
      children: { control: "boolean", mapping: { true: <OrderDetail />, false: undefined } },
      // NO CONTROL FOR `expanded`. It is the CONTROLLED-mode prop: setting it
      // hands the state to a list that then has to feed it back through
      // `onExpandedChange`. From the panel there is no such owner, so a value
      // set here freezes the row open or shut and the chevron stops working —
      // which reads as a broken component rather than as controlled mode doing
      // exactly what it says. `ControlledAccordion` is where that path is shown.
      expanded: { control: false, table: { disable: true } },
      onExpandedChange: { control: false, table: { disable: true } },
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
      value: { control: "text" },
    }),
    ...category("Behaviour", {
      draggable: { control: "boolean" },
      href: { control: "text" },
      target: { control: "text" },
      onClick: { control: false },
      onToggleSelect: { control: false },
    }),
    ...category("Slots", {
      // Pick between real nodes rather than editing an element blob.
      leading: slot(LEADING),
      menu: slot(MENU),
      actions: slot(ACTIONS),
      // These two ARE directly editable: an array of label/value pairs is
      // exactly what the object editor is good at, and a bare string is a
      // perfectly good `ReactNode`.
      meta: { control: "object" },
      metaSlot: { control: "text" },
      children: { control: "text" },
    }),
    // LAST, and grouped. `row` and `cells` are the configured-list API: neither
    // does anything to a card using the named slots, and left ungrouped they
    // floated to the TOP of the panel — above `density` and `scale` — where the
    // first two controls a reader meets are the two that do nothing here.
    ...category("Configured cells", {
      cells: { control: "object" },
      row: { control: "object" },
    }),
    // `actionsAlwaysVisible` joins them: it only reveals INLINE actions, and the
    // primary row carries an overflow menu instead — so as a control here it is
    // a switch wired to nothing. The `Actions` story is where it has something
    // to act on, and where its behaviour is explained.
    ...hidden(
      "className",
      "aria-label",
      "testId",
      "dragId",
      "onContextMenu",
      "actionsAlwaysVisible",
    ),
  },
};
export default meta;

type Story = StoryObj<typeof BaseListCard>;

/**
 * EVERY STORY'S CARD GOES THROUGH HERE, so the controls panel drives all of
 * them and not just the one args-driven playground.
 *
 * A story that writes `<StoryRow args={args} title="…" />` inside `render` ignores args
 * completely: Storybook still shows the full control table, every knob is inert,
 * and a reader who moves `density` and sees nothing happen concludes the
 * COMPONENT is broken rather than the story. That was true of most of the
 * stories in this file.
 *
 * ARGS FIRST, THEN THE STORY'S OWN PROPS. The panel supplies the shared knobs —
 * density, scale, variant, colour, state — while whatever a story hardcodes is
 * the thing that story exists to demonstrate, and must not be overridable from
 * the panel or the demonstration quietly stops being one. So `Selection` keeps
 * its selected row and still answers the density slider.
 */
function StoryRow({
  args,
  ...own
}: { args: Partial<BaseListCardProps> } & Partial<BaseListCardProps>): React.JSX.Element {
  // THE CONTROLLED PAIR NEVER COMES FROM THE PANEL. Storybook's actions addon
  // supplies an `onExpandedChange` mock for any `on*` prop, and a persisted
  // `expanded` arg then satisfies the card's controlled check — so the row would
  // hand its state to a handler that records the call and changes nothing, and
  // the chevron would stop collapsing. `ControlledAccordion` passes the real
  // pair itself, through `own`, and is unaffected.
  const panel = { ...args };
  delete panel.expanded;
  delete panel.onExpandedChange;
  return <BaseListCard {...panel} {...own} />;
}




/**
 * The row the Pedidos list draws, as the primitive rather than by hand.
 *
 * The autodocs table is built from THIS story, so the key order below carries on
 * where `meta.args` left off: content, then behaviour, then the slots. See the
 * note on `meta.args`.
 */
export const Pedido: Story = {
  /**
   * A REAL container, so `draggable` is a real switch.
   *
   * The grip is not the card's to conjure: `useDragItem` returns the inert
   * answer with no container above it, deliberately, because a handle that
   * cannot drag anything is worse than no handle at all. So rather than fake
   * one for the control's benefit, this story provides the seam — the same
   * native HTML5 wiring `DraggableInsideAContainer` uses — and the toggle then
   * exercises what `draggable` actually means: the CARD'S VETO over a decision
   * the container has already made.
   */
  decorators: [
    (Story) => (
      <DragContainerProvider
        value={{
          handleProps: (id) => ({
            draggable: true,
            onDragStart: (event: React.DragEvent) =>
              event.dataTransfer.setData("text/plain", String(id)),
          }),
          itemProps: () => ({ onDragOver: (event: React.DragEvent) => event.preventDefault() }),
        }}
      >
        <Story />
      </DragContainerProvider>
    ),
  ],
  args: {
    dragId: "B75A6858",
    title: "B75A6858",
    subtitle: "Luiz Gustavo",
    value: "R$ 13,90",
    onClick: () => {},
    onToggleSelect: () => {},
    leading: marker,
    meta: [
      { label: "Data", value: "05/08/2026, 13:45" },
      { label: "Método", value: "PIX" },
    ],
    // ONE overflow, no inline buttons. A row offering `Ver` beside a kebab that
    // also opens `Editar`/`Excluir` asks the same question twice; see the
    // `Actions` story for the case where a host does want both (and where
    // `actionsAlwaysVisible` has something to act on).
    menu: kebab,
    // A BODY, so the playground has a chevron. Toggle `children` off in the
    // panel and both the control and its rail leave the row — a chevron that
    // opens onto nothing is a promise the row cannot keep.
    children: <OrderDetail />,
    // Closed to begin with. The chevron is the affordance under test, and a row
    // that starts open shows its result without ever showing the control work.
    defaultExpanded: false,
    testId: "pedido-row",
  },
};

/**
 * SELECTABLE. `onToggleSelect` is what puts the checkbox there at all — omit it
 * and the row is not selectable, rather than selectable-but-unclickable, which
 * is what every hand-rolled row shipped: a background tint for `selected` and
 * no control to set it.
 */
export const Selection: Story = {
  render: (args) => {
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
          <StoryRow
          args={args}
            key={id}
            leading={marker}
            title={id}
            subtitle="Luiz Gustavo"
            meta={[{ label: "Data", value: "05/08/2026" }]}
            value="R$ 13,90"
            selected={picked.has(id)}
            onToggleSelect={() => toggle(id)}
            testId={`pick-${id}`}
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
  render: (args) => {
    const [log, setLog] = useState<string[]>([]);
    const note = (what: string): void => setLog((prev) => [what, ...prev].slice(0, 4));
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 900 }}>
        <StoryRow
          args={args}
          leading={marker}
          title="B75A6858"
          subtitle="Luiz Gustavo"
          value="R$ 13,90"
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
  render: (args) => {
    const [order, setOrder] = useState(["B75A6858", "1D970689", "0112CF89", "89E40634"]);
    const [active, setActive] = useState<string | number | null>(null);
    // WHERE IT WOULD LAND, computed from the pointer against the row it is over:
    // past the midpoint means after, otherwise before. The container owns this
    // because only it knows the geometry — the card being hovered cannot see
    // where the pointer is relative to its neighbours.
    const [drop, setDrop] = useState<{ id: string | number; edge: "before" | "after" } | null>(null);
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
            onDragEnd: () => {
              setActive(null);
              setDrop(null);
            },
          }),
          dropIndicator: drop,
          itemProps: (id) => ({
            onDragOver: (event: React.DragEvent) => {
              event.preventDefault();
              const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
              const edge = event.clientY > box.top + box.height / 2 ? "after" : "before";
              setDrop((prev) =>
                prev?.id === id && prev.edge === edge ? prev : { id, edge },
              );
            },
            // Not `onDragLeave`: it fires as the pointer crosses INTO a child of
            // the same row, so the marker would strobe off and on across every
            // cell. The list clears it once, when the drag ends.
            onDrop: (event: React.DragEvent) => {
              event.preventDefault();
              move(event.dataTransfer.getData("text/plain"), String(id));
              setActive(null);
              setDrop(null);
            },
          }),
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 900 }}>
          {order.map((id) => (
            <StoryRow
          args={args}
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
 * columns go; below ~360px the value drops to its own line rather
 * than squeezing the title to two characters.
 */
export const RespondsToItsOwnWidth: Story = {
  render: (args) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {[900, 480, 320].map((width) => (
        <Box key={width}>
          <Box sx={{ mb: 0.5, fontSize: "0.75rem", color: "text.secondary" }}>{width}px</Box>
          <Box sx={{ width }}>
            <StoryRow
          args={args}
              leading={marker}
              title="B75A6858"
              subtitle="Luiz Gustavo"
              meta={[
                { label: "Data", value: "05/08/2026, 13:45" },
                { label: "Método", value: "PIX" },
              ]}
              value="R$ 13,90"
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
export const Divider: Story = {
  render: (args) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 900 }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ fontSize: "0.75rem", color: "text.secondary" }}>outlined + gap (default)</Box>
        {["B75A6858", "1D970689"].map((id) => (
          <StoryRow args={args} key={id} leading={marker} title={id} value="R$ 13,90" onToggleSelect={() => {}} />
        ))}
      </Box>
      <Box>
        <Box sx={{ fontSize: "0.75rem", color: "text.secondary", mb: 1 }}>divider, no gap</Box>
        {["B75A6858", "1D970689"].map((id) => (
          <StoryRow args={args} key={id} divider leading={marker} title={id} value="R$ 13,90" onToggleSelect={() => {}} />
        ))}
      </Box>
    </Box>
  ),
};

/**
 * DENSITY — the same three values the Exibição panel offers, so a list answers
 * the operator's preference directly instead of the host translating it into a
 * number.
 *
 * Vertical only: a full-width row cannot get narrower, so height is the one
 * thing density has left to spend — and the horizontal padding has to keep the
 * row's contents lined up with the toolbar above it at every setting.
 */
export const Density: Story = {
  render: (args) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 900 }}>
      {(["compact", "cozy", "comfortable"] as const).map((density) => (
        <Box key={density}>
          <Box sx={{ mb: 0.5, fontSize: "0.75rem", color: "text.secondary" }}>{density}</Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {["B75A6858", "1D970689", "0112CF89"].map((id) => (
              <StoryRow
          args={args}
                key={id}
                density={density}
                testId={`row-${density}`}
                leading={marker}
                title={id}
                subtitle="Luiz Gustavo"
                meta={[{ label: "Data", value: "05/08/2026, 13:45" }]}
                value="R$ 13,90"
                menu={kebab}
                onToggleSelect={() => {}}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  ),
};

/**
 * VARIANTS — Button's vocabulary, not Chip's. A chip is a token in a sentence
 * and has only filled/outlined to say; a card is a surface in a stack, and the
 * question is how much chrome it claims.
 */
/**
 * EVERY VARIANT AGAINST EVERY MODIFIER, one row per variant.
 *
 * The point is the COLUMNS: read down one and you are comparing the same
 * modifier across four surfaces, which is the only way to see that `divider`
 * now composes rather than flattening all four into the same flush row.
 *
 * Cards are 200px and carry a title only. Anything more and six of them do not
 * fit side by side, and the comparison stops being side-by-side — which is the
 * whole experiment.
 *
 * `emphasis` has no `disabled`: its values are `none | attention | new`, and
 * `disabled` belongs to `state`. Both are shown, so the matrix covers what was
 * asked for under the names the component actually uses.
 */
const VARIANT_CASES = [
  { suffix: "", props: {} },
  { suffix: " + divider", props: { divider: true } },
  { suffix: " + emphasis attention", props: { emphasis: "attention" as const } },
  // `emphasis` has no `disabled` — its values are none | attention | new, and
  // `disabled` belongs to `state`. `new` is the third emphasis, shown here under
  // the label the matrix was asked for so the row is not silently missing a case.
  { suffix: " + emphasis new", props: { emphasis: "new" as const } },
  { suffix: " + state canceled", props: { state: "cancelled" as const } },
  { suffix: " + state disabled", props: { state: "disabled" as const } },
];

export const Variants: Story = {
  render: (args) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {(["outline", "ghost", "text", "glass"] as const).map((variant) => (
        <Box key={variant}>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}>
            {VARIANT_CASES.map((testCase) => (
              <Box key={testCase.suffix} sx={{ width: 200 }}>
                <Box sx={{ mb: 0.5, fontSize: "0.6875rem", color: "text.disabled" }}>
                  {`${variant}${testCase.suffix}`}
                </Box>
                <StoryRow args={args} variant={variant} title={variant} {...testCase.props} />
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  ),
};

/**
 * SELECTABLE is the capability, separate from the handler: it puts the checkbox
 * there AND turns on the selected treatment. `selectable={false}` has neither,
 * however `selected` is set — so a stale flag arriving with the data cannot
 * make a read-only row look picked.
 */
export const Selectable: Story = {
  render: (args) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 900 }}>
      <StoryRow args={args} title="selectable, selected" selected onToggleSelect={() => {}} value="R$ 13,90" />
      <StoryRow args={args} title="selectable, not selected" onToggleSelect={() => {}} value="R$ 2,98" />
      <StoryRow
          args={args}
        title="selectable={false} — and `selected` is ignored"
        selectable={false}
        selected
        onToggleSelect={() => {}}
        value="R$ 5,90"
      />
    </Box>
  ),
};

/**
 * EFFECTS, borrowed from Button so a glowing card and a glowing button are the
 * same feature. `pulse` throws its ring from a pseudo-element BEHIND the card:
 * a card that grew and shrank would reflow every neighbour on each beat.
 */
export const EmphasisAndState: Story = {
  render: (args) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 900, p: 2 }}>
      {(
        [
          ["emphasis: attention", { emphasis: "attention" }],
          ["emphasis: new", { emphasis: "new" }],
          ["variant: glass", { variant: "glass" }],
          ["state: cancelled", { state: "cancelled" }],
        ] as const
      ).map(([name, effect]) => (
        <Box key={name}>
          <Box sx={{ mb: 0.5, fontSize: "0.75rem", color: "text.secondary" }}>{name}</Box>
          <StoryRow
          args={args}
            {...effect}
            color="primary"
            leading={marker}
            title="B75A6858"
            value="R$ 13,90"
            onToggleSelect={() => {}}
          />
        </Box>
      ))}
    </Box>
  ),
};

/**
 * THE LIST OWNS THE COLUMNS.
 *
 * Inside a {@link ListCardGroup} every row is `grid-template-columns: subgrid`
 * over one shared set of rails, so the value sits on a fixed edge and the cells
 * chip has a slot of its own. Note the amounts: they line up down the page even
 * though `Em aberto`, `Pago` and `Cancelado` are three different widths — which
 * is exactly what the old per-row flex could not do, since a wider chip shoved
 * the money left on that row alone.
 *
 * `tabular-nums` on the value and the meta figures is the other half: digits of
 * equal width are what make a column of money scannable rather than merely
 * aligned at one edge.
 */
export const SharedRails: Story = {
  render: (args) => (
    <ListCardGroup density="cozy" dataTestId="rails-group">
      {[
        ["B75A6858", "R$ 13,90"],
        ["1D970689", "R$ 2,98"],
        ["0112CF89", "R$ 1.250,00"],
        ["89E40634", "R$ 8,90"],
      ].map(([id, amount]) => (
        <StoryRow
          args={args}
          key={id}
          testId={`rail-${id}`}
          leading={marker}
          title={id}
          subtitle="Luiz Gustavo"
          meta={[
            { label: "Data", value: "05/08/2026, 13:45" },
            { label: "Método", value: "PIX" },
          ]}
          value={amount}
          menu={kebab}
          onToggleSelect={() => {}}
        />
      ))}
    </ListCardGroup>
  ),
};

/**
 * `href` rather than `onClick`.
 *
 * The title is a real `<a>` stretched over the row by a pseudo-element, so the
 * whole row is the target while remaining cmd-clickable, middle-clickable and
 * "copy link address"-able — and the checkbox and menu stay ordinary buttons
 * rather than interactive elements nested inside a clickable div.
 */
export const LinkedRow: Story = {
  args: {
    href: "https://example.com/pedidos/B75A6858",
    target: "_blank",
    testId: "linked-row",
    leading: marker,
    title: "B75A6858",
    subtitle: "cmd-click / middle-click me",
    value: "R$ 13,90",
    menu: kebab,
    onToggleSelect: () => {},
  },
};

/** Selected, dimmed, and a row with no controls at all. */
export const States: Story = {
  render: (args) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 900 }}>
      <StoryRow args={args} title="Selecionada" value="R$ 13,90" selected onToggleSelect={() => {}} />
      <StoryRow args={args} title="Cancelada" value="R$ 8,90" state="cancelled" onToggleSelect={() => {}} />
      <StoryRow args={args} title="Somente leitura" subtitle="sem checkbox, sem menu" value="R$ 5,90" />
    </Box>
  ),
};

/**
 * The expanded body a consumer might build: line items on the left, a totals
 * ledger on the right, then the actions this record affords.
 *
 * None of this shape comes from `BaseListCard`. The card spans the body across
 * every rail and stops there; what is drawn inside is entirely the caller's,
 * which is the point of the slot. A different entity would put something else
 * here and the envelope would not know the difference.
 */
function OrderDetail(): React.JSX.Element {
  const items = [
    { qty: 2, name: "Picanha na chapa", total: "179,80" },
    { qty: 4, name: "Chopp pilsen 500ml", total: "95,60", note: "sem colarinho" },
    { qty: 2, name: "Pudim de leite", total: "57,10" },
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 3 }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {items.map((item) => (
          <Box key={item.name} sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
            <Box component="span" sx={{ color: "text.secondary", fontSize: 13, minWidth: 24 }}>
              {item.qty}×
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ fontSize: 14, fontWeight: 600 }}>{item.name}</Box>
              {item.note && (
                <Box sx={{ fontSize: 12, color: "text.secondary" }}>{item.note}</Box>
              )}
            </Box>
            <Box component="span" sx={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              {item.total}
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <Box component="span" sx={{ color: "text.secondary" }}>Subtotal</Box>
          <Box component="span">332,50</Box>
        </Box>
        <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <Box component="span" sx={{ color: "info.main" }}>Cupom</Box>
          <Box component="span" sx={{ color: "info.main" }}>−20,00</Box>
        </Box>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            fontWeight: 700,
            borderTop: 1,
            borderColor: "divider",
            pt: 0.5,
            mt: 0.5,
          }}
        >
          <Box component="span">Total</Box>
          <Box component="span">R$ 312,50</Box>
        </Box>
        <Box sx={{ display: "flex", gap: 1, mt: 1, justifyContent: "flex-end" }}>
          <Button size="small" variant="outlined">Recuperar</Button>
          <Button size="small" variant="outlined">Ver cliente</Button>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * THE POINT OF THE COMPONENT: a summary that opens onto the record itself.
 *
 * Press the chevron. The row keeps its rails and its columns collapsed, and the
 * detail underneath is free-form — this one is a two-column ledger, but the
 * card imposes nothing and would span anything across the same width.
 */
export const Expandable: Story = {
  // ARGS, not a hardcoded render. A story that builds its own card ignores the
  // controls panel entirely, and a reader who reaches for `density` or `scale`
  // here and sees nothing happen concludes the COMPONENT is broken rather than
  // the story.
  args: {
    leading: <ReceiptLongOutlinedIcon />,
    title: "Ana Paula",
    subtitle: "Mesa 12 · 8 itens",
    meta: [{ label: "Cupom", value: "BEMVINDO10" }],
    value: "R$ 312,50",
    onToggleSelect: () => {},
    children: <OrderDetail />,
  },
};

/** Open on first render, for a list whose detail is the reason you came. */
export const ExpandedByDefault: Story = {
  args: {
    leading: <ReceiptLongOutlinedIcon />,
    title: "Ana Paula",
    subtitle: "Mesa 12 · 8 itens",
    value: "R$ 312,50",
    defaultExpanded: true,
    onToggleSelect: () => {},
    children: <OrderDetail />,
  },
};

/**
 * NO CHILDREN, NO CHEVRON — and standalone, no rail for one either.
 *
 * The two rows below are identical apart from the body. A chevron on the second
 * would be a promise the row cannot keep, so it is simply absent, and a column
 * of chevrons stays a truthful index of which rows have more behind them.
 */
export const ChevronOnlyWhenThereIsMore: Story = {
  render: (args) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <StoryRow
          args={args}
        leading={<ReceiptLongOutlinedIcon />}
        title="Ana Paula"
        subtitle="Mesa 12 · 8 itens"
        value="R$ 312,50"
        onToggleSelect={() => {}}
      >
        <OrderDetail />
      </StoryRow>
      <StoryRow
          args={args}
        leading={<ReceiptLongOutlinedIcon />}
        title="Anônimo"
        subtitle="Balcão · 1 item"
        value="R$ 8,90"
        onToggleSelect={() => {}}
      />
    </Box>
  ),
};

/**
 * A LIST THAT OWNS THE STATE — one row open at a time.
 *
 * Uncontrolled, rows open independently and several can be open at once, which
 * is what comparing two records needs. Pass `expanded` + `onExpandedChange` and
 * the list decides instead; this one enforces an accordion.
 *
 * Inside a `ListCardGroup` the disclose rail is RESERVED on every row, so the
 * captions stay on one edge whether or not a given row has a body.
 */
export const ControlledAccordion: Story = {
  render: function ControlledAccordionStory(args) {
    const [open, setOpen] = useState<string | null>("ana");
    const rows = [
      { id: "ana", title: "Ana Paula", subtitle: "Mesa 12 · 8 itens", value: "R$ 312,50" },
      { id: "thom", title: "Thompson Filgueiras", subtitle: "Mesa 4 · 6 itens", value: "R$ 142,60" },
      { id: "anon", title: "Anônimo", subtitle: "Balcão · 1 item", value: "R$ 8,90" },
    ];
    return (
      <ListCardGroup metaColumns={0}>
        {rows.map((row) => (
          <StoryRow
          args={args}
            key={row.id}
            leading={<ReceiptLongOutlinedIcon />}
            title={row.title}
            subtitle={row.subtitle}
            value={row.value}
            onToggleSelect={() => {}}
            expanded={open === row.id}
            onExpandedChange={(next) => setOpen(next ? row.id : null)}
          >
            <OrderDetail />
          </StoryRow>
        ))}
      </ListCardGroup>
    );
  },
};

/**
 * CELLS DECLARED ONCE BY THE LIST — the shape no row can break.
 *
 * The group holds the config; each card only supplies its `row`. Nothing here
 * lets one card put a column where another has not, which is what makes the
 * alignment structural rather than a convention four rows happen to keep.
 *
 * Note what the config does NOT mean. The second line is not a subtitle: here it
 * is the client under the pedido, the time under the date, and the method under
 * the money — three different pairings, one mechanism, no semantics the config
 * did not put there. A cell wanting one line simply omits `secondary`.
 *
 * The rows carry deliberately uneven content — a long client name, a short one,
 * a missing second line — because even columns are only proven by rows that
 * disagree about how much they have to say.
 */
const PEDIDO_CELLS = [
  {
    id: "pedido",
    primary: (row: Record<string, unknown>) => String(row.shortId),
    secondary: (row: Record<string, unknown>) => String(row.customer),
  },
  {
    id: "quando",
    align: "center" as const,
    primary: (row: Record<string, unknown>) => String(row.date),
    secondary: (row: Record<string, unknown>) => String(row.time),
  },
  {
    id: "total",
    align: "end" as const,
    width: "max-content",
    strong: true,
    primary: (row: Record<string, unknown>) => String(row.total),
    secondary: (row: Record<string, unknown>) => (row.method == null ? null : String(row.method)),
  },
];

const PEDIDO_ROWS = [
  { shortId: "B75A6858", customer: "Luiz Gustavo", date: "05/08/2026", time: "13:45", total: "R$ 13,90", method: "PIX" },
  { shortId: "C91B2210", customer: "Ana Paula Rodrigues de Menezes", date: "05/08/2026", time: "14:02", total: "R$ 312,50", method: "Crédito" },
  { shortId: "D22F7741", customer: "Thom", date: "06/08/2026", time: "09:10", total: "R$ 8,90", method: null },
];

export const ConfiguredCells: Story = {
  render: (args) => (
    <ListCardGroup cells={PEDIDO_CELLS}>
      {PEDIDO_ROWS.map((row) => (
        <StoryRow
          args={args}
          key={String(row.shortId)}
          row={row}
          leading={<ReceiptLongOutlinedIcon />}
          onToggleSelect={() => {}}
          menu={
            <DropdownMenu
              items={[{ id: "open", label: "Abrir" }]}
              trigger={<MoreVertIcon fontSize="small" />}
            />
          }
        >
          <OrderDetail />
        </StoryRow>
      ))}
    </ListCardGroup>
  ),
};

