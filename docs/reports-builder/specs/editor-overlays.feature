# language: en
@editor @overlays
Feature: Overlays — template picker, settings drawer, toasts

  Three surfaces sit above the canvas, and they are deliberately not alike. The
  template picker and the settings drawer are modal: discrete tasks with a start
  and an end. The toast is transient and never takes focus. The configuration
  panel is neither — see editor-config-panel.feature.

  Reference implementation: prototype.html, `.modal`, `.drawer`, `.toast`.

  Background:
    Given I am on the report editor at "/reports/r1/edit"
    And the viewport is 1440 x 900

  # ---------------------------------------------------- template picker

  @modal
  Scenario: Opening the picker
    When I click "Adicionar bloco"
    Then a modal opens centred horizontally and vertically
    And it is at most 760 px wide and at most 86% of the viewport height
    And a backdrop dims the canvas behind it
    And its header reads "Adicionar bloco" with the line "Comece de um modelo pronto — você ajusta tudo depois."
    And focus moves to the first template
    And focus is trapped within the modal

  @modal
  Scenario: Template groups
    Then templates are grouped under "Vendas", "Movimento", "Pagamentos e perdas" and "Do zero"
    And each template card shows an icon, a name and one line describing what it answers
    And "Bloco em branco" is the last option, not the first

  @modal
  Scenario: Hover on a template
    When I hover a template card
    Then its border takes the accent colour and its background tints
    And the transition runs over 120 ms
    And no card grows or shifts position

  @modal
  Scenario Outline: Dismissing the picker
    Given the picker is open
    When I <action>
    Then the picker closes
    And no block is added
    And focus returns to "Adicionar bloco"

    Examples:
      | action                        |
      | click the backdrop            |
      | press "Escape"                |
      | click the header close button |

  @modal
  Scenario: Choosing a template
    Given the picker is open
    When I click "Receita por dia"
    Then the picker closes
    And a fully configured block is appended to the report
    And it becomes selected and the configuration panel targets it
    And it is scrolled into the centre of the viewport
    And a toast reads "Bloco adicionado."

  @modal @mobile
  Scenario: The picker is a full-width sheet on small screens
    Given the viewport is 390 x 844
    When I open the picker
    Then it is anchored to the bottom edge, spanning the full width
    And its height is at most 88% of the viewport
    And its top corners are rounded
    And templates are laid out one per row

  # ---------------------------------------------------- settings drawer

  @modal
  Scenario: Opening settings
    When I click "Ajustes"
    Then a drawer slides in from the right edge over 200 ms
    And it is at most 420 px wide and spans the full viewport height
    And a backdrop dims the canvas
    And it has the role "dialog" and focus is trapped inside
    And its footer holds a single "Concluir" button spanning the width

  @modal
  Scenario: What settings contains, in order
    Then the drawer contains, top to bottom:
      | Nome                      | text field                                   |
      | Descrição                 | multi-line, with a note that it shows on the list card |
      | Status                    | radio: Publicado / Rascunho                  |
      | Quem pode ver             | radio: Só você / Toda a equipe / Cargos específicos |
      | Período padrão ao abrir   | select                                       |
      | Envio automático          | switch, with a note about the PDF            |
      | Arquivar relatório        | danger zone, bordered and tinted             |
    And nothing in this drawer duplicates a control on the canvas

  @modal
  Scenario: Radio options explain themselves
    Then each radio option shows a bold label and a supporting line
    And the option for "Cargos específicos" notes that cost fields stay hidden
      from users without permission, regardless of who can see the report
    When I hover an unselected option
    Then its border darkens and its background tints
    And the selected option keeps an accent border and tinted background

  @modal
  Scenario Outline: Dismissing settings
    Given the settings drawer is open
    When I <action>
    Then the drawer closes
    And any change I made is retained, because settings apply immediately
    And focus returns to the "Ajustes" button

    Examples:
      | action                |
      | click the backdrop    |
      | press "Escape"        |
      | click "Concluir"      |
      | click the close button|

  @modal
  Scenario: Settings changes reach the header live
    Given the settings drawer is open
    When I change "Status" to "Rascunho"
    Then the chip in the editor header reads "Rascunho" immediately
    And the report is marked as having unsaved changes

  @modal
  Scenario: Archiving asks first
    Given the settings drawer is open
    When I click "Arquivar"
    Then I am asked to confirm, because archiving removes the report from the list
    And on confirming I am returned to the reports list
    And a toast reads "Relatório arquivado." with a "Desfazer" action

  @modal @mobile
  Scenario: Settings is full screen on small viewports
    Given the viewport is 390 x 844
    When I open "Ajustes"
    Then the drawer spans the full width and height
    And its close affordance is reachable without scrolling

  # ----------------------------------------------------------- toasts

  @toast
  Scenario: Toast placement and lifetime
    When an action produces a toast
    Then it appears centred horizontally, 20 px from the bottom edge
    And it slides up over 220 ms
    And it dismisses itself after 6 seconds
    And it never takes focus away from where I am working

  @toast
  Scenario: Only one toast at a time
    Given a toast is visible
    When another action produces a toast
    Then the first is replaced rather than stacked
    And the 6 second timer restarts

  @toast @a11y
  Scenario: Toasts are announced and actionable
    When a toast with a "Desfazer" action appears
    Then its text is written to the polite live region
    And "Desfazer" is reachable with "Tab"
    And "Cmd+Z" performs the same undo while the toast is visible
    And dismissing the toast does not remove the ability to undo by keyboard for those 6 seconds

  @toast
  Scenario: Toasts sit above every other layer
    Given the settings drawer is open
    When an action produces a toast
    Then the toast renders above the drawer and its backdrop
    And it remains clickable

  # ------------------------------------------------- layering and stacking

  @regression
  Scenario Outline: Stacking order
    Then "<upper>" renders above "<lower>"

    Examples:
      | upper                | lower                |
      | toast                | settings drawer      |
      | settings drawer      | its backdrop         |
      | backdrop             | configuration panel  |
      | configuration panel  | canvas               |
      | drag ghost           | configuration panel  |
      | drop indicator       | canvas               |
      | drag ghost           | drop indicator       |

  @regression
  Scenario: A modal opening does not close the configuration panel
    Given the configuration panel is open for a block
    When I open "Ajustes" and then close it
    Then the configuration panel is still open for the same block
    And its scroll position is unchanged
