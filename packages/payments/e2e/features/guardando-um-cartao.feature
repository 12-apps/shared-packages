@journey @carteira-guardada
Feature: Guardando um cartão sem comprar

  Guardar um cartão não é comprar: nenhum pedido existe, nenhum valor é
  cobrado, e mesmo assim o cartão atravessa o mesmo caminho de sempre — o
  navegador gera o token e o provedor valida. O que ela recebe de volta é só o
  que dá para mostrar: a bandeira e o final do número. O código que cobra fica
  do lado de lá, guardado pela loja, e nunca aparece nesta tela.

  Não existe botão de excluir aqui de propósito: tirar um cartão da lista é
  assunto entre a loja e o provedor, não um toque nesta tela.

  Background:
    Given a compradora abre a carteira de cartões da loja

  Scenario: Guardar um cartão sem comprar nada
    When ela decide adicionar um cartão
    And ela preenche o cartão e salva
    Then o cartão fica guardado e aparece na lista
    And a lista mostra só a bandeira e o final do cartão

  Scenario: Um cartão recusado na validação explica o motivo e não entra na lista
    When ela decide adicionar um cartão
    And ela tenta guardar um cartão recusado
    Then a recusa explica o motivo e o formulário continua na tela
    And a carteira continua sem nenhum cartão

  Scenario: A lista vazia convida a adicionar o primeiro cartão
    Then a carteira vazia convida a guardar o primeiro cartão
