@journey @reconexao
Feature: A autorização que morreu, e a loja que volta a vender

  O provedor pode se recusar a renovar a autorização de uma loja. Quando isso
  acontece a conexão sai da rotação — nenhuma cobrança nova vai para um token
  morto — mas o lojista NUNCA desligou nada, e é por isso que o `enabled`
  continua verdadeiro: reconectar sozinho tem que devolver a loja à rotação,
  sem ninguém lembrar de apertar um botão depois.

  Essas duas coisas discordarem é o estado inteiro. Uma tela que mostrasse só
  "ativo" mentiria (não está vendendo), e uma que mostrasse só "desligado"
  também (o lojista não desligou) — e faria ele reativar à mão uma loja que já
  estava ativa, o que é justamente o passo que se esquece.

  A transição em si nenhum cenário consegue pedir a um provedor de verdade: é
  o provedor recusando um refresh. Quem hospeda declara o estado; o que ele
  SIGNIFICA é deste pacote.

  Scenario: A conexão sai da rotação sem ninguém ter desligado nada
    Given a autorização da loja com o provedor foi recusada
    Then a conexão aparece como precisando reconectar
    And ela continua ligada, mas fora da rotação

  Scenario: O lojista entende o que aconteceu ao abrir a conexão
    Given a autorização da loja com o provedor foi recusada
    When o lojista abre a conexão do provedor
    Then ele lê que a autorização expirou ou foi revogada
    And ele vê desde quando

  Scenario: Uma reconexão devolve a loja à rotação, sem apertar mais nada
    Given a autorização da loja com o provedor foi recusada
    When o lojista abre a conexão do provedor
    And ele reconecta e autoriza de novo
    Then a conexão volta a estar verificada
    And a loja volta para a rotação sem ninguém ter mexido no botão
    And o aviso de autorização expirada some

  # O contraste, e não é cerimônia: todo aviso desta tela é condicional, então
  # uma tela que avisasse sempre passaria nos três cenários acima. Este é o
  # único que falha se o aviso deixar de ser condicional.
  Scenario: Uma conexão saudável não avisa nada
    Given a loja tem uma conexão saudável com o provedor
    When o lojista abre a tela dessa conexão
    Then não há aviso de autorização expirada
    And não há nada para reconectar
