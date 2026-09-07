---
impacto: nada_mudou
secao: corrigido
titulo: A tela de contatos duplicados agora é de gerente para cima
---

`GET /api/v1/contacts/duplicates` agrupa contatos POR TELEFONE E POR E-MAIL, e a
chave do grupo é o próprio dado — então a tela entregava telefone e e-mail em
texto puro a qualquer membro da organização, inclusive ao corretor de quem esta
instalação esconde exatamente esses dois campos quando ele não cadastrou o lead.

O gate passou a ser `manager`, o mesmo papel que `POST /api/v1/contacts/merge`
já exigia para de fato juntar dois cadastros. Quem perde o botão "Duplicados" é
quem não conseguia concluir nada com ele. O botão some para esses papéis em vez
de dar erro ao ser clicado.
