@journey @reports @period
Feature: Choosing the period a report answers for

  Every figure on a report is a figure ABOUT some stretch of time, so the
  period control is not a filter sitting beside the report — it is half of
  what the report says.

  Two ways to set it, and they differ in kind. The rolling presets are the
  question anyone asks daily ("how are we doing this week"), and each one has
  to resolve to its OWN window: two presets that quietly answer with the same
  rows are indistinguishable from a period control that does nothing at all.
  A window picked out of the calendar is the other kind — two exact dates that
  must survive the whole trip to the server and back, with nothing on the
  screen to say which window actually ran unless the report says so itself.

  And where the two overlap, the rolling one wins: "7 dias" taken from the
  picker's quick column is the ROLLING seven days, not a frozen copy of this
  week's dates.

  Background:
    Given the reports area is open on the store's saved reports
    And she is reading the report published to her team

  Scenario: Each rolling preset answers with a window of its own
    Then the report opens on "30 dias"

    When she asks for "7 dias"
    Then the report covers fewer days than before

    When she asks for "Este mês"
    Then the report covers fewer days than before

    When she asks for "Hoje"
    Then the report covers a single day

  Scenario: A window picked out of the calendar is the window that runs
    When she picks her own two dates out of the calendar
    Then the report says which window it ran
    And it holds only what happened inside those days

  Scenario: A quick range that IS a preset is applied as that preset
    When she takes "7 dias" from the picker's quick ranges
    Then the period reads "7 dias", not the custom one
