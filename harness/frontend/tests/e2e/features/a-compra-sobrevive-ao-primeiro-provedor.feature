@journey @cadeia
Feature: A compra sobrevive ao primeiro provedor falhar

  A lojista ordenou dois provedores. Do lado de quem compra isso tem que ser
  invisível: o cartão é digitado UMA vez e a compra atravessa o primeiro
  provedor caindo.

  Só que um token de cartão pertence a quem o gerou, então a caminhada só
  consegue avançar para um provedor para o qual o navegador também gerou um. É
  por isso que a quantidade de instrumentos enviados é uma decisão do checkout,
  e é por isso que estes cenários olham para o que foi enviado e não só para a
  tela.

  Background:
    Given a compradora abre o checkout da loja "payments-checkout-chain-failover"

  Scenario: O primeiro provedor cai e o segundo cobra, sem redigitar nada
    Given a loja tem dois provedores que geram token no navegador
    When ela informa o CPF e segue para o pagamento
    And ela paga com um cartão novo
    Then o pagamento é confirmado
    And um instrumento foi gerado para cada provedor da cadeia
    And os dois provedores receberam a cobrança

  Scenario: O primeiro provedor é uma página externa e mesmo assim o mapa é enviado
    Given a loja tem um provedor de página externa seguido de um que gera token
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    And ela paga com um cartão novo
    Then o mapa de instrumentos traz só o provedor que gera token
