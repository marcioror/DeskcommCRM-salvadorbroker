---
impacto: nada_mudou
secao: corrigido
titulo: O telefone do lead protegido some de mais três lugares
---

A proteção de contato esconde telefone e e-mail de quem não cadastrou o lead —
mas o RÓTULO do contato cai para o telefone quando não há nome, e essa queda não
consultava a proteção. Três superfícies escreviam o número por essa porta:

- **Detalhe do follow-up** (`/api/v1/ai/followups/enrollments/[id]`): a fila
  irmã já tratava disso; o dossiê, não. Corrigido por contato — quem cadastrou
  continua vendo.
- **Relatório de atividades**: liberado a `viewer`. Corrigido por papel
  (gerente para cima vê), porque a função de banco que alimenta o relatório não
  informa quem cadastrou cada contato.
- **Notificação push**: mandava o número para a tela de bloqueio do celular de
  toda a equipe. Um push é um payload só para a organização inteira, então não
  há como mascarar por pessoa — o telefone simplesmente não entra mais. Quando
  não há nome, a notificação já dizia "Nova mensagem".

A regra que estava copiada dentro da rota da fila virou
`rotuloDoContatoProtegido`, num lugar só.
