---
impacto: nada_mudou
secao: corrigido
titulo: A atualização deixa de oferecer a versão do projeto de origem
---

A escolha da versão-alvo considerava qualquer etiqueta presente na história da
instalação, e a do projeto de origem está lá desde que este código foi
reconstruído sobre a versão 1.41.0 dele. Na prática, a tela podia oferecer uma
versão que não tem os módulos desta casa, e aceitar levaria a instalação para
uma árvore sem eles.

Agora a série desta casa vem primeiro. Onde ainda não existe versão nossa, o
comportamento é o de antes, e a falta de versão publicada continua parando a
atualização antes do banco, em vez de seguir no escuro.
