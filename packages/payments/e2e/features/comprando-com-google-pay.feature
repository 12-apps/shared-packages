@journey @google-pay
Feature: Comprando com Google Pay

  A carteira fica no topo do pagamento, em "Pagamento rápido", acima das
  formas de pagar — não é mais uma opção da lista. Um toque abre a folha do
  Google já com o valor a pagar, e o pedido nasce por trás dela; a folha é a
  confirmação. O CPF é pedido uma vez, no topo, porque o provedor exige o CPF
  em todo pedido e a folha do Google não o informa. O botão só existe quando a
  loja declarou a carteira E o aparelho disse que consegue pagar — um botão que
  leva a compradora até a folha para depois recusar a cobrança é pior do que
  nenhum botão.

  Scenario: A compra inteira acontece pela carteira
    Given a compradora abre o checkout de uma loja com Google Pay
    Then a carteira espera o CPF
    When ela informa o CPF no topo do pagamento
    Then ela vê o botão do Google Pay em pagamento rápido
    And as formas de pagar continuam abaixo da carteira
    When ela paga com o Google Pay em pagamento rápido
    Then o pagamento é confirmado
    And a cobrança enviada ao provedor carrega a carteira do Google

  Scenario: Uma loja sem carteira nunca mostra o botão
    Given a compradora abre o checkout da loja de cartão
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then nenhum botão do Google Pay é mostrado
    And ela vê o formulário de cartão
