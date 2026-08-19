@journey @auth
Feature: Getting back in after forgetting a password

  Somebody who has forgotten their password cannot prove anything except that
  they can read their own mail — so that is what the reset link is: proof of
  the inbox, spent once, for a new password.

  Three properties are worth the scenarios, and only the first is obvious:

    * the new password works;
    * the OLD one stops, immediately — a reset that leaves the previous
      password live has changed nothing about the account being compromised;
    * the link dies on use, so a forwarded mail is not a second chance.

  Background:
    Given the storefront journey fixture is seeded
    And the platform offers e-mail and password sign-in

  Scenario: A shopper resets her password and the old one stops working
    Given "dora.reset@futurepay.test" has an account with the password "senha antiga 11"

    When she asks for a link to reset her password
    Then she is told to check her inbox

    When she opens the reset link we sent her
    And she chooses "senha nova 88" as her new password
    Then she is told her password was changed

    When she tries to sign in with "senha antiga 11"
    Then she is told her e-mail or password is wrong

    When she tries to sign in with "senha nova 88"
    Then she is signed in

  Scenario: The reset link works exactly once
    Given "elza.reset@futurepay.test" has an account with the password "senha antiga 11"
    And she asked for a link to reset her password

    When she opens the reset link we sent her
    And she chooses "senha nova 88" as her new password
    Then she is told her password was changed

    When she opens that same link again
    # She has to choose a password before the refusal, and that is the flow as
    # built: the page cannot know a token is spent until it asks, so opening a
    # dead link shows the form and the server refuses on submit. Worth revisiting
    # for the shopper's sake — being told after typing a new password twice is a
    # poor way to learn the link expired — but the scenario describes what ships.
    And she chooses "outra senha 99" as her new password
    Then she is told the link is no longer valid

  Scenario: Asking about an address with no account gives nothing away
    When someone asks for a reset link for "ninguem@futurepay.test"
    # Identical to the answer a real account gets. The screen cannot tell them
    # apart because the server does not, which is the point: otherwise this
    # form answers "does this person have an account here" for anyone who asks.
    Then she is told to check her inbox
    And no message was sent to "ninguem@futurepay.test"
