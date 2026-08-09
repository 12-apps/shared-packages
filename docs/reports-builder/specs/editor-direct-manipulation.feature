# language: en
@editor @direct-manipulation
Feature: Reordering and resizing blocks by direct manipulation

  Both gestures start from a dedicated handle, show where they will land before
  they commit, cancel on Escape, and have a keyboard equivalent that announces
  itself. Neither may be the only way to perform the action.

  Reference implementation: prototype.html, `startDrag`/`place`/`endDrag` and
  `startResize`/`paintResize`/`endResize`. Constants there are deliberate.
  Implementation decision: decisions/0001-drag-implementation.md.

  Background:
    Given I am on the report editor at "/reports/r1/edit"
    And the viewport is 1440 x 900
    And the report has 5 blocks in the order:
      | 1 | Receita no período      | 1/3 |
      | 2 | Ticket médio            | 1/3 |
      | 3 | Pedidos pagos           | 1/3 |
      | 4 | Receita por dia         | 2/3 |
      | 5 | Produtos mais vendidos  | 1/3 |

  # =============================================================== REORDER

  @drag
  Scenario: The drag starts from the handle only
    When I press the pointer down on the body of a block and move 40 px
    Then no drag begins
    And the block is selected as a normal click would
    When I press the pointer down on that block's grip and move 40 px
    Then a drag begins

  @drag
  Scenario: What the canvas looks like mid-drag
    When I begin dragging "Receita por dia" by its grip
    Then a ghost of the block follows the pointer
    And the ghost is capped at 280 px tall, slightly rotated, with a shadow
    And the source block stays in place at about 32% opacity
    And the cursor is "grabbing" for the whole document
    And every block's hover tools and grips are hidden while dragging
    And text selection is suppressed

  @drag
  Scenario: The insertion indicator says where it will land
    Given I am dragging "Produtos mais vendidos"
    When the pointer is within the vertical bounds of "Ticket médio"
    Then a 3 px vertical indicator is drawn beside "Ticket médio"
    And it is drawn on the left if the pointer is left of that block's centre, otherwise on the right
    And it spans the full height of that block
    When the pointer is above or below every block in that row
    Then the indicator is drawn horizontally, spanning the width of the nearest block

  @drag
  Scenario: The drop target is the nearest block centre, with y weighted
    Given I am dragging a block
    When the pointer sits between two blocks
    Then the target is the block whose centre is nearest
    And vertical distance is weighted 1.4 times horizontal distance
    # so a pointer aimed above a row does not get captured by a side-by-side neighbour

  @drag
  Scenario: Dropping commits the new order
    When I drag "Produtos mais vendidos" and drop it before "Receita no período"
    Then it becomes the first block
    And the other blocks shift down by one position
    And the report is marked as having unsaved changes
    And a toast reads "“Produtos mais vendidos” movido para a posição 1."
    And the block keeps focus

  @drag
  Scenario: A drop in the same place is not a change
    When I drag a block and drop it exactly where it started
    Then the order is unchanged
    And the report is NOT marked as having unsaved changes
    And no toast appears

  @drag
  Scenario: The click that follows a drop is suppressed
    When I finish a drag over another block
    Then that block does not become selected as a side effect
    And no tool button under the pointer is activated

  @drag
  Scenario: Escape cancels
    Given I am dragging "Receita por dia"
    When I press "Escape"
    Then the ghost and indicator disappear
    And the block returns to its original position
    And the report's unsaved state is unchanged

  @drag
  Scenario: Dragging near a viewport edge scrolls the canvas
    Given the report has more blocks than fit on screen
    When I drag a block to within 110 px of the top or bottom of the viewport
    Then the canvas scrolls in that direction, faster the closer the pointer gets
    And the indicator keeps updating while it scrolls
    And scrolling stops when the pointer moves away or the drag ends

  @drag @a11y
  Scenario Outline: Keyboard reordering
    Given focus is on the block "<block>" at position <from>
    When I press "<keys>"
    Then it moves to position <to>
    And focus stays on it
    And the live region announces "<block> movido para a posição <to> de 5"
    And the report is marked as having unsaved changes

    Examples:
      | block           | from | keys       | to |
      | Receita por dia | 4    | Alt+Up     | 3  |
      | Receita por dia | 4    | Alt+Down   | 5  |
      | Receita no período | 1 | Alt+Up     | 1  |

  @drag @a11y
  Scenario: Keyboard reorder at the boundaries is a no-op, not an error
    Given focus is on the last block
    When I press "Alt+Down"
    Then nothing moves
    And no announcement is made
    And the report's unsaved state is unchanged

  @drag @mobile
  Scenario: Touch reordering
    Given the viewport is 390 x 844
    When I press and hold a block's grip for 200 ms
    Then a drag begins and the page does not scroll
    And the indicator is horizontal, because blocks are stacked
    And explicit "Mover para cima" / "Mover para baixo" actions are also available
      in the block's menu, because a long drag past sticky chrome is impractical one-handed

  # ================================================================ RESIZE

  @resize
  Scenario: The resize handle
    When I hover a block
    Then a 12 px hit area appears on its right edge, showing a 30 px vertical bar
    And the cursor over it is "col-resize"
    When I hover the handle itself
    Then the bar takes the accent colour and grows to 64 px

  @resize
  Scenario: Widths snap to four steps
    When I drag a block's right edge slowly across the canvas
    Then its width snaps only to 1/3, 1/2, 2/3 and full
    And it never renders at an intermediate width during the drag

  @resize
  Scenario: The width is computed from the live grid
    Then the column width is "(grid width − gap × 11) ÷ 12"
    And the gap is read from the grid's computed style rather than hardcoded,
      because it differs between breakpoints
    And the target span is "round((pointer x − block left + gap) ÷ (column width + gap))", clamped to 1–12, then snapped

  @resize
  Scenario: Feedback during the resize
    Given I am resizing "Receita por dia"
    Then a badge follows the pointer reading the target width, for example "1/2 · 6/12"
    And the block takes an accent border
    And the block's width updates live as I cross each snap point
    And other blocks reflow live around it

  @resize @performance
  Scenario: The chart re-renders once, not continuously
    Given I am resizing a block containing a chart
    Then the block's grid span changes via CSS during the drag
    And the chart is re-rendered only when the pointer is released
    And the chart's height is recomputed for the new width at that point

  @resize
  Scenario: Releasing commits
    When I release after resizing from 1/3 to 2/3
    Then the block is 2/3 wide
    And the report is marked as having unsaved changes
    And the live region announces "Receita por dia: largura 2/3"
    And the panel's width picker shows 2/3 as pressed

  @resize
  Scenario: A resize to the same width is not a change
    When I drag the handle and release without crossing a snap point
    Then the width is unchanged
    And the report is NOT marked as having unsaved changes

  @resize
  Scenario: Escape cancels a resize
    Given I am resizing a block from 1/3 towards full
    When I press "Escape"
    Then the block returns to 1/3
    And the badge disappears
    And the report's unsaved state is unchanged

  @resize @a11y
  Scenario Outline: Keyboard resizing
    Given focus is on a block at width <from>
    When I press "<keys>"
    Then its width becomes <to>
    And the live region announces "Largura <to>"

    Examples:
      | from | keys        | to    |
      | 1/3  | Shift+Right | 1/2   |
      | 1/2  | Shift+Right | 2/3   |
      | 2/3  | Shift+Right | cheia |
      | 1/3  | Shift+Left  | 1/3   |

  @resize @data-integrity
  Scenario: A saved width outside the four steps is preserved
    Given a saved block has a width of 3 columns
    When the editor renders it
    Then it renders at 3 columns
    And the width picker shows no step as pressed
    And the stored width is not rewritten to a neighbouring step
    But when I drag or use the keyboard to change it
    Then it snaps to one of the four steps and that value is stored
    # Snapping is an affordance of the gesture, not a constraint on the schema.

  @resize @mobile
  Scenario: Width is a desktop concern
    Given the viewport is 390 x 844
    Then no resize handle is rendered
    And every block spans the full width
    And each block's stored width is preserved for larger viewports
    And the panel's width picker explains "No celular todo bloco ocupa a largura inteira."
