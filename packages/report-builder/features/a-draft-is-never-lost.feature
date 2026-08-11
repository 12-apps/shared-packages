@journey @reports @working-copy
Feature: A draft is never lost, and readers wait to be shown it

  Reworking a report that is already live is two promises kept at once.

  The author's half: whatever they type is safe the moment they stop typing,
  and it is safe ON THE SERVER — not in this tab's memory. Shut the laptop,
  come back tomorrow, sign in somewhere else entirely, and the work is still
  where it was left.

  The store's half: none of that is visible to anybody until the author says
  so. A report being reworked keeps serving its readers exactly the version
  they already know, and the one control that changes what they see is Salvar.

  Both halves are the same mechanism seen from two sides — the edit is parked
  as a working copy BESIDE the published document, never over it — which is
  why they are one feature and not two.

  Background:
    Given the reports area is open on the store's saved reports

  Scenario: The work follows the author into a brand-new session
    When he opens the published team report to edit it
    And he renames it to "Vendas de agosto"
    Then the editor says the changes have not been published

    When he comes back to the report in a brand-new session
    Then the editor still holds "Vendas de agosto"

  Scenario: Readers keep the published version until it is saved
    When he opens the published team report to edit it
    And he renames it to "Vendas de agosto"
    Then the editor says the changes have not been published

    When he leaves the editor
    Then he is asked whether he means to go without publishing

    When he confirms that he does
    Then the report still reads as it was last published

    When he goes back to the list
    Then the list warns that the report is carrying unpublished changes

    When he opens the report and saves the parked changes
    Then the report now reads "Vendas de agosto"

    When he goes back to the list
    Then the list no longer warns about unpublished changes
