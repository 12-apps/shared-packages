Feature: Acting as a tenant user

  A platform operator opens somebody else's account to reproduce what they are
  seeing. Nothing about that is allowed to be quiet: the session names a reason,
  is bounded to one tenant, says so on every screen, and ends when the operator
  leaves.

  Background:
    Given I have no session in force

  Scenario: a session cannot start without a tenant and a written reason
    When I open the start dialog for an ordinary user
    Then I cannot start the session yet
    And I am told to choose the tenant first
    When I choose the tenant
    Then I am told how long the reason has to be
    When I write a reason that is too short
    Then I cannot start the session yet
    When I write a full reason
    Then I can start the session
    And the dialog says the session will be read-only

  Scenario: a start is refused for another platform account, and says why
    When I open the start dialog for another platform account
    And I choose the tenant
    And I write a full reason
    Then I can start the session
    When I start the session
    Then the start is refused in the server's own words
    And the dialog is still open

  Scenario: a started session is visible everywhere and ends when I leave
    When I open the start dialog for an ordinary user
    And I choose the tenant
    And I write a full reason
    And I start the session
    Then a session banner is showing
    And the banner names the person I am acting as
    And the banner is counting down
    When I open an ordinary screen
    Then a session banner is showing
    When I leave the session
    Then no session banner is showing
