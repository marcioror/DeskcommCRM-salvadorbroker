import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { drainTick } from "@/lib/agent-engine/edge/crm/drain";
import { createLogger } from "@/lib/agent-engine/obs/logger";

/**
 * Coalescência de rajada inbound — a janela tem que DESLIZAR.
 *
 * `lib/agent-engine/env.ts` declara a intenção do knob INBOUND_DEBOUNCE_MS:
 * "mensagens do MESMO contato dentro desta janela viram UM job (responder em
 * rajada é gatilho de ban)". Debounce é espera de SILÊNCIO depois da ÚLTIMA
 * mensagem — não um cronômetro fixo disparado pela primeira.
 *
 * O defeito que estes casos congelam (issue #196, reportada por @Gervanno
 * medindo numa instalação real): `run_after` era fixado na criação do job e
 * nunca estendido. Cada mensagem que chegava depois de a janela original ter
 * vencido não achava job pendente para pegar carona, criava um job novo, e o
 * agente respondia balão por balão — 3 respostas em menos de 2 minutos, no
 * mesmo assunto. É exatamente o que o debounce existe para evitar, escapando
 * pela borda de fora da janela.
 *
 * Por que os casos manipulam `run_after`/`created_at` na mão em vez de esperar:
 * a janela real é de segundos, e um teste que dorme 8s é um teste que ninguém
 * roda. Empurrar o relógio do JOB é a mesma álgebra com custo zero.
 *
 * O que estes casos NÃO medem: o tamanho adequado da janela. Deslizar corrige
 * a SEMÂNTICA (silêncio desde a última mensagem); se 8s é pouco para o ritmo
 * de digitação de um lead real, isso é ajuste de knob por instalação, não
 * defeito de código.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:invariants` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});
const log = createLogger();

// Prefixo PRÓPRIO, e isso não é estilo — é o que impede uma falha que não
// aponta para cá. Estes arquivos rodam em SEQUÊNCIA contra o MESMO Postgres
// (`fileParallelism: false` em vitest.db.config.ts), e todo seed usa
// `on conflict (id) do nothing`. Duas suítes com o mesmo UUID não dão erro:
// a segunda simplesmente NÃO insere, herda a linha da primeira e mede outra
// coisa.
//
// Medido em 2026-08-16: a primeira versão deste arquivo usou
// `bbbbbbbb-0000-4000-8000-…`, que é o prefixo de agent-watchdog.test.ts.
// Minha `channel_sessions` entrava primeiro, com OUTRO `waha_session_name` e
// status WORKING; o insert do watchdog virava no-op; e os três casos dele
// reprovavam procurando uma sessão que nunca existiu — em outro arquivo, sem
// nenhuma menção a debounce. Antes de escolher um prefixo, rode:
//     grep -rhoE '"[0-9a-f]{8}-0000-4000-8000-' tests/invariants/*.test.ts | sort -u
const ORG = "deb0acce-0000-4000-8000-000000000001";
const CONTACT = "deb0acce-0000-4000-8000-000000000002";
const SESSION = "deb0acce-0000-4000-8000-000000000003";
const CONV = "deb0acce-0000-4000-8000-000000000004";
const MSG = "deb0acce-0000-4000-8000-000000000005";
const AGENT = "deb0acce-0000-4000-8000-000000000006";
const VERSION = "deb0acce-0000-4000-8000-000000000007";

const DEBOUNCE_MS = 8_000;
const TETO_MS = 40_000;

const KNOBS = {
  batchSize: 20,
  intervalMs: 100,
  idleIntervalMs: 100,
  debounceMs: DEBOUNCE_MS,
  debounceTetoMs: TETO_MS,
  reapTimeoutMs: 300_000,
};

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'rajada-proof', 'Rajada Proof', 'Rajada Proof')
     on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Lead Tagarela', '+5511977770002') on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'rajada-proof-session', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
    [CONV, ORG, CONTACT, SESSION],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
                           type, direction, status, body, sent_via, sent_at)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'delivered', 'oi', 'external_device', now())
     on conflict (id) do nothing`,
    [MSG, ORG, CONV, SESSION, CONTACT],
  );
  // Sem agente publicado o drain pula o turno de propósito (guarda de custo) e
  // nenhum job nasce — os casos mediriam a guarda, não a coalescência.
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, 'Agente Rajada', 'você é um atendente') on conflict (id) do nothing`,
    [AGENT, ORG],
  );
  await pool.query(
    `insert into ai_agent_versions (id, organization_id, agent_id, version_number, system_prompt,
                                    provider, model, channel_session_id, status, published_at)
     values ($1, $2, $3, 1, 'você é um atendente', 'anthropic', 'claude-sonnet-4-6', $4, 'published', now())
     on conflict (id) do nothing`,
    [VERSION, ORG, AGENT, SESSION],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSION, AGENT]);
});

beforeEach(async () => {
  await pool.query(`delete from job_queue where organization_id = $1`, [ORG]);
  await pool.query(`delete from event_log where organization_id = $1`, [ORG]);
});

afterAll(async () => {
  await pool.end();
});

async function inserirEventoInbound(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into event_log (organization_id, event_type, entity_kind, entity_id, payload, status)
     values ($1::uuid, 'ai_agent.dispatch_requested', 'message', $2::uuid,
             jsonb_build_object('organization_id', $1::text, 'conversation_id', $3::text,
                                'contact_id', $4::text, 'channel_session_id', $5::text,
                                'inbound_message_id', $2::text),
             'pending')
     returning id`,
    [ORG, MSG, CONV, CONTACT, SESSION],
  );
  return rows[0]!.id;
}

/** Jobs de turno deste contato, com quanto falta para cada um rodar. */
async function jobs(): Promise<{ id: string; faltaMs: number }[]> {
  const { rows } = await pool.query<{ id: string; falta_ms: string }>(
    `select id, extract(epoch from (run_after - now())) * 1000 as falta_ms
       from job_queue
      where organization_id = $1 and kind = 'inbound_turn'
      order by created_at`,
    [ORG],
  );
  return rows.map((r) => ({ id: r.id, faltaMs: Number(r.falta_ms) }));
}

