-- 9004: a policy de imóveis passa a exigir PAPEL, e não só organização.
--
-- A 9001 criou `properties`/`properties_media` com a forma org-flat que era o
-- padrão do repo na época: uma policy `for all` cujo único predicado é
-- `organization_id in (select * from fn_user_org_ids())`. A API, desde o mesmo
-- commit, sempre foi mais estrita — `requireRole("viewer")` para ler e
-- `requireRole("agent")` para POST/PATCH/DELETE, incluindo a rota de mídia
-- (app/api/v1/properties/route.ts:35,95; [id]/route.ts:26,53,122;
-- [id]/media/route.ts:22).
--
-- Rota não é fronteira. A URL do PostgREST e a `anon key` vão para o browser
-- por construção, e o `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO
-- anon, authenticated` do baseline vale para toda tabela criada depois dele —
-- inclusive estas duas. Com o próprio JWT, um membro `viewer` alcança a tabela
-- direto, sem passar por rota nenhuma: podia criar imóvel, reescrever preço e
-- endereço, e apagar (o DELETE da API é soft, o do PostgREST não seria).
--
-- É o mesmo defeito que a 0150 do upstream fechou em 8 tabelas de configuração
-- e que a 0143 fechou em `org_guardrail_layers`; estas duas ficaram de fora
-- porque são deste fork e o gate do upstream não as conhecia. Quem as acusou
-- foi `rbac-config-ia-canais.test.ts` ("nenhuma tabela NOVA entra com policy
-- ALL só-tenancy") na fusão de 2026-08-14.
--
-- FORMA canônica do repo (a da 0143): uma policy de SELECT org-flat + uma
-- policy de escrita com `fn_role_at_least`. As policies são permissivas e se
-- somam por OR, então o `viewer` continua LENDO pela primeira, e só a segunda
-- vale para INSERT/UPDATE/DELETE. `agent` e não `admin` porque o papel que a
-- policy tem de espelhar é o da API, e lá é `agent` — apertar mais aqui
-- tiraria do corretor o cadastro de imóvel, que é o trabalho dele.
--
-- `fn_is_platform_admin()` acompanha as duas, como na 0143, senão o super-admin
-- perde acesso e o suporte cega.
--
-- Sem dado a corrigir antes: a mudança só RESTRINGE escrita, e escrita legítima
-- (API com sessão de agent+, worker com service_role que bypassa RLS) continua
-- passando. Idempotente.

do $$
declare t text;
begin
  foreach t in array array['properties', 'properties_media'] loop
    execute format('alter table public.%I enable row level security', t);

    -- A org-flat sai: enquanto ela existir, o OR das permissivas devolve o
    -- acesso que esta migration está tirando.
    execute format('drop policy if exists tenant_isolation_%s_all on public.%I', t, t);
    execute format('drop policy if exists %s_select on public.%I', t, t);
    execute format('drop policy if exists %s_agent_write on public.%I', t, t);

    execute format(
      'create policy %s_select on public.%I
         for select using (
           (organization_id in (select * from public.fn_user_org_ids()))
           or public.fn_is_platform_admin()
         )',
      t, t
    );

    execute format(
      'create policy %s_agent_write on public.%I
         using (
           public.fn_is_platform_admin()
           or ((organization_id in (select * from public.fn_user_org_ids()))
               and public.fn_role_at_least(organization_id, ''agent''))
         )
         with check (
           public.fn_is_platform_admin()
           or ((organization_id in (select * from public.fn_user_org_ids()))
               and public.fn_role_at_least(organization_id, ''agent''))
         )',
      t, t
    );

    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- O PostgREST guarda o schema em cache; sem isto as policies novas só valem no
-- próximo reload dele.
notify pgrst, 'reload schema';
