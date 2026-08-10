@journey @saved-cards
Feature: Saving a card without buying

  Saving a card is not buying: no order exists, nothing is charged, and the
  card still travels its usual path — the browser mints the token and the
  provider validates it. What the shopper reads back is only what is fit to
  show: the brand and the last digits. The token that can charge stays on the
  store's side and never reaches this screen.

  There is deliberately no delete button here: taking a card off the list is
  between the store and the provider, not a tap on this screen.

  Background:
    Given the shopper opens the store's card wallet

  Scenario: Saving a card without buying anything
    When she decides to add a card
    And she fills in the card and saves it
    Then the card is stored and appears in the list
    And the list shows only the brand and the last digits

  Scenario: A card refused at validation explains why and stays off the list
    When she decides to add a card
    And she tries to save a refused card
    Then the refusal explains why and the form stays on screen
    And the wallet still holds no card

  Scenario: The empty wallet invites saving the first card
    Then the empty wallet invites saving the first card
