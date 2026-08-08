@journey @plataforma
Feature: A aplicação que as lojas autorizam

  A aplicação OAuth da plataforma — o que cada loja autoriza ao conectar a
  própria conta PagBank — foi registrada à mão, e por muito tempo nada no
  produto sabia dizer o que estava registrado, em qual ambiente, nem com qual
  redirect_uri. O PagBank compara a redirect_uri byte a byte na troca do
  token, então um cadastro diferente do callback desta instalação é uma falha
  de OAuth silenciosa — e diagnosticar isso uma vez já custou tempo de gente.

  Esta tela é a consulta feita permanente. Sandbox e produção são aplicações
  SEPARADAS, com credenciais separadas, então cada ambiente responde por si; e
  a tela existe justamente para os momentos em que algo está quebrado, então
  uma instalação sem nada configurado também precisa se explicar.

  Scenario: O callback que precisa estar registrado aparece por inteiro
    Given a operadora abre a aplicação Connect de uma instalação sem aplicação registrada
    Then ela vê o callback desta instalação
    And cada ambiente aparece em seu próprio cartão

  Scenario: Um ambiente sem aplicação diz isso com todas as letras
    Given a operadora abre a aplicação Connect de uma instalação sem aplicação registrada
    Then os dois ambientes se declaram sem aplicação configurada
