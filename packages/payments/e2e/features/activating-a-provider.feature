@journey @activation
Feature: Activating a provider

  "Connected" and "can charge" are different facts, and the gap between them
  is where a store ships broken: credentials authenticate, the switch flips,
  and the first real shopper is refused. So a provider that declares the
  activation charge EARNS its switch — one cent through the owner's own card,
  on the same rails a shopper's money takes, refunded on the spot — and stays
  off until that cent has landed.

  Background:
    Given the owner opens the settings of a connected but unproven provider

  Scenario: Enabling without proof is refused
    Then the sales switch is locked off until a real charge lands
    When the owner tries to force the provider on anyway
    Then the enable request is refused as unproven

  Scenario: Paying the one-cent verification enables the provider
    When the owner pays the verification charge with their card
    Then the provider is proven and receiving sales
    And the screen says the cent came back

  Scenario: A refused card names the reason and a retry is a fresh charge
    When the owner pays the verification charge with a refused card
    Then the refusal names the provider's reason
    When the owner pays the verification charge with their card
    Then the provider is proven and receiving sales
    And the provider received each attempt as its own charge
