# SectionNav

A section's own navigation: the handful of screens one kind of work moves
between, drawn as a **bottom bar** on a phone or a **rail** on a wide screen.

It knows no product. The host decides every destination, label, icon, count,
which destination is current, and how links navigate. The component decides
only how they are drawn: the order of the bar's slots, the raised primary
action, the sheets, and the rail's sections.

## When to use it

- A work area a person moves around many times an hour, where a menu behind a
  ☰ costs a tap and a scroll every time.
- Use `Tabs` instead when the screens are views of ONE thing on one page, and
  `NavigationMenu` for a whole app's menu.

## Layouts

| `layout` | draws | menus |
|---|---|---|
| `bar` | a bottom row: the destinations, `more` last, `primary` raised in the middle | open as bottom sheets over the page, stopping above the bar |
| `rail` | a vertical list: `back`, `heading`, a `primary` menu as one button, the destinations, then `more` | `primary` opens as a menu anchored to its button (named by `title`); `more` is listed under its `title` |

Which layout to use is the HOST's call. A bar beside a sidebar is two
navigations competing for one glance, and only the host knows what else is on
screen.

## Props

- **layout**: `'bar' | 'rail'`.
- **label**: the navigation landmark's accessible name.
- **destinations**: `SectionNavDestination[]`, each with `id`, `label`, `icon`,
  `href` OR `onSelect`, `badge?`, `active?`, `disabled?`, `dimmed?`,
  `loading?` and `dataTestId?`.
- **primary**: a `SectionNavMenu` (`label`, `icon`, `title`, `groups`) or a
  `SectionNavAction` (`label`, `icon`, `onSelect`, `disabled?`, `loading?`). In
  the bar it is the raised button. A menu opens its sheet, and the button's name
  becomes `copy.close` while it is open. An action runs on tap and its label is
  drawn under the button.
- **more**: a `SectionNavMenu`. In the bar it is the last slot, and its badge
  is the sum of its entries' badges.
- **back**, **heading**: the rail only.
- **linkComponent**: the element every `href` renders through, for example a
  router adapter taking `href`. It defaults to a plain `<a>`. The adapter must
  pass on `className` (the styling), `onClick` (a sheet entry closes its sheet
  through it), `aria-current` and `data-testid`; one that drops `onClick`
  leaves the sheet open after the navigation.
- **copy**: `SectionNavCopy` (`close`, `badge(count)`), REQUIRED. The component
  carries no words. `PT_BR_SECTION_NAV_COPY` and `EN_US_SECTION_NAV_COPY` are
  named packs; `SECTION_NAV_COPY` is the locale pack.
- **dataTestId**: the prefix for every test id (`section-nav`).

## A bar of verbs

The same bar pins a SCREEN's actions at its foot: give destinations an
`onSelect` instead of an `href`, and `primary` a `SectionNavAction`. A bar of
places and a bar of verbs are one component, so they cannot drift into two
looks one tap apart.

- `disabled` draws the slot dimmed and makes it a native disabled button, even
  when it carries an `href`: a link cannot be disabled, and one that looks
  dimmed but still navigates is a lie. A tap does nothing; `onSelect` is not
  called.
- `dimmed` is for an act the screen cannot do now but should EXPLAIN when
  tapped. It is drawn exactly like `disabled` (the `text.disabled` colour) and
  reports `aria-disabled="true"`, but it is NOT natively disabled: it stays
  focusable, its `onSelect` still fires, and the host answers with a message
  (why not, and what would make it possible). It is never lit.
- `loading` replaces the icon with a spinner and reports `aria-busy` and
  `aria-disabled="true"` until the write it started answers. It stays
  focusable, so the keyboard keeps its place, and a tap is ignored. The same
  holds for a loading action `primary`. Native `disabled` is used only for
  `disabled`.
- `active` on an action slot marks a TOGGLE that is on: it lights the slot and
  reports `aria-pressed="true"` (`false` when `active: false`). Only a link
  reports `aria-current="page"`; an action is not a page.
- A menu entry, and a whole menu, can be `disabled` too. In the bar a disabled
  menu's trigger is inert and opens no sheet. In the rail a disabled `primary`
  is a disabled button, and a disabled `more`, listed rather than behind a
  trigger, has every row inert.
- `dataTestId` on a destination, entry, action or menu replaces the id the nav
  would derive, for a host whose suites already drive their own.

A menu's **groups** carry `entries`. Each entry has an `href` (a link) or an
`onSelect` (an action). `layout: 'grid'` draws three tiles across in the sheet;
`list` (the default) draws one row per entry with its `description`. Choosing
an entry closes the sheet.

## Counts

`badge` is how many things behind a destination wait on the viewer. `0` and
`undefined` draw nothing, because "nothing waiting" and "not known yet" are not
numbers. The count's accessible name is `copy.badge(n)`, and it is quiet
(`aria-live="off"`) because it moves on a poll.

## Docking the bar

Dock the bar at the foot of a flex column. `sectionNavBarInset(theme)` is its
full height, the phone's safe area included. Reserve it at the foot of the
content, so nothing the page floats (a toast, a receipt) lands under the bar.

The bar rises above a modal backdrop only while one of its OWN sheets is open,
so a pointer can close the sheet from the button that opened it. The rest of
the time a dialog the page opens sits above it. The sheet is a modal dialog
named by the menu's `title`: while it is open, focus stays inside it, and
Escape or the sheet's own close button is the way out for a keyboard or a
screen reader.

`aria-current="page"` stays on the destination the viewer is on, sheet open or
not. While a sheet is open only the LOOK moves to its slot (`data-lit`), and
the slot reports the sheet through `aria-expanded`.

## RaisedActionButton

The raised round button on its own, for a host that already draws its own bar:
drop it between two tabs in a flex row. Without `open` it is a plain action.
With `captioned` its label is drawn under it, hidden from assistive tech so
the button is named once. `disabled` is native; `loading` keeps it focusable
with `aria-busy` and `aria-disabled`, and drops the click.
With `open` it reports `aria-expanded`, takes `closeLabel` as its name, and its
icon turns 45° while open.

## Test ids

`<prefix>-dest-<id>`, `<prefix>-primary`, `<prefix>-more`,
`<prefix>-{primary,more}-sheet`, `<prefix>-{primary,more}-sheet-entry-<id>` (bar),
`<prefix>-{primary,more}-entry-<id>` (rail; a `primary` entry exists once its
menu is open), `<prefix>-primary-menu` (the rail's open `primary` menu), and
`<prefix>-back`.
