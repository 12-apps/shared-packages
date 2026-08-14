@journey @setup-guide
Feature: O passo a passo fala em nome da plataforma

  O lojista abre a configuração do provedor e lê um passo a passo escrito para
  ele. No meio das instruções o texto se dirige à plataforma pelo nome — "é
  assim que o {plataforma} confirma que a notificação veio mesmo da Stone".

  Por muito tempo esse nome vinha escrito dentro do pacote. Quem instalasse a
  biblioteca entregava ao SEU lojista a marca de outro produto, na tela de
  configuração da própria loja, sem que nada quebrasse — os testes do pacote
  alimentavam o guia com o mesmo vocabulário que o guia já trazia embutido, e
  concordar não prova nada quando os dois lados são a mesma palavra.

  Agora quem hospeda diz como se chama, e o guia repete. Por isso nenhuma cena
  aqui escreve uma marca: quem sabe o nome é o anfitrião, e é dele que a cena
  pergunta. Uma cena que soletrasse a marca estaria afirmando que a cópia de um
  adotante específico foi entregue — que é justamente o defeito, não o conserto.

  Scenario: O lojista lê o nome de quem hospeda a loja dele
    Given o lojista abre o passo a passo de um provedor com guia
    Then o passo a passo trata a plataforma pelo nome que o anfitrião deu

  Scenario: Nenhum outro produto aparece na tela do lojista
    Given o lojista abre o passo a passo de um provedor com guia
    Then a tela não cita nenhum outro produto que instale este pacote
