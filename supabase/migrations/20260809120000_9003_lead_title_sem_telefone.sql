-- 9003: crm_leads.title deixa de guardar telefone (achado I2 da revisão final
-- da proteção de contato ao corretor).
--
-- `lib/leads/nascimento-do-lead.ts` usava `rotuloDoContato` para o título do
-- card do kanban. Aquela função cai para o telefone quando o contato não tem
-- `display_name`/`name` usável — decisão CERTA para EXIBIÇÃO (ver o
-- cabeçalho de `lib/contacts/rotulo-do-contato.ts`), mas ERRADA aqui: o
-- retorno virava `crm_leads.title`, uma coluna de texto plano que
-- `app/api/v1/leads/route.ts` devolve a QUALQUER viewer — inclusive um
-- corretor que não pode ver o telefone deste contato porque não foi ele quem
-- cadastrou. A proteção per-viewer de contato não alcança uma cópia solta
-- numa outra tabela: uma vez gravado ali, o número já vazou por uma porta
-- diferente da que a feature fechou.
--
-- O forward-fix (mesmo commit, `lib/leads/nascimento-do-lead.ts`) para de
-- gravar o telefone em títulos novos. Esta migration corrige as linhas que já
-- nasceram assim, em QUALQUER banco de clone — sem hardcode de organização.
--
-- ═══ POR QUE MATCH EXATO CONTRA `contacts.phone_number`, E NÃO UM REGEX ═══
--
-- A primeira versão desta migration usava um predicado regex
-- (`title ~ '^\+?[0-9]{9,}$'`), pensando estar sendo conservadora por ser
-- ancorada. A revisão apontou dois problemas que juntos a tornam destrutiva:
--
--   1. O predicado casa título LEGÍTIMO, não só telefone vazado: um CPF sem
--      formatação (11 dígitos), um CNPJ (14), um número de pedido, de
--      contrato ou de imóvel. Este produto é explicitamente multi-nicho e o
--      clone de e-commerce renomeia `deal` para "Pedido" — um negócio
--      titulado com o número puro do pedido é forma ESPERADA, não exótica.
--      O valor antigo não fica preservado em lugar nenhum: a perda é
--      silenciosa e irreversível.
--   2. `update.sh` reaplica `baseline.sql` em TODO update — então isto não é
--      uma limpeza de uma vez só, é uma regra permanente: nenhum lead pode
--      mais, para sempre, ser titulado com 9+ dígitos. Isso apaga o card de
--      um self-hoster no próximo update dele, sem erro nenhum.
--
-- O próprio mecanismo do bug dá o predicado EXATO: o título vazado é,
-- verbatim, `contacts.phone_number` — `rotuloDoContato` nunca reformata o
-- telefone (ver `lib/contacts/rotulo-do-contato.ts`, comentário de
-- `rotuloDoContato`: ele é gravado em E.164 e devolvido cru). Então em vez de
-- adivinhar pela FORMA do título, comparamos o título com o telefone do
-- PRÓPRIO contato vinculado. Isso não pode acertar por acaso um CPF, CNPJ ou
-- número de pedido — só acerta quando o título é literalmente o telefone
-- daquele contato específico, que é exatamente (e só) o que o bug produzia.
--
-- Idempotente: depois de rodar, todo título afetado vira o literal abaixo, que
-- não bate mais no predicado (deixou de ser igual ao telefone) — reexecutar
-- não encontra linha nenhuma. Portável em psql puro: sem BEGIN/COMMIT (o
-- runner já envolve em transação), sem tabela temporária. Sem hardcode de
-- organização: o `join` em `contact_id`+`organization_id` vale para qualquer
-- tenant de qualquer clone.
update public.crm_leads l
   set title = 'Novo contato pelo WhatsApp'
  from public.contacts c
 where c.id = l.contact_id
   and c.organization_id = l.organization_id
   and l.title = c.phone_number;
