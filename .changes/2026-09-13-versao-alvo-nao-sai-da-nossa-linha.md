---
impacto: capacidade_nova
secao: corrigido
titulo: A atualização não pode mais instalar uma versão que não é desta instalação
---

`agent.sh` e `update.sh` escolhiam a versão-alvo com `git tag -l 'v*'
--sort=-v:refname | head -1` — a mais alta de **todas** as etiquetas que o clone
guarda. E um clone guarda as do repositório de origem também: basta alguém ter
rodado `git fetch --tags` uma vez, coisa que o próprio `install.sh` faz.

Medido nesta instalação em 2026-09-13: a `main` estava na v1.16.1 e o clone
guardava a v1.20.0 do upstream. A escolha caía na v1.20.0, e o `git checkout`
seguinte trocaria o produto inteiro pelo código do outro repositório — em
silêncio, com a tela dizendo "atualizado". O rollback do `agent.sh` não cobre
esse caso: ele volta a **imagem**, não o checkout.

Agora a escolha passa por `etiqueta_mais_alta_da_casa` (`_common.sh`), que
filtra por `--merged <ramo que a main rastreia>`. Uma etiqueta que não está na
história desta instalação deixa de ser candidata — e a garantia vem do grafo de
commits, não de configuração que alguém possa desfazer sem perceber.

A referência é o ramo que a `main` **rastreia**, não `origin/main` cravado: num
fork o remote do dono costuma não se chamar `origin`, e cravar o nome faria a
função filtrar pela história do upstream, devolvendo exatamente a etiqueta que
ela existe para excluir. Sem ramo rastreado — clone raso, remote com outro nome
— cai no comportamento antigo de propósito: um botão que some é mais difícil de
diagnosticar que um botão que erra.

Isto não é remendo de fork. `--merged` é a regra certa dos dois lados: no
repositório de origem não muda nada, porque as etiquetas dele estão na `main`
dele. Coberto por `tests/shell/etiqueta-da-casa.test.sh`, com controle negativo
— o caso 1 prova, no mesmo repositório de teste, que a expressão antiga escolhe
a etiqueta alheia.
