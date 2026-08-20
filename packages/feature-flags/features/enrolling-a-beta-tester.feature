@journey @feature-flags @enroll
Feature: Enrolling a beta tester

  A beta is granted to PEOPLE, not stores. The operator names a person by the
  one thing she actually knows about them — their email — and the host's own
  directory decides who that is. The grant that comes back is enabled from the
  first moment, and it is stamped: six months later, "who let this person in"
  has to be answerable from the row itself.

  Which betas exist, and what they are called, is the HOST's catalog — a flag
  with no code behind it does nothing, so the features talk about "the empty
  beta" and read its real name from the app under test.

  Background:
    Given the beta catalog is open

  Scenario: A person joins a beta by email
    When the operator opens the empty beta
    Then that beta tallies 0 enabled of 0 enrolled

    When she enrolls the new tester by email
    Then the new tester is in the cohort, enabled
    And the enrollment is stamped with the operator's identity
    And that beta tallies 1 enabled of 1 enrolled

  Scenario: Enrolling someone twice is one grant, not two
    When the operator opens the empty beta
    And she enrolls the new tester by email
    And she enrolls the new tester by email
    Then that beta tallies 1 enabled of 1 enrolled
