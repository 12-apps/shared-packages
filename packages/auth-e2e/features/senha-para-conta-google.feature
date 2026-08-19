@journey @auth
Feature: A Google account that also wants a password

  This is the journey the whole feature was asked for.

  Somebody signed up by clicking "Continuar com Google" months ago. They have
  no password and have never had one — which is exactly why the obvious
  implementation fails: a "change your password" form asks for the current one,
  and the honest answer here is "I have never had one". So the screen has to
  know which of the two situations it is in, and it has to ask the SERVER,
  because only the server knows.

  The other half is that adding a password must not TAKE GOOGLE AWAY. A person
  hesitating over this form is usually afraid of exactly that, and an account
  that silently lost its social sign-in would be a support ticket from someone
  who can no longer get in at all.

  Background:
    Given the storefront journey fixture is seeded
    And the platform offers e-mail and password sign-in

  Scenario: She adds a password to an account that only had Google, and keeps both
    Given "fabi.google@futurepay.test" signed up with Google and has no password
    And she is already signed in

    When she opens her account
    Then she is offered to create a password
    # No "senha atual" field, because there is no current password. Asking for
    # one would make this form impossible to complete.
    And she is not asked for a current password

    When she creates the password "primeira senha 55"
    Then she is told her password was created

    # Reloading is what proves the server changed its mind, not the component.
    When she opens her account again
    Then she is offered to change her password
    And she is asked for a current password

    When she signs out
    And she tries to sign in with "primeira senha 55"
    Then she is signed in

    # Google is still hers. The account carries both methods, which is the
    # point of adding one rather than switching — and the place that shows is
    # the sign-in screen, which only a signed-out visitor is given.
    When she signs out
    Then signing in with Google is still offered

  Scenario: Changing a password she already has needs the current one
    Given "gina.google@futurepay.test" has an account with the password "senha atual 33"
    And she is already signed in

    When she opens her account
    Then she is asked for a current password

    When she tries to change her password to "senha nova 99" with the wrong current password
    Then she is told her current password is wrong

    When she changes her password to "senha nova 99" using "senha atual 33"
    Then she is told her password was changed
