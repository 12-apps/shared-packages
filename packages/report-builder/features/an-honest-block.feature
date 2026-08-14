@journey @reports @builder
Feature: A block may only be drawn a way that tells the truth

  A chart is a claim about the data, not a picture of it. A line joins two
  points and draws the gap between them as though the gap were a value —
  half-way between 09:00 and 10:00 is 09:30, and half-way between CARD and PIX
  is nothing at all. Stacking a single series redraws the identical chart under
  a different name. A table over a query that comes back as one row is a worse
  version of the single figure it should have been.

  So the builder refuses those, and — this is the part worth a journey — it
  refuses them OUT LOUD. A greyed control says "no" without saying why, leaving
  the author to guess which of their own choices caused it when the builder
  already knows. Every refusal here names the control to change next, and stays
  reachable: the tile is aria-disabled rather than disabled, so the explanation
  is not hidden behind an interaction the people who need it cannot perform.

  Background:
    Given the reports area is open on the store's saved reports
    And she is building a new block from the first block template

  Scenario: A line is refused over a grouping whose values have no order
    Then a line is offered, because the block is grouped by date

    When she groups the block by a field the catalog says is ordered
    Then a line is still offered

    When she groups the block by a field whose values have no order
    Then a line is refused, and the refusal names what to change
    And bars are still offered, because bars claim nothing about the gap

  Scenario: Stacking is refused while there is only one series to stack
    When she draws the block as bars
    Then stacking is refused, and the refusal names what to change

  Scenario: A table is refused for a block that would come back as one row
    When she takes the grouping away altogether
    Then a table is refused, and the refusal names what to change
