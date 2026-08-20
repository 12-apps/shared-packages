@journey @feature-flags @directory
Feature: Only people the host knows can join a beta

  The grants table carries by-value user ids with no foreign key, so the
  HOST's directory is the only authority on who a person is. An email nobody
  has an account under is refused out loud — in the server's own words, on
  the screen the operator is looking at — and the cohort does not move. The
  alternative is a grant minted for an id no directory can resolve: a row
  nobody can see, gating nothing, revocable by nobody who can tell whose it
  was.

  Background:
    Given the beta catalog is open
    And the operator opens the seeded beta

  Scenario: An email the directory does not know is refused out loud
    When she tries to enroll an email the host does not know
    Then the surface refuses with the server's own words
    And that beta tallies 1 enabled of 1 enrolled
