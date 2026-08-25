# The promotions admin's journeys, portable to any host that mounts
# `createWebDiscounts`.
#
# Every assertion reads a test id THIS package renders. Nothing here names a
# sentence: the origin host's spec clicked `Editar` and `Salvar alterações`,
# which is its pt-BR and would fail in the next adopter for a reason that has
# nothing to do with promotions working. What a scenario needs to NAME — a
# fresh promotion name, a rate, how that rate reads once saved — comes from the
# host's fixtures.
Feature: Promotions

  Background:
    Given I am signed in as somebody who may manage promotions

  Scenario: The promotions grid renders
    When I open the promotions screen
    Then the promotions grid is visible

  Scenario: A manager composes a percentage promotion and finds it in the grid
    # The round trip is the claim: a rate typed as a percentage comes back as
    # one only if the conversion into basis points AND back out both ran.
    When I open the promotions screen
    And I compose a percentage promotion
    Then the promotion is listed with its rate

  Scenario: The value field follows the kind, and scope disappears for a combo
    # Three rules in one dialog, all of them about the form refusing to let an
    # operator build something the write path would reject.
    When I open the promotions screen
    And I start composing a promotion
    Then the percentage field is the one on screen
    When I switch it to a fixed amount
    Then the amount field REPLACES the percentage one
    When I switch it to a combo
    Then the scope question disappears and the group builder takes its place
    And the scope question comes back for a plain kind
    When I set the activation to a coupon code
    Then the coupon field is revealed

  Scenario: A manager renames a promotion from its row menu
    When I open the promotions screen
    And I compose a percentage promotion
    And I rename it from the row menu
    Then the grid shows the new name

  Scenario: A manager deletes a promotion from its row menu
    # Confirm-gated, and a SOFT delete — the row leaves the list while the
    # record survives for its redemption history.
    When I open the promotions screen
    And I compose a percentage promotion
    And I delete it from the row menu
    Then the promotion is gone from the grid
