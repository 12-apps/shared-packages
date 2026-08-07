@journey @telas-de-provedor
Feature: A tela que o provedor pediu

  Cada provedor tem um jeito de cobrar, e por muito tempo o checkout desenhava
  um só, cheio de condicionais. Agora quem cobra na nossa página e quem cobra na
  página dele pedem telas diferentes — e é o ADAPTADOR que pede, não o checkout
  que adivinha.

  O id que ele declara nomeia a FORMA do fluxo, nunca a marca. Por isso as lojas
  aqui têm nomes inventados: uma loja "aurora" que declara a mesma forma recebe
  exatamente a mesma tela que um adquirente de verdade receberia.

  As duas últimas cenas são as que importam de madrugada. Um provedor que não
  declara nada continua vendendo, e um id que este pacote nunca viu — servidor
  mais novo que o navegador, coisa normal em deploy — cai na tela de capacidade
  em vez de deixar a compradora olhando para um painel vazio.


  Scenario: Quem cobra na nossa página mostra o formulário aqui mesmo
    Given a loja declara que cobra na própria página
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then ela vê o formulário de cartão

  Scenario: Quem cobra na página dele não oferece formulário nenhum
    Given a loja declara que a compradora termina no provedor
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then nenhum formulário de cartão é mostrado
    And ela é avisada de que vai ser levada para o provedor

  Scenario: Um provedor que não declara tela nenhuma continua vendendo
    Given a loja não declara tela nenhuma
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then ela vê o formulário de cartão

  Scenario: Um id que este pacote não conhece não deixa a tela em branco
    Given a loja declara uma tela que este pacote não conhece
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    Then ela vê o formulário de cartão

  Scenario: A compradora paga normalmente na loja que declara a nossa tela
    Given a loja declara que cobra na própria página
    When ela informa o CPF e segue para o pagamento
    And ela escolhe pagar com cartão
    And ela paga com um cartão novo
    Then o pagamento é confirmado
