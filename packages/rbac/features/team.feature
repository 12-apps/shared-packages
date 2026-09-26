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

  Scenario: A manager gives one member a second system role, keeping the first
    # Person × role × tenant is N×M×J: a member holds as many roles as the store
    # grants, system ones included. Reopened rather than read off the grid: the
    # roles column shows a role's LABEL, which is host copy, and the editor's
    # checkboxes are keyed on the wire value. Reopening also refetches, so this
    # asserts what the server stored rather than what the dialog left behind.
    When I open the team screen
    And I open the role editor for the matching member
    And I add the seeded assignable role to the matching member
    And I open the role editor for the matching member
    Then the role editor shows both system roles selected

  Scenario: A row opens that member's profile
    # The roster's rows are the ONLY way into the profile, so the navigation is
    # part of the roster's contract rather than a separate screen's.
    When I open the team screen
    And I open the matching member’s profile
    Then the member profile is visible
    And the profile names the member

  Scenario: The open profile tab is shareable
    When I open the team screen
    And I open the matching member’s profile
    And I open the member’s activity tab
    Then the address bar carries that tab

  Scenario: Adding an administrator can be abandoned without inviting anybody
    # Dismissal, not submission: a real invite writes to the host's own storage
    # and no world method can put that back. What this pins is that the
    # affordance exists and costs nothing to open.
    When I open the team screen
    And I start adding an administrator
    Then the invite form is open
    When I dismiss the invite form
    Then the invite form is closed
    And the team grid is visible

  Scenario: A manager grants an additive custom role, then takes it back
    # A custom role rides ALONGSIDE the roles already held rather than replacing
    # any of them, and
    # the same checkbox does both: the dialog diffs the selection and calls the
    # grant or the revoke endpoint. Reopened each time, so both assertions read
    # what the server stored.
    When I open the team screen
    And I open the role editor for the matching member
    And I add the seeded custom role to the matching member
    And I open the role editor for the matching member
    Then the member holds the seeded custom role
    When I take the seeded custom role back
    And I open the role editor for the matching member
    Then the member no longer holds the seeded custom role

  Scenario: The editor refuses only an empty role set
    # Any number of roles is a valid set. Zero is not a role edit, it is a
    # removal, and the roster has its own affordance for that.
    When I open the team screen
    And I open the role editor for the matching member
    And I clear every role the matching member holds
    Then the editor refuses the save
