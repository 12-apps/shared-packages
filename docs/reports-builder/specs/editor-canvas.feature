# language: en
@editor @canvas
Feature: Editor canvas — block anatomy, hover and states

  Blocks live in a 12-column grid. Chrome that isn't needed stays hidden until the
  pointer arrives, so the canvas reads as a report rather than as a control panel —
  but nothing may be reachable by hover alone.

  Reference implementation: prototype.html, `.block`, `.block-head`, `.block-tools`.

  Background:
    Given I am on the report editor at "/reports/r1/edit"
    And the viewport is 1440 x 900

  # ------------------------------------------------------------- anatomy

  Scenario: Block anatomy, top to bottom
    Then each block is a card with a 1 px border and a 10 px radius
    And its header row contains, left to right:
      | element     | detail                                          |
      | drag handle | six-dot grip, hidden until hover or selection    |
      | title       | 13.5 px, weight 620                             |
      | spec line   | mono, 10.5 px, muted, ellipsised on overflow     |
      | tools       | duplicate then remove, hidden until hover        |
    And the chart, table or KPI value sits below the header
    And a resize handle sits on the right edge, hidden until hover or selection

  Scenario: The spec line is the block's subtitle
    Then each block shows a machine-generated sentence beneath its title
    And the sentence is truncated with an ellipsis rather than wrapped
    And the full sentence is available in the panel when the block is selected

  # --------------------------------------------------------------- hover

  Scenario: Hovering a block reveals its affordances
    When I hover the block "Receita por dia"
    Then its border darkens by one step
    And the drag handle fades in over 120 ms
    And the duplicate and remove buttons fade in over 120 ms
    And the resize handle appears on the right edge
    And the block does not move, scale or cast a shadow

  Scenario: Hover chrome never shifts layout
    When I hover a block
    Then the position of the title, spec line and chart is unchanged
    And no scrollbar appears or disappears

  Scenario Outline: Hover feedback on block tools
    When I hover the "<tool>" button
    Then it takes a <background> background
    And its tooltip reads "<tooltip>"
    And its hit area is at least 34 x 34 px

    Examples:
      | tool      | background   | tooltip           |
      | duplicate | neutral      | Duplicar bloco    |
      | remove    | pale red     | Remover bloco     |

  Scenario: Chart elements expose values on hover
    When I hover a bar in "Receita por dia"
    Then a tooltip shows the category and the formatted value, for example "15/07: R$ 341,00"
    And the tooltip is also available to assistive technology as an element title

  @a11y
  Scenario: Nothing is reachable by hover alone
    Given I am navigating with the keyboard only
    When a block receives focus
    Then its drag handle, tools and resize handle are all visible
    And each is reachable with "Tab"

  @mobile
  Scenario: Touch has no hover, so chrome is permanent
    Given the viewport is 390 x 844
    Then the drag handle and tools are visible on every block without interaction
    And their hit areas are at least 40 x 40 px
    And the resize handle is not rendered, because every block is full width

  # ----------------------------------------------------------- selection

  Scenario: Selecting a block
    When I click the block "Receita por dia"
    Then it takes an accent border and a 3 px accent ring
    And the configuration panel opens for it
    And exactly one block is selected at a time

  Scenario: Selection survives re-renders
    Given the block "Receita por dia" is selected
    When I change its visualisation to "Barras"
    Then it stays selected after re-rendering
    And it does not scroll out of view

  Scenario: Clicking a tool does not change selection
    Given "Receita por dia" is selected
    When I click the duplicate button on a different block
    Then that block is duplicated
    And the copy becomes selected
    And the copy is inserted directly after its original

  # ---------------------------------------------------------- data states

  Scenario: Loading
    Given a block's query has not resolved
    Then the block shows a skeleton the shape of its eventual content
    And the header, title and spec line are already rendered
    And the skeleton does not collapse the block's height

  Scenario: Empty
    Given a block's query returns no rows
    Then the block reads "Sem dados nesse período."
    And it offers an action to widen the range
    And the block keeps its configured width

  Scenario: Error, isolated to one block
    Given one block's query fails and the others succeed
    Then only that block shows an error card with the reason and a retry action
    And every other block renders normally
    And the report is not replaced by a page-level error

  Scenario: Oversized result
    Given a block's query exceeds the row cap
    Then the block reads "Resultado grande demais — use um filtro ou limite o top N."
    And the message offers to open the panel at the "Mostrar" field

  # -------------------------------------------------------- adding blocks

  Scenario: The add affordance is the last cell of the grid
    Then a dashed full-width area sits after the final block
    And it reads "Adicionar bloco" with a supporting line naming example templates
    When I hover it
    Then its border and text take the accent colour and its background tints

  Scenario: Adding a block scrolls it into view
    When I add a block from the template picker
    Then the new block is appended after the last block
    And it becomes selected
    And it is scrolled to the centre of the viewport
    And a toast confirms "Bloco adicionado."

  # ------------------------------------------------------------ removal

  Scenario: Removal is immediate and undoable
    When I remove the block "Receita por dia"
    Then it disappears without a confirmation dialog
    And a toast reads "“Receita por dia” removido." with a "Desfazer" action
    And the report is marked as having unsaved changes

  Scenario: Undo restores position, not just existence
    Given I removed the third of five blocks
    When I choose "Desfazer"
    Then it returns as the third block
    And it is selected
    And its width and configuration are unchanged

  @a11y
  Scenario: Removal is announced
    When I remove a block
    Then the toast text is announced in the live region
    And the "Desfazer" action is reachable with "Tab"
    And "Cmd+Z" performs the same undo while the toast is visible
