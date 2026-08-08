@journey @google-pay
Feature: Comprando com Google Pay

  A carteira não é um quarto meio de pagamento: é outro jeito de produzir o
  cartão. O botão só existe quando a loja declarou a carteira E o aparelho
  disse que consegue pagar — um botão que leva a compradora até a folha do
  Google para depois recusar a cobrança é pior do que nenhum botão. O
  formulário de cartão continua na tela como alternativa o tempo todo.

  Scenario: A compra inteira acontece pela carteira
    Given a compradora abre o checkout de uma loja com Google Pay
    When ela informa o CPF e segue para o pagamento
    Then ela vê o botão do Google Pay
    And ela vê o formulário de cartão
    When ela paga com o Google Pay
    Then o pagamento é confirmado
    And a cobrança enviada ao provedor carrega a carteira do Google

  Scenario: Uma loja sem carteira nunca mostra o botão
    Given a compradora abre o checkout da loja de cartão
    When ela informa o CPF e segue para o pagamento
    Then nenhum botão do Google Pay é mostrado
    And ela vê o formulário de cartão
