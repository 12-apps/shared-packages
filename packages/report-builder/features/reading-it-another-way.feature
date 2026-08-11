@journey @reports
Feature: Reading a chart another way, and taking it away

  A chart is one rendering of a set of rows, and it is not always the one a
  reader needs. Somebody using a screen reader cannot read bars at all, so the
  table view is the only way those figures exist for them — which is why it is
  the tool that keeps a visible slot when a block is too narrow for both of
  them. Somebody who has to put the numbers into a spreadsheet needs the rows
  themselves, in a file.

  Neither may invent anything. The table is the SAME rows the chart drew, and
  so is the download — a CSV assembled from a second trip to the server, or
  from columns derived somewhere else, is a file that disagrees with the screen
  it came from, and nothing would say which of the two is right.

  Background:
    Given the reports area is open on the store's saved reports
    And she is reading the report published to her team

  Scenario: A chart can be read as a table, and put back
    When she asks to see the chart as a table
    Then the chart's figures are on screen as rows
    And the control now offers to put the chart back

  Scenario: The rows on screen are the rows in the download
    When she asks to see the chart as a table
    And she downloads the chart's rows
    Then the file is named after the block
    And it holds exactly the rows she was looking at
