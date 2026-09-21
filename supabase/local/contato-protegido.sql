-- ---- a proteção de contato ganha barreira NO BANCO (fork Salvador Broker) ----
--
-- ⚠️ O QUE ISTO CONSERTA, medido em 21/09/2026 nesta instalação.
--
-- A proteção de contato do corretor existia só na camada da aplicação:
-- `lib/contacts/visibility.ts` nula `phone_number` e `email` antes de a rota
-- responder, e todos os handlers a chamam. Isso protege quem entra pela API do
-- Next, e apenas isso.
--
-- O banco, por baixo, dizia outra coisa. A única regra sobre `public.contacts`
-- é `tenant_isolation_contacts_all`, que isola por organização e mais nada, e o
-- baseline concede `GRANT ALL ON TABLE public.contacts TO authenticated`, sem
-- recorte de coluna. Postgres não filtra coluna por RLS: quem pode ler a linha
-- lê o telefone junto.
--
-- O caminho que isso abre não é teórico, e foi conferido:
--
--   1. a Data API do projeto responde na internet (401 para anônimo, porque
--      `fn_user_org_ids` não tem grant para `anon`);
--   2. o endpoint de senha do GoTrue aceita login com a anon key, que é pública
--      por construção e já vai no bundle do navegador;
--   3. logo, um corretor com as PRÓPRIAS credenciais obtém um JWT legítimo fora
--      do app e faz `GET /rest/v1/contacts?select=phone_number`, recebendo a
--      carteira inteira da organização.
--
-- É exatamente o cenário que a proteção foi escrita para impedir, passando por
-- fora dela: a `protegerContato` protege a API do Next, e essa consulta não
-- passa pela API do Next.
--
-- ⚠️ POR QUE REVOGAR A COLUNA E NÃO A TABELA.
--
-- Sete rotas do produto leem telefone ou e-mail com o client do USUÁRIO
-- (`lib/supabase/server.ts`), não com service role: voice/calls,
-- pipelines/board, leads/import, contacts/import, contacts/duplicates,
-- ai/followups/queue e agenda/vinculos. Revogar `SELECT` da tabela derrubaria
-- as sete de uma vez. Os handlers que de fato entregam contato ao usuário
-- (contacts, conversations, messages) já falam com o banco por service role e
-- continuam íntegros: é neles que a `protegerContato` decide o que sai.
--
-- ⚠️ POR QUE A ESCRITA TAMBÉM SAI.
--
-- `UPDATE ... RETURNING phone_number` lê a coluna pelo caminho da escrita, e
-- `GRANT ALL` dava update, insert e delete ao mesmo papel. Sem revogar isso, a
-- barreira de leitura seria contornável numa linha. Quem escreve contato no
-- produto é service role; as duas rotas de importação que ainda escrevem como
-- usuário são ajustadas no mesmo PR.
--
-- ⚠️ O QUE ESTA BARREIRA NÃO COBRE, escrito para não ser descoberto depois.
--
-- O corpo das mensagens continua alcançável por quem participa da conversa, e
-- um telefone digitado dentro de uma mensagem continua legível ali. Isso é do
-- produto, não desta tabela: o corretor precisa ler a conversa que atende. A
-- tabela `contacts` NÃO está na publicação do Realtime (só messages,
-- conversations, crm_leads, ai_agents, ai_agent_runs, ai_knowledge_sources e
-- crm_lead_activities), então não há vazamento por lá.
--
-- Vigiado por `tests/invariants/contato-protegido-no-banco.test.ts`.

do $$
declare
  colunas_livres text;
  sensiveis      text[] := array['phone_number', 'email', 'email_normalized'];
begin
  if to_regclass('public.contacts') is null then
    return;
  end if;

  -- As colunas que o papel `authenticated` continua lendo. A lista é derivada
  -- do catálogo, e não escrita à mão, para que coluna nova do upstream não
  -- precise de manutenção aqui. O recorte é pelo NOME, e inclui um padrão além
  -- da lista literal: coluna nova que se chame `*phone*`, `*email*`, `*cpf*` ou
  -- `*document*` nasce fechada, que é o lado seguro do erro.
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into colunas_livres
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'contacts'
     and not (column_name = any (sensiveis))
     and column_name !~* '(phone|email|cpf|document)';

  if colunas_livres is null then
    raise exception 'contacts sem coluna livre: a barreira deixaria o produto sem leitura nenhuma';
  end if;

  -- ⚠️ SÓ O `SELECT` SAI, e a escrita fica onde estava. A primeira versão deste
  -- arquivo revogava tudo, e o CI mostrou por que isso é errado aqui: o upstream
  -- trata a ACL padrão do Supabase como CONTRATO e testa em cima dela. O caso
  -- `I36` de `cliente-nasce-do-agendamento` afirma, com o motivo escrito, que
  -- `authenticated` TEM update em `contacts` e que quem recusa a escrita forjada
  -- é o BEFORE UPDATE, não a falta de privilégio. Revogar a escrita trocava o
  -- dono da recusa e quebrava a prova.
  --
  -- E revogar a escrita era desnecessário para fechar o `update … returning
  -- phone_number`: no Postgres o RETURNING exige privilégio de SELECT na coluna
  -- devolvida. Tirado o SELECT, o caminho da escrita não lê mais nada — que é o
  -- que `contato-protegido-no-banco.test.ts` mede.
  --
  -- O revoke é da TABELA e não da coluna porque `revoke select (coluna)` não
  -- subtrai de um `grant select` dado na tabela inteira, e o baseline dá `GRANT
  -- ALL`. Por isso: tira o select de tudo, devolve coluna a coluna.
  execute 'revoke select on table public.contacts from authenticated';
  execute 'revoke select on table public.contacts from anon';
  execute format('grant select (%s) on table public.contacts to authenticated', colunas_livres);

  -- service_role é quem o servidor usa; continua com tudo, e é lá que a
  -- `protegerContato` decide o que vai para a resposta.
  execute 'grant all on table public.contacts to service_role';
end $$;

-- ⚠️ `contact_field_proposals` FICOU DE FORA, e a razão foi medida.
--
-- A primeira versão deste arquivo revogava a leitura da fila de sugestões
-- inteira, com o argumento de que ela carrega telefone e e-mail PROPOSTOS num
-- campo genérico, onde não dá para recortar coluna. O CI mostrou o custo: os
-- invariantes de isolamento do upstream leem essa tabela COMO USUÁRIO para
-- provar o recorte por organização, e o revoke derrubou até o controle positivo
-- deles ("user of org A still reads their own org rows"). Não é um teste frouxo:
-- é o produto declarando que o papel `authenticated` lê aquela tabela.
--
-- Quem protege essa fila continua sendo a rota, com `filtrarPropostasVisiveis`,
-- e o caminho direto pela Data API devolve as propostas da própria organização,
-- como já devolvia antes desta barreira existir. Fechar isso exige mudar o
-- contrato da tabela no upstream, não um revoke local — e vale como proposta
-- para lá, não como divergência daqui.
