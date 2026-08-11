@journey @reports @builder
Feature: Sizing a block, and getting the size that was asked for

  An author lays a report out by eye: this chart deserves the whole width,
  that one sits fine in a third, and the row underneath should stop at the
  same place as the row above it. Width and height are the two controls that
  say so, and neither is worth anything unless the block on the canvas
  actually changes shape.

  That last clause is the whole feature. Both pickers are segmented controls
  that light up the segment you pressed, so a control wired to nothing looks
  exactly like a control wired to everything — right up until the report is
  opened by somebody else. These scenarios press the segment and then measure
  the block.

  Background:
    Given the reports area is open on the store's saved reports
    And she is building a new block from the "Receita por dia" template

  Scenario: A width narrower than the canvas is the width the block gets
    When she sets the block to a third of the canvas
    Then the block takes about a third of the canvas

    When she sets the block to the full canvas
    Then the block takes the whole canvas

  Scenario: A block given a tall tier is drawn taller than one left on Auto
    Then the block is as tall as its own contents

    When she sets the block's height to "Alta"
    Then the block is taller than it was
