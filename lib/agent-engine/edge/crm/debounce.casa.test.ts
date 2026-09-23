/**
 * A janela DESLIZANTE com teto — o ramo desta casa em `decidirRajada` (issue
 * #196 do upstream). Os testes do upstream (`debounce.test.ts` e
 * `debounce.medicao.test.ts`) medem o ramo ancorado, chamado sem `tetoMs`; este
 * arquivo mede o que a produção daqui roda, porque `drain.ts` sempre passa o
 * teto.
 */
import { expect, it, vi } from 'vitest';
import type pg from 'pg';

import { decidirRajada } from './debounce';

const alvo = { organizationId: 'org1', contactId: 'contato1' };
const AGORA = 1_700_000_000_000;

function poolFalso(
  resposta: (sql: string) => { id: string }[],
  chamadas: { sql: string; params: unknown[] }[] = [],
): pg.Pool {
  const query = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
    chamadas.push({ sql, params });
    return { rows: resposta(sql) };
  });
  return { query } as unknown as pg.Pool;
}

it('com teto, a carona ESTENDE a janela no mesmo statement que acha o job', async () => {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const pool = poolFalso(() => [{ id: 'job-pendente' }], chamadas);

  const decisao = await decidirRajada(pool, alvo, 8_000, AGORA, 40_000);

  expect(decisao).toEqual({ tipo: 'coalescido', jobId: 'job-pendente' });
  expect(chamadas).toHaveLength(1);
  const { sql, params } = chamadas[0]!;
  expect(sql).toContain('update job_queue');
  expect(sql).toContain('returning id');
  // Estender nunca antecipa, e nunca passa do teto contado da primeira mensagem.
  expect(sql).toMatch(/greatest\(\s*run_after/);
  expect(sql).toMatch(/created_at\s*\+\s*\(\$4/);
  expect(params).toEqual(['org1', 'contato1', 8_000, 40_000]);
});

it('com teto, job em HOLD continua fora: o UPDATE não pode escrever num job morto', async () => {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const pool = poolFalso((sql) => (sql.includes('held_run_after') ? [] : [{ id: 'job-em-hold' }]), chamadas);

  const decisao = await decidirRajada(pool, alvo, 8_000, AGORA, 40_000);

  expect(chamadas[0]!.sql).toContain("not (payload ? 'held_run_after')");
  expect(decisao).toEqual({ tipo: 'enfileirar', runAfter: new Date(AGORA + 8_000) });
});

it('com teto e debounce 0, nada é consultado nem estendido', async () => {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const pool = poolFalso(() => [{ id: 'nao-deveria-ser-lido' }], chamadas);

  const decisao = await decidirRajada(pool, alvo, 0, AGORA, 40_000);

  expect(decisao).toStrictEqual({ tipo: 'enfileirar', runAfter: undefined });
  expect(chamadas).toHaveLength(0);
});
