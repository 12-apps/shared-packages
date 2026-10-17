@journey @apple-pay
Feature: Comprando com Apple Pay

  A carteira fica no topo do pagamento, em "Pagamento rápido", acima das
  formas de pagar. A sessão da Apple começa dentro do toque — o Safari só abre
  a folha assim —, já com o valor a pagar, e o pedido nasce por trás dela. O
  provedor processa Apple Pay só para Visa e Mastercard, então a folha da Apple
  oferece só essas bandeiras. E a carteira é um atalho, nunca o único caminho:
  num aparelho sem Apple Pay o bloco simplesmente não existe e o cartão da
  lista continua fazendo a venda.

  Scenario: A compra inteira acontece pela carteira
    Given a compradora abre o checkout de uma loja com Apple Pay
    When ela informa o CPF no topo do pagamento
    Then ela vê o botão do Apple Pay em pagamento rápido
    When ela paga com o Apple Pay em pagamento rápido
    Then o pagamento é confirmado
    And a cobrança enviada ao provedor carrega a carteira da Apple

  Scenario: Sem Apple Pay no aparelho, o cartão continua fazendo a venda
    Given a compradora abre o checkout da loja com Apple Pay num aparelho sem Apple Pay
    When ela informa o CPF no topo do pagamento
    Then nenhum botão do Apple Pay é mostrado
    And não há pagamento rápido na tela
    When ela paga com um cartão novo pela lista
    Then o pagamento é confirmado
