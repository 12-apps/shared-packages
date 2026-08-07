@journey @recusas
Feature: Quando o pagamento não vai

  Recusa não é uma coisa só, e tratar as três como se fossem é o que produz o
  dano. O emissor recusar é um problema que a compradora resolve; uma cobrança
  que ninguém consegue confirmar é a única situação em que oferecer "tentar de
  novo" pode custar dinheiro de verdade a ela; e uma cadeia esgotada não tem
  nada a ver com os dados que ela digitou.

  A loja destes cenários aceita PIX e cartão, então escolher o cartão é um
  passo de verdade — e no último cenário é justamente o que sobra.

  Background:
    Given a compradora abre o checkout da loja "payments-checkout-failures"

  Scenario: O emissor recusa e ela pode tentar de novo
    Given o provedor da loja recusa o cartão
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then ela vê o formulário de cartão
    When ela paga com um cartão recusado
    Then o pagamento falha
    And ela pode tentar novamente

  Scenario: Ninguém consegue confirmar a cobrança, então não há como pagar de novo
    Given o provedor da loja não responde de forma conclusiva
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then ela vê o formulário de cartão
    When ela paga com um cartão novo
    Then ela é avisada de que o pagamento está sendo confirmado
    And não existe nenhum botão de pagar na tela
    And não existe nenhum botão de tentar novamente na tela

  Scenario: A cadeia se esgota e o PIX continua disponível
    Given o provedor da loja está fora do ar
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then ela vê o formulário de cartão
    When ela paga com um cartão novo
    Then o erro do cartão menciona o outro meio de pagamento
    And a opção PIX continua na tela
