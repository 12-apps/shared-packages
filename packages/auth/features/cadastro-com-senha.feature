@journey @auth
Feature: Signing up with an e-mail and a password

  Until now the only way in was Google. This is the other door, and the thing
  worth proving is not that a form submits — it is that the LINK WE SENT is the
  link that works, and that nothing before it lets somebody in.

  That distinction decides the whole shape of these scenarios. A test that
  seeded a token and navigated to the verify page would pass with a broken
  `appUrl`, a moved path, or a token put in the body instead of the query
  string — every one of which reaches a real person as a dead link and a
  support ticket. So each scenario reads the message the mailer actually
  produced and clicks what is inside it.

  Nothing here names a product, a cart or a tenant, and that is deliberate:
  signing in is not a store's affair. The app under test is simply wherever
  these screens live, which is what lets the same scenarios run against any
  host that mounts them.

  Background:
    Given the platform offers e-mail and password sign-in
    And the platform requires e-mail confirmation

  Scenario: A new shopper confirms her address and then signs in with her password
    Given "ana.cadastro@example.test" has no account yet

    When she creates an account with the password "uma senha boa 42"
    Then she is told to check her inbox

    # The password is correct from this moment on, and it still must not work.
    # Confirmation is the gate, and a gate that opens for the right password
    # alone is not a gate.
    When she tries to sign in with "uma senha boa 42"
    Then she is told to confirm her e-mail first

    When she opens the confirmation link we sent her
    Then she is told her e-mail is confirmed

    When she tries to sign in with "uma senha boa 42"
    Then she is signed in

  Scenario: The confirmation link works exactly once
    Given "bia.cadastro@example.test" has no account yet
    And she created an account with the password "outra senha boa 77"

    When she opens the confirmation link we sent her
    Then she is told her e-mail is confirmed

    # Somebody else opening the same link later — a forwarded mail, a shared
    # inbox — gets nothing. The row it spent is gone, not merely stale.
    When she opens that same link again
    Then she is told the link is no longer valid

  Scenario: With confirmation switched off, the account works straight away
    Given the platform does not require e-mail confirmation
    And "duda.cadastro@example.test" has no account yet

    # The other half of the superadmin switch, and it is not merely "one step
    # fewer": the sign-up CONTRACT changes with it. The funnel gets shorter and
    # the platform gives up the property the scenario below depends on.
    When she creates an account with the password "senha direta 33"
    Then she is signed in
    And no message was sent to "duda.cadastro@example.test"

  Scenario: Signing up with an address that already has an account tells only the inbox
    Given "carla.cadastro@example.test" already has an account

    When someone tries to create an account with "carla.cadastro@example.test"
    # The SAME answer a free address gives. Anything else here — a "já existe",
    # a different status, a faster reply — turns this form into a way to ask
    # who banks with us, one address at a time, with no credentials at all.
    Then she is told to check her inbox
    And the message we sent says she already has an account
