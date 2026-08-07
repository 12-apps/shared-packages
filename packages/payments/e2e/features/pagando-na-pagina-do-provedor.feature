@journey @redirecionamento
Feature: Pagando na página do provedor

  Quando ninguém na cadeia consegue gerar token no navegador, o cartão é
  digitado na página do próprio provedor. A compradora sai do site da loja e
  volta depois — e essa volta é a parte que costuma quebrar em silêncio: a
  aplicação foi destruída pela navegação, então a única coisa que resta é o que
  foi guardado ANTES de sair.

  Guardar primeiro e navegar depois é a regra. Invertida, a compradora paga e
  volta para uma tela em branco.

  Background:
    Given a compradora abre o checkout de uma loja de página externa

  Scenario: Nenhum formulário de cartão é oferecido, e a saída fica registrada
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then nenhum formulário de cartão é mostrado
    And a loja registrou para onde ela seria levada

  Scenario: A tela de transferência guarda o pedido e oferece um link de verdade
    When a loja gera o pagamento hospedado
    Then ela vê a tela de transferência para o provedor
    And existe um link visível para a página do provedor
    And o pedido foi guardado antes da navegação

  Scenario: Ela volta do provedor e o pagamento aparece confirmado
    When a loja gera o pagamento hospedado
    And ela volta da página do provedor
    Then o pagamento volta confirmado
