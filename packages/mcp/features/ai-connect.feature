Feature: Connecting an AI assistant to the store

  The walkthrough a store owner follows to let an assistant reach their data.
  Every step below is this package's own component; what an assistant is
  called, and which ones are offered, is the host's configuration.

  Background:
    Given I am signed in as somebody who may connect an assistant
    When I open the AI integration screen

  Scenario: The landing says what an assistant will be able to do
    Then the landing explains the permission model before anything is connected
    And it shows examples of what an assistant can be asked

  Scenario: Choosing an assistant starts the manual walkthrough
    When I start the walkthrough
    And I choose an assistant that has no one-click install
    Then I am asked to copy the store's endpoint

  Scenario: Copying the endpoint is what advances the wizard
    When I start the walkthrough
    And I choose an assistant that has no one-click install
    And I copy the endpoint
    Then the walkthrough has moved on to configuring the connector

  Scenario: Configuring will not advance until the connector page is opened
    When I start the walkthrough
    And I choose an assistant that has no one-click install
    And I copy the endpoint
    Then continuing is refused until I open the connector page
    And once opened, continuing reaches the connect step

  Scenario: Going back returns to the previous step
    When I start the walkthrough
    And I choose an assistant that has no one-click install
    And I copy the endpoint
    And I go back a step
    Then I am asked to copy the store's endpoint

  Scenario: The confirmation waits for the assistant, and can be re-tested
    When I start the walkthrough
    And I choose an assistant that has no one-click install
    And I copy the endpoint
    And I work through configuring and connecting
    Then the confirmation is still waiting for the assistant
    And it offers to test the connection again
