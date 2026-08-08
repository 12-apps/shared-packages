@journey @apple-pay
Feature: Comprando com Apple Pay

  O provedor processa Apple Pay só para Visa e Mastercard, então a folha da
  Apple oferece só essas bandeiras — um cartão que seria recusado nunca chega
  a ser oferecido. E a carteira é um atalho, nunca o único caminho: num
  aparelho sem Apple Pay o botão simplesmente não existe e o formulário de
  cartão continua fazendo a venda.

  Scenario: A compra inteira acontece pela carteira
    Given a compradora abre o checkout de uma loja com Apple Pay
    When ela informa o CPF e segue para o pagamento
    Then ela vê o botão do Apple Pay
    And ela vê o formulário de cartão
    When ela paga com o Apple Pay
    Then o pagamento é confirmado
    And a cobrança enviada ao provedor carrega a carteira da Apple

  Scenario: Sem Apple Pay no aparelho, o cartão continua fazendo a venda
    Given a compradora abre o checkout da loja com Apple Pay num aparelho sem Apple Pay
    When ela informa o CPF e segue para o pagamento
    Then nenhum botão do Apple Pay é mostrado
    And ela vê o formulário de cartão
    When ela paga com um cartão novo
    Then o pagamento é confirmado
