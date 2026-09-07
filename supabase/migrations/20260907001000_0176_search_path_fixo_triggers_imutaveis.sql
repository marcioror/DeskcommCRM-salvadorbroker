-- 0176 — search_path fixo nos gatilhos de imutabilidade de *_versions
--
-- O linter de segurança do Supabase (`function_search_path_mutable`) aponta
-- `fn_ai_agent_version_content_immutable` e `fn_agent_versions_immutable` sem
-- `search_path` fixado. Um `search_path` mutável deixa a função sujeita a
-- hijack por objeto homônimo criado num schema que o chamador tenha à frente de
-- `public` no seu próprio search_path.
--
-- Nenhuma das duas resolve objeto de schema por nome: a primeira só compara
-- campos de OLD/NEW; a segunda só lê `tg_table_name` (variável de trigger) e
-- chama `replace()`, embutida de `pg_catalog`, sempre resolvida independente de
-- `search_path`. Por isso `search_path = ''` fecha o vetor sem mudar
-- comportamento nenhum.
--
-- As outras 12 funções SECURITY DEFINER que o mesmo relatório listou como
-- executáveis por `authenticated` já estavam corrigidas desde a 0149 (validam a
-- organização do chamador) — não precisaram de mudança.
--
-- ⚠️ `ALTER FUNCTION`, e NÃO `create or replace` com o corpo copiado.
--
-- A primeira versão desta migration copiava o corpo inteiro das duas funções
-- para poder acrescentar o `set search_path`. Isso congela a versão do dia em
-- que foi escrita, e o estrago aparece só na fusão seguinte: doze dias depois o
-- upstream acrescentou `knowledge_source_ids` à comparação de imutabilidade da
-- primeira função, e este arquivo — por ter o carimbo mais recente de todos —
-- rodaria por ÚLTIMO e REVERTERIA o campo novo. Em silêncio: o git funde sem
-- conflito (arquivos diferentes), nenhum teste olha o corpo, e a imutabilidade
-- de `knowledge_source_ids` simplesmente deixaria de valer.
--
-- `ALTER FUNCTION` mexe só na configuração da função e é indiferente ao corpo —
-- hoje e nas próximas versões do upstream.
--
-- `ALTER FUNCTION` não aceita `IF EXISTS`, daí o guarda: a migration precisa ser
-- idempotente e sobreviver a um clone que ainda não tenha as duas funções.

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_ai_agent_version_content_immutable'
  ) then
    execute 'alter function public.fn_ai_agent_version_content_immutable() set search_path = ''''';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_agent_versions_immutable'
  ) then
    execute 'alter function public.fn_agent_versions_immutable() set search_path = ''''';
  end if;
end $$;

notify pgrst, 'reload schema';
