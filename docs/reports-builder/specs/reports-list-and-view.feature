# language: en
@list @view
Feature: Reports list and report viewer

  Two read surfaces. The list answers "which report", the viewer answers "what do
  the numbers say". Neither offers editing controls — the viewer has one "Editar"
  button and nothing else that mutates the report.

  Reference implementation: prototype.html, `#screen-list` and `#screen-view`.

  # ================================================================== LIST

  Background:
    Given I am on the reports list at "/reports"
    And the viewport is 1440 x 900

  Scenario: Page layout, top to bottom
    Then the content is centred in a column at most 1080 px wide
    And the heading "Relatórios" sits above a supporting line
    And below it a filter row contains, left to right:
      | search field           | at most 340 px, magnifier icon inside the left edge |
      | scope filters          | Todos / Meus / Arquivados                            |
      | spacer                 |                                                      |
      | "Novo relatório"       | accent button, right-aligned                         |
    And below that a card grid fills the column, minimum card width 268 px

  Scenario: What a report card shows
    Then each card shows, top to bottom:
      | name              | with a status chip when it is a draft or archived |
      | description       | at most two lines, then ellipsis                  |
      | block preview     | small bars hinting at the report's shape          |
      | footer            | block count · visibility · last edited            |
    And a menu button sits in the top-right corner, hidden until hover or focus

  Scenario: Card hover
    When I hover a card
    Then its border darkens and it takes a soft shadow
    And its menu button fades in
    And the card does not lift, scale or change size

  Scenario: Opening a report
    When I click anywhere on a card except its menu
    Then I go to that report's viewer
    And the period shown is the report's saved default

  Scenario: The card menu does not open the report
    When I click a card's menu button
    Then a menu opens with Editar, Duplicar, Compartilhar link, Arquivar
    And I am not navigated to the report
    And clicking elsewhere closes the menu without navigating

  Scenario Outline: Scope filters
    When I select the scope "<scope>"
    Then only <shown> are listed
    And the scope reads as pressed
    And exactly one scope is active at a time

    Examples:
      | scope       | shown                          |
      | Todos       | all non-archived reports       |
      | Meus        | non-archived reports I own     |
      | Arquivados  | archived reports only          |

  Scenario: Search filters name and description
    When I type "pagamento" into the search field
    Then only reports whose name or description contains it remain
    And filtering happens as I type, with no submit
    And the scope filter still applies

  Scenario: Empty state when nothing matches a search
    When my search matches no report
    Then the grid is replaced by a bordered empty state
    And it reads "Nenhum relatório aqui." with "Tente outro termo."
    And a "Novo relatório" button is offered

  Scenario: Empty state for a store with no reports
    Given the store has no reports
    Then the empty state suggests what a first report contains
    And a "Novo relatório" button is offered

  Scenario: Three ways to create a report
    Then "Novo relatório" appears in the filter row
    And a dashed card sits after the last report in the grid
    And the empty state offers the same action
    When I use any of them
    Then a draft named "Relatório sem título" is created
    And I am taken to the editor with the template picker already open
    And the draft is not visible to other users until it is published

  @mobile
  Scenario: The list on a phone
    Given the viewport is 390 x 844
    Then cards are one per row
    And the filter row scrolls horizontally rather than wrapping
    And card menus are permanently visible

  # ================================================================== VIEW

  Scenario: Viewer layout
    Given I am viewing the report "Vendas do mês"
    Then the header shows a back link to "Relatórios", the report name and its status chip
    And a supporting line gives the description, visibility and last edit
    And "Exportar" and "Editar" sit at the right of the header
    And a toolbar below holds the period control and the comparison switch
    And the toolbar's right side states the resolved date range and freshness

  Scenario: Period control
    Then the period control offers Hoje, 7 dias, 30 dias, Este mês and Personalizado…
    And exactly one is pressed
    And the pressed option has a dark background and light text
    When I choose another period
    Then every block re-queries
    And the resolved range in the toolbar updates
    And the URL carries the period, so the link reproduces this view for anyone who opens it

  Scenario: Comparison
    When "Comparar com período anterior" is on
    Then each KPI shows a delta against the previous period
    And a positive delta is green, a negative one is red
    And the delta is labelled "vs. período anterior" rather than by colour alone

  Scenario: Blocks are read-only here
    Then no block shows a drag handle, resize handle, duplicate or remove control
    And clicking a block does not select it or open a panel
    And each block offers only "ver como tabela" and "CSV", revealed on hover

  @a11y
  Scenario: The table fallback
    When I choose "ver como tabela" on a chart block
    Then the chart is replaced by a table of the same data
    And the toggle stays available to return to the chart
    And the choice applies to that block only, and is not saved to the report

  Scenario: Export
    When I click "Exportar"
    Then I am offered PDF, CSV of every block, and a shareable link
    And the export covers the period currently shown
    And fields I lack permission to see are absent from the export, not blanked

  Scenario: An empty report
    Given the report has no blocks
    Then the viewer shows an empty state reading "Relatório vazio."
    And offers "Editar relatório"

  @mobile
  Scenario: The viewer on a phone
    Given the viewport is 390 x 844
    Then every block spans the full width regardless of its stored width
    And the toolbar scrolls horizontally
    And tapping a chart element pins its tooltip, with a visible way to dismiss it
