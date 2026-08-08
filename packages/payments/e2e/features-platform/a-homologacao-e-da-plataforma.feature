@journey @plataforma
Feature: A homologação é da plataforma

  Somos o integrador direto: a homologação do PagBank é da PLATAFORMA, uma
  única vez — as lojas são usuárias da plataforma e estão isentas. Sem ela,
  cobranças em produção respondem 403 ACCESS_DENIED mesmo com credenciais
  válidas, então "a plataforma está homologada?" é uma pergunta que vale
  dinheiro e não pode depender da memória de alguém.

  A tela carrega as três metades: a situação registrada (a AUSÊNCIA do
  registro é o quarto estado honesto, "não solicitada" — exibido, nunca
  oferecido), as respostas prontas do formulário oficial, e o gerador do
  anexo de evidências, que roda com as credenciais de sandbox da própria
  plataforma e recusa com o motivo quando não pode rodar.

  Scenario: As respostas prontas nomeiam os dois serviços integrados
    Given a operadora abre a homologação de uma plataforma que nunca a solicitou
    Then a situação é "Não solicitada"
    And o formulário oficial está a um clique
    And as respostas prontas nomeiam a API de Pedidos e a API Connect

  Scenario: Registrar a solicitação muda a situação sem recarregar
    Given a operadora abre a homologação de uma plataforma que nunca a solicitou
    When ela registra o protocolo da solicitação
    Then o registro é confirmado
    And a situação passa a ser "Solicitada"

  Scenario: Sem token de sandbox, o anexo recusa com o motivo
    Given a operadora abre a homologação de uma plataforma que nunca a solicitou
    When ela tenta gerar o anexo de evidências
    Then ela vê o motivo pelo qual o anexo não saiu
