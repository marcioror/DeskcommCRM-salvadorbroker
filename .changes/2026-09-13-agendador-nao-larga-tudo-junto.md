---
impacto: nada_mudou
secao: corrigido
titulo: As tarefas automáticas param de largar todas no mesmo segundo
---

O `crond` do contêiner `scheduler` dispara toda linha elegível no segundo `:00`
do minuto. Como cinco rotas rodam `* * * * *` e outras seis rodam `*/5`, isso
significava **cinco requisições simultâneas por minuto e onze a cada cinco**,
todas competindo pelo mesmo pool do PostgREST.

Medido numa instalação real em 2026-09-13, pelos logs do próprio Supabase:

| | |
|---|---|
| requisições em 14h | 6.905 |
| que morreram em HTTP 504 | **248 (3,6%)** |
| tempo médio das que passavam | **1.017 ms** (pico de 15.922 ms) |
| as mesmas consultas pela conexão direta | **7 ms** |
| uma requisição isolada, sem concorrência | **70 ms** |

A assinatura que nomeia a causa: **todas** as rotas ficavam entre 1,6 e 2,4 s,
uniformemente — inclusive uma tabela de **zero linhas** e outra de **uma**.
Consulta em tabela vazia não custa dois segundos; aquilo era fila. O banco
inteiro tinha 35 MB e a instalação, nenhum usuário. E o padrão no relógio
fechava o argumento: minutos ociosos (6-10 requisições) reprovavam enquanto
minutos movimentados (20-25) passavam limpos — o oposto de sobrecarga, e a
marca de disputa instantânea.

Agora cada rota recebe um atraso escalonado de 0 a 40 segundos, distinto para
cada uma. **Nenhuma cadência muda**: cada rota roda exatamente quando rodava, só
não larga no mesmo instante que as irmãs. No pior minuto — o minuto 0 de uma
hora divisível por 30, quando `*/5`, `*/10`, `*/15` e `*/30` coincidem — o
máximo de rotas partindo juntas caiu de **onze para uma**.

O teto de 40s existe para não empurrar uma rota de cadência de 1 minuto para
dentro do tique seguinte. Coberto por `tests/shell/scheduler-entrypoint.test.sh`,
que mede o pior minuto e cobra no máximo uma partida por segundo — com controle
negativo: a primeira versão desta mudança usava passo de 5s com ciclo de 9,
tinha `sleep` em toda linha e **reintroduzia a colisão** exatamente no pior
minuto. Uma asserção que só checasse "existe algum sleep" teria passado.

Quem já roda não precisa fazer nada; a mudança chega com a imagem nova do
`scheduler`.
