# The role catalog's journeys. Same rule as `team.feature`: test ids only, and
# every noun a scenario needs comes from the host's fixtures.
Feature: The role catalog

  Background:
    Given I am signed in as somebody who may manage the team

  Scenario: The catalog renders
    When I open the roles screen
    Then the roles grid is visible

  Scenario: Searching narrows the catalog and deep-links the keyword
    When I open the roles screen
    And I search the catalog for the seeded custom role
    Then the address bar carries the custom role name
    And the seeded custom role is listed

  Scenario: Composing a role can be abandoned without saving
    # The dismissal is the assertion: an abandoned compose must leave the
    # catalog exactly as it was, which is what makes the dialog safe to open.
    When I open the roles screen
    And I start composing a new role
    Then the role form dialog is open
    When I dismiss the role form
    Then the role form dialog is closed
    And the roles grid is visible
