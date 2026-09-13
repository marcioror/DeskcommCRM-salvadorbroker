---
impacto: nada_mudou
secao: adicionado
titulo: O proxy passa a registrar as requisições, para a próxima queda ser diagnosticável
---

Em 2026-09-05 um site atendido por esta instalação entrou em **loop de redirecionamento onze vezes**,
entre 11:45 e 15:25 UTC. Três dias depois foi
impossível dizer qual rota redirecionava para qual: o Caddy não registrava
acesso nenhum, e a aplicação não escreveu uma linha sequer naquela janela. A
causa morreu com o incidente.

O `Caddyfile` ganha um bloco `log` no site principal. Vai para o **stdout** de
propósito, porque o Docker já rotaciona esse contêiner em 10 MB × 3
(`logging: *default-logging` no compose) — um log de acesso em arquivo, sem
teto, é o jeito clássico de encher o disco de uma VPS.

O Caddy omite `Cookie` e `Authorization` do log por padrão, então isto **não**
passa a gravar sessão de ninguém.

Quem já roda não precisa fazer nada além do que já faz para trocar o
`Caddyfile`: um `caddy reload` basta, sem recriar o contêiner.
