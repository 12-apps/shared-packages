@journey @indisponivel
Feature: A loja não cobra online

  Duas coisas diferentes levam à mesma tela, e confundir uma com a outra é um
  defeito de verdade: uma loja que nunca conectou provedor nenhum, e uma loja
  que tem provedor mas desligou os pagamentos online. A primeira o servidor
  sabe; a segunda só a aplicação sabe. Se a decisão passar a ser de um lado só,
  uma das duas lojas volta a oferecer um checkout que não vai honrar.


  Scenario: Sem provedor nenhum, nada de pagamento aparece e nada é cobrado
    Given a loja não tem provedor nenhum conectado
    Then ela é avisada de que a loja não cobra online
    And nenhuma forma de pagamento é oferecida
    And nenhum pedido chegou a ser criado

  Scenario: Sem provedor, mas com alguém para chamar
    Given a loja não tem provedor nenhum e oferece chamar o garçom
    Then ela recebe a opção de chamar o garçom
    And nenhuma forma de pagamento é oferecida

  Scenario: A loja tem provedor mas desligou o pagamento online
    Given a loja tem provedor mas desligou os pagamentos online
    Then ela é avisada de que a loja não cobra online
    And nenhuma forma de pagamento é oferecida
