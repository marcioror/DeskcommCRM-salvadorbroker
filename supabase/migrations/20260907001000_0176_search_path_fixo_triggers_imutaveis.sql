-- 0176: search_path fixo nos dois triggers de imutabilidade de *_versions
--
-- O linter de segurança do Supabase (function_search_path_mutable) aponta
-- `fn_ai_agent_version_content_immutable` e `fn_agent_versions_immutable` sem
-- `search_path` fixado — um `search_path` mutável deixa a função sujeita a
-- hijack por objeto homônimo criado num schema que o chamador tenha na frente
-- de `public` no seu próprio search_path.
--
-- Nenhuma das duas resolve objeto de schema por nome: a primeira só lê campos
-- de OLD/NEW; a segunda só lê `tg_table_name` (variável de trigger) e chama
-- `replace()`, função embutida de `pg_catalog`, sempre resolvida independente
-- de `search_path`. Por isso `search_path = ''` é seguro aqui: fecha o vetor
-- sem mudar comportamento nenhum. `create or replace function` preserva
-- grants e triggers já existentes — nada mais a recriar.

create or replace function public.fn_ai_agent_version_content_immutable() returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;

create or replace function public.fn_agent_versions_immutable() returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception '% é imutável: mudança = versão nova; rollback = mover o ponteiro (%)',
    tg_table_name, replace(tg_table_name, '_versions', '_pointers');
end;
$fn$;

notify pgrst, 'reload schema';
