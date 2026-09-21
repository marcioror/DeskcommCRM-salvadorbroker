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

  -- Revoke ANTES do grant, e da tabela inteira: `revoke select (coluna)` não
  -- subtrai de um `grant select` dado na tabela, e o baseline dá `GRANT ALL`.
  execute 'revoke all on table public.contacts from authenticated';
  execute 'revoke all on table public.contacts from anon';
  execute format('grant select (%s) on table public.contacts to authenticated', colunas_livres);

  -- service_role é quem o servidor usa; continua com tudo, e é lá que a
  -- `protegerContato` decide o que vai para a resposta.
  execute 'grant all on table public.contacts to service_role';
end $$;

-- A mesma conta para `contact_field_proposals`: a fila de sugestões da IA
-- carrega telefone e e-mail propostos em `valor`, e entregá-la crua devolveria
-- pela janela o que a porta fechou. Aqui não dá para recortar coluna (o dado
-- mora num campo genérico), então o papel perde a leitura direta inteira: quem
-- serve essa fila é a rota, que já filtra proposta sensível por
-- `filtrarPropostasVisiveis`.
do $$
begin
  if to_regclass('public.contact_field_proposals') is null then
    return;
  end if;
  execute 'revoke all on table public.contact_field_proposals from authenticated';
  execute 'revoke all on table public.contact_field_proposals from anon';
  execute 'grant all on table public.contact_field_proposals to service_role';
end $$;
