# The roster's own journeys, portable to any host that mounts `createWebRbac`.
#
# Every assertion reads a test id THIS package renders. Nothing here names a
# sentence: the origin host's specs asserted `heading "Equipe"`, which is its
# pt-BR and would fail in the next adopter for a reason that has nothing to do
# with the roster working. Who the rows are comes from the host's fixtures.
Feature: The staff roster

  Background:
    Given I am signed in as somebody who may manage the team

  Scenario: The roster renders
    When I open the team screen
    Then the team grid is visible

  Scenario: Searching narrows the roster and deep-links the keyword
    # The URL param is what proves the term reached the BACKEND rather than
    # filtering rows already on screen — the grid is server-driven.
    When I open the team screen
    And I search the roster for the seeded keyword
    Then the address bar carries the keyword
    And the matching member is listed
    And the excluded member is not listed

  Scenario: A manager reassigns a member's base role from the roster
    When I open the team screen
    And I open the role editor for the matching member
    And I assign the seeded base role
    Then the team grid shows the member with that role
