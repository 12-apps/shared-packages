@journey @feature-flags @opt-out
Feature: Pausing is not revoking

  A grant row carries an on/off switch of its own, and the difference is the
  point: a PAUSED tester keeps their row — an explicit opt-out that survives
  the day the flag's default flips on for everyone — while a REVOKED tester
  is simply out of the cohort. An operator who pauses someone who reported a
  problem must be able to un-pause them without re-enrolling them; an
  operator who revokes them is saying the beta is over for that person.

  Background:
    Given the beta catalog is open
    And the operator opens the seeded beta

  Scenario: Pausing keeps the tester's row, disabled
    Then the seeded tester is in the cohort, enabled
    And that beta tallies 1 enabled of 1 enrolled

    When she pauses the seeded tester
    Then the seeded tester is still in the cohort, disabled
    And that beta tallies 0 enabled of 1 enrolled

  Scenario: Revoking removes the tester entirely
    When she revokes the seeded tester
    Then the seeded tester is out of the cohort
    And that beta tallies 0 enabled of 0 enrolled
