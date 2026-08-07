@journey @cartao
Feature: Comprando com cartão

  A compradora digita o cartão uma vez. O que acontece com esses dados entre o
  navegador e o provedor é onde os três defeitos críticos da FUT-740 moravam —
  com todos os quinze checks verdes — então cada cenário aqui termina olhando
  para o que realmente atravessou.

  Background:
    Given a compradora abre o checkout da loja "payments-checkout-card"

  Scenario: O cartão é cobrado e o CPF chega ao provedor
    When ela informa o CPF e segue para o pagamento
    Then ela vê o formulário de cartão
    When ela paga com um cartão novo
    Then o pagamento é confirmado
    And a cobrança enviada ao provedor carrega o CPF dela
    And o corpo da cobrança é o formato plano que o cliente publicado envia

  Scenario: Uma loja com um provedor só não envia tokensByProvider
    When ela informa o CPF e segue para o pagamento
    And ela paga com um cartão novo
    Then o pagamento é confirmado
    And nenhum tokensByProvider é enviado
