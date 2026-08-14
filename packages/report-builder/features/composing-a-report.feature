@journey @reports
Feature: Composing a report and handing it to the team

  The whole of a report's first life, in one pass: an author starts from a
  template, watches the block draw itself, gives the report a name, and only
  then does the rest of the store see it.

  The order is the point. A new report starts as a PRIVATE DRAFT and autosaves
  itself from the first keystroke — so publishing is a separate, deliberate
  act rather than the default. Without that pairing, "saves itself every
  second" and "visible to everyone" would combine into a report that broadcast
  every half-finished intermediate state of its own assembly.

  Background:
    Given the reports area is open on the store's saved reports

  Scenario: A report starts private, and only a deliberate act publishes it
    When she starts a new report
    And she picks the first block template
    Then the block draws its figures
    And the report is a draft only she can see

    When she calls it "Receita da semana"
    And she publishes it to the whole team
    And she goes back to the list
    Then "Receita da semana" is there for the team, no longer a draft

  Scenario: A second block goes in beside the first, and both survive publishing
    When she starts a new report
    And she picks the first block template
    And she adds a second block template beside it
    Then the report holds two blocks, and both draw their figures

    When she calls it "Fechamento do mês"
    And she publishes it to the whole team
    And she goes back to the list
    Then "Fechamento do mês" is there for the team, described as two blocks
