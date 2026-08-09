# language: en
@editor @panel @layout
Feature: Block configuration panel — placement and modality

  The panel is DOCKED and NON-MODAL. It is not a popup, not a dialog, and not a
  temporary drawer. The canvas stays live while it is open: the user can click a
  chart, switch blocks, change the period, scroll, or drag — without dismissing it.

  This distinction is the whole point of the redesign. The screen it replaces put
  the controls in a floating popover anchored to the block, which covered the very
  thing being configured. A modal drawer would repeat that mistake with different
  geometry: a backdrop that swallows the first click means every adjustment costs
  two clicks and the preview can't be inspected while editing.

  Reference implementation: prototype.html, `.panel` and `#panel`.

  Background:
    Given I am on the report editor at "/reports/r1/edit"
    And the viewport is 1440 x 900
    And the report has 5 blocks

  # ---------------------------------------------------------------- placement

  @desktop
  Scenario: The panel is docked to the right edge, full height
    When I click the block "Receita por dia"
    Then the configuration panel is visible
    And the panel is flush with the right edge of the viewport
    And there is no gap or overlap between the panel and the canvas
    And the panel's top edge sits at the bottom of the app header
    And the panel's bottom edge sits at the bottom of the viewport
    And the panel is 344 px wide
    And the panel has a 1 px left border separating it from the canvas

  @desktop
  Scenario: Opening the panel reflows the canvas rather than covering it
    Given no block is selected
    And I note the width of the canvas
    When I click the block "Receita por dia"
    Then the canvas width is reduced by the width of the panel
    And every block is fully visible, with none clipped by the panel
    And blocks reflow within the narrower 12-column grid
    And no part of any block is underneath the panel

  @desktop
  Scenario: The panel is not a modal
    When I click the block "Receita por dia"
    Then no backdrop or scrim is rendered
    And the page behind the panel is not inert
    And body scrolling is not locked
    And no focus trap is active
    And the panel does not have the role "dialog"

  # ------------------------------------------------- the canvas stays live

  @desktop @regression
  Scenario: Clicking the middle of the screen does not dismiss the panel
    Given the panel is open for "Receita por dia"
    When I click in the middle of the canvas, on the body of another block
    Then the panel remains open
    And the panel now targets the block I clicked
    And the previously selected block loses its selected outline

  @desktop @regression
  Scenario Outline: Canvas and chrome remain operable while the panel is open
    Given the panel is open for "Receita por dia"
    When I <action>
    Then the action takes effect
    And the panel remains open
    And no click is consumed by an overlay

    Examples:
      | action                                            |
      | hover a bar in a chart and read its tooltip       |
      | click the period toggle "7 dias"                  |
      | toggle "Comparar com período anterior"            |
      | scroll the canvas with the wheel                  |
      | drag a block by its handle to a new position      |
      | drag the right edge of a block to resize it       |
      | click "Duplicar" in another block's hover tools   |
      | click "Ajustes" in the header                     |

  @desktop
  Scenario: Clicking the empty canvas background deselects
    Given the panel is open for "Receita por dia"
    When I click the canvas background, outside every block
    Then no block is selected
    And the panel shows its empty state with the text "Selecione um bloco para editar"
    And the panel remains docked and visible

  @desktop
  Scenario: Clicking inside the panel never deselects
    Given the panel is open for "Receita por dia"
    When I click the panel's background, away from any control
    Then the block stays selected
    And the panel stays open

  @desktop
  Scenario: Re-clicking the selected block keeps it selected
    Given the panel is open for "Receita por dia"
    When I click the same block again
    Then it remains selected
    And the panel does not close or reset its scroll position

  # ----------------------------------------------------------- dismissal

  @desktop
  Scenario: Escape closes the panel and returns focus to the block
    Given the panel is open for "Receita por dia"
    And focus is inside the panel
    When I press "Escape"
    Then the panel shows its empty state
    And no block is selected
    And focus is on the block "Receita por dia"

  @desktop
  Scenario: Escape during a drag cancels the drag, not the panel
    Given the panel is open for "Receita por dia"
    And I am mid-drag reordering a block
    When I press "Escape"
    Then the drag is cancelled and the block returns to its original position
    And the panel remains open with the same block selected

  @desktop
  Scenario: The explicit close button
    Given the panel is open for "Receita por dia"
    Then the panel header contains a close button labelled "Fechar painel"
    When I click it
    Then the panel shows its empty state
    And focus returns to the block "Receita por dia"

  @desktop
  Scenario: Removing the selected block empties the panel
    Given the panel is open for "Receita por dia"
    When I remove that block
    Then the panel shows its empty state
    And the panel does not select a neighbouring block on my behalf

  # ------------------------------------------------------------ scrolling

  @desktop
  Scenario: The panel scrolls independently of the canvas
    Given the panel is open for a block whose configuration exceeds the panel height
    When I scroll inside the panel
    Then only the panel content scrolls
    And the canvas scroll position is unchanged
    And the panel header and footer remain fixed within the panel

  @desktop
  Scenario: The panel stays put while the canvas scrolls
    Given the panel is open for "Receita por dia"
    When I scroll the canvas to the last block
    Then the panel remains fixed in place, full height
    And the panel content does not scroll

  @desktop
  Scenario: Switching blocks resets the panel scroll
    Given the panel is open and I have scrolled it to the "Largura" section
    When I select a different block
    Then the panel content scrolls back to the top
    And the panel header shows the new block's spec sentence

  # -------------------------------------------------------- live editing

  @desktop
  Scenario: Edits apply immediately, with no confirm step
    Given the panel is open for "Receita por dia"
    Then the panel has no "Salvar" or "Aplicar" button of its own
    When I change "Visualização" to "Barras"
    Then the block re-renders as a bar chart without further interaction
    And the report is marked as having unsaved changes
    And only the report-level "Salvar" in the header commits to the server

  @desktop
  Scenario: The title field updates the block as I type
    Given the panel is open for "Receita por dia"
    When I type "Faturamento diário" into the "Título" field
    Then the block's heading updates on each keystroke
    And focus stays in the field
    And the caret position is preserved

  @desktop
  Scenario: The spec sentence tracks the configuration
    Given the panel is open for a block reading "soma de receita em pedidos por data (dia), onde status é Pago."
    When I change the aggregation to "Média"
    Then the panel's spec sentence reads "média de receita em pedidos por data (dia), onde status é Pago."
    And the block's subtitle shows the same sentence

  # -------------------------------------------------------- keyboard path

  @desktop @a11y
  Scenario: Selecting a block with the keyboard opens the panel
    Given focus is on the block "Receita por dia"
    When I press "Enter"
    Then the panel opens for that block
    And focus remains on the block
    And the panel is announced politely as "Editando bloco: Receita por dia"

  @desktop @a11y
  Scenario: Tab order runs canvas then panel
    Given the panel is open for the third of five blocks
    When I press "Tab" repeatedly from the canvas
    Then focus moves through the remaining blocks in document order
    And then into the panel's controls in visual order
    And focus is never trapped inside the panel

  # ------------------------------------------------------------ responsive

  @tablet
  Scenario: Between 760 px and 1100 px the panel overlays but stays non-modal
    Given the viewport is 1000 x 800
    When I select a block
    Then the panel is fixed to the right edge, overlaying the canvas
    And the panel casts a shadow to separate it from the content beneath
    And still no backdrop is rendered
    And clicking a block in the visible part of the canvas retargets the panel

  @mobile
  Scenario: Below 760 px the panel becomes a bottom sheet
    Given the viewport is 390 x 844
    When I tap a block
    Then the panel is anchored to the bottom edge, spanning the full width
    And its height is at most 78% of the viewport
    And its top corners are rounded with a grip affordance
    And the selected block remains visible above the sheet

  @mobile
  Scenario: Tapping the visible canvas above the sheet dismisses it
    Given the viewport is 390 x 844
    And the sheet is open for a block
    When I tap the canvas above the sheet
    Then the sheet closes
    And no block is selected

  @mobile
  Scenario: The sheet is dismissible by gesture
    Given the sheet is open
    When I drag the grip downward past 40% of the sheet height
    Then the sheet closes
    But when I drag it downward by less than that and release
    Then the sheet returns to its open position

  # --------------------------------------------- contrast with true modals

  @desktop @regression
  Scenario: The settings drawer IS modal, unlike the configuration panel
    When I click "Ajustes" in the editor header
    Then a drawer opens against the right edge with the role "dialog"
    And a backdrop covers the canvas
    And focus moves into the drawer and is trapped there
    And clicking the backdrop closes the drawer
    And "Escape" closes the drawer
    And focus returns to the "Ajustes" button
    And this behaviour is deliberately different from the configuration panel,
      because settings are a discrete task and block configuration is continuous work
