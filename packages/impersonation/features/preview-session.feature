Feature: Previewing the tenant through a narrower lens

  Someone who administers a tenant looks at it as one of its roles, or as one of
  its people, to check what they can actually reach. A role preview substitutes
  nobody — it only narrows the previewer's own rights — so it may still write. A
  member preview resolves as somebody else, so it may not, whatever the cookie
  says.

  Background:
    Given I have no session in force

  Scenario: a role preview names the role and may still write
    When I preview the tenant as a role
    Then a session banner is showing
    And the banner names the role I am previewing
    And the banner does not say the session is read-only
    When I leave the session
    Then no session banner is showing

  Scenario: a member preview names the person and is read-only
    When I preview the tenant as a member
    Then a session banner is showing
    And the banner names the member I am previewing
    And the banner says the session is read-only
    When I leave the session
    Then no session banner is showing

  Scenario: the countdown is recomputed when the tab comes back
    When I preview the tenant as a role
    Then a session banner is showing
    When the tab is hidden and shown again
    Then the banner is counting down
