@journey @pix
Feature: Comprando com PIX numa loja que só aceita PIX

  A loja ligou um único provedor e ele só cobra por PIX. Do ponto de vista de
  quem compra, isso não é uma escolha: a tela mostra uma opção só, já marcada, e
  o código aparece sem nenhum toque a mais.

  O QR não é desenhado pelo checkout — ele vem do payload que o provedor gerou e
  que a loja carregou de volta na própria resposta. Um payload que não sobrevive
  a esse caminho vira uma tela de pagamento sem código nenhum, e é isso que
  estes cenários vigiam.

  Background:
    Given a compradora abre o checkout da loja "payments-checkout-pix"

  Scenario: O PIX já vem marcado e o código é o do provedor
    Given a loja ainda não recebeu o pagamento
    When ela informa o CPF e segue para o pagamento
    Then só a opção PIX é oferecida
    And ela vê o QR code do PIX
    And o código copia-e-cola veio do provedor

  Scenario: O pagamento é confirmado sozinho e a compradora vê o recibo
    Given a loja confirma o pagamento na primeira consulta
    When ela informa o CPF e segue para o pagamento
    Then o pagamento é confirmado
    And o recibo mostra o valor pago