/** Empurra o relógio do job: como se `passouMs` já tivesse decorrido. */
async function envelhecerJob(id: string, passouMs: number): Promise<void> {
  await pool.query(
    `update job_queue
        set created_at = created_at - ($2::bigint * interval '1 millisecond'),
            run_after  = run_after  - ($2::bigint * interval '1 millisecond')
      where id = $1`,
    [id, passouMs],
  );
}

describe("coalescência de rajada — a janela desliza com a última mensagem", () => {
  it("mensagem nova ESTENDE a janela do job pendente, em vez de deixá-la vencer", async () => {
    await inserirEventoInbound();
    await drainTick(pool, KNOBS, log);

    const [primeiro] = await jobs();
    expect(primeiro).toBeDefined();
    expect(primeiro!.faltaMs).toBeGreaterThan(DEBOUNCE_MS - 2_000);

    // 6s se passaram: a janela original vence em ~2s.
    await envelhecerJob(primeiro!.id, 6_000);
    const antes = (await jobs())[0]!;
    expect(antes.faltaMs).toBeLessThan(3_000);

    // Chega a segunda bolha da rajada.
    await inserirEventoInbound();
    await drainTick(pool, KNOBS, log);

    const depois = await jobs();
    // Continua UM job — a rajada não virou duas respostas.
    expect(depois).toHaveLength(1);
    expect(depois[0]!.id).toBe(primeiro!.id);
    // E a janela voltou a ser ~8s DESDE AGORA, não os ~2s que restavam.
    expect(depois[0]!.faltaMs).toBeGreaterThan(DEBOUNCE_MS - 2_000);
  });

  it("o teto impede que um contato tagarela adie a resposta para sempre", async () => {
    await inserirEventoInbound();
    await drainTick(pool, KNOBS, log);
    const [job] = await jobs();

    // O job já existe há mais tempo que o teto: nada mais pode empurrá-lo.
    await envelhecerJob(job!.id, 60_000);
    await pool.query(
      `update job_queue set run_after = now() + interval '2 seconds' where id = $1`,
      [job!.id],
    );

    await inserirEventoInbound();
    await drainTick(pool, KNOBS, log);

    const depois = await jobs();
    expect(depois).toHaveLength(1);
    // Estourado o teto, a janela NÃO é reestendida para +8s.
    expect(depois[0]!.faltaMs).toBeLessThan(3_000);
  });

  it("nunca puxa a janela para TRÁS quando o job já está agendado mais longe", async () => {
    await inserirEventoInbound();
    await drainTick(pool, KNOBS, log);
    const [job] = await jobs();

    // Alguém (retry/backoff) agendou o job para bem depois da janela.
    await pool.query(
      `update job_queue set run_after = now() + interval '30 seconds' where id = $1`,
      [job!.id],
    );

    await inserirEventoInbound();
    await drainTick(pool, KNOBS, log);

    const depois = await jobs();
    expect(depois).toHaveLength(1);
    // Continua nos ~30s: estender jamais pode virar antecipar.
    expect(depois[0]!.faltaMs).toBeGreaterThan(25_000);
  });
});
