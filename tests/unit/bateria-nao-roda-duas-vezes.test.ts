import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A BATERIA RODA UMA VEZ POR ENTREGA — NO PR, NÃO DE NOVO NO MERGE.
 *
 * ## A conta que motiva
 *
 * O upstream dispara `ci`, `e2e` e `perf` em `pull_request` E em `push` de
 * `main`. Lá é barato: repositório PÚBLICO, Actions ilimitado. Aqui é PRIVADO —
 * 2.000 min/mês — e a cota já esgotou uma vez (2026-08-26), com um sintoma que
 * custa triagem: job que não consegue iniciar aparece como `failure` com zero
 * passos, e parece defeito do commit.
 *
 * Medido em 2026-09-07, no dia da sincronização com a v1.16.1: 1.564 dos 2.000
 * minutos em UM dia. Por rodada: `e2e` ~65 min (duas partes paralelas, cada uma
 * cobrada), `ci` ~19, imagem ~6,5, `perf` ~4. Rodar tudo de novo no merge
 * dobrava o custo de cada entrega.
 *
 * ## O que se perde, e por que aqui vale
 *
 * O `pull_request` testa `refs/pull/N/merge`, que É o resultado da junção — o
 * merge não entra sem ter sido testado. O buraco é estreito: se um SEGUNDO PR
 * entrar depois de o primeiro mudar a `main`, ele pode ter sido medido contra
 * base vencida. Vale num repositório com um operador só, entrando um PR de cada
 * vez; não valeria num time com merges concorrentes.
 *
 * ## A metade que NÃO pode ser cortada
 *
 * `publish-image.yml` continua em push de `main`: é ele que publica a tag
 * `latest` que o `.env` da VPS puxa. Sem ela o site para de receber
 * atualização — economia que quebra o produto não é economia. Este arquivo
 * guarda os DOIS lados: que a bateria não voltou, e que a publicação não sumiu.
 * Um guarda que só olhasse o primeiro lado deixaria a "economia" seguinte levar
 * a imagem junto.
 */

const DIR = join(process.cwd(), ".github", "workflows");
const ler = (nome: string) => readFileSync(join(DIR, nome), "utf8");

/** O bloco `on:` de topo, até a próxima chave em coluna 0. */
function gatilhos(yml: string): string {
  const m = /^on:\n((?:(?:[ \t].*)?\n)*)/m.exec(yml);
  return m?.[1] ?? "";
}

const BATERIA = ["ci.yml", "e2e.yml", "perf.yml"];

describe("a bateria roda uma vez por entrega", () => {
  it("o instrumento recorta o bloco `on:` (guarda de vacuidade)", () => {
    // Sem controle, um regex que parou de casar devolve "" e TODA asserção de
    // ausência abaixo passa — verde vigiando nada.
    expect(gatilhos("on:\n  pull_request:\n\njobs:\n")).toContain("pull_request:");
    expect(gatilhos("on:\n  pull_request:\n\njobs:\n")).not.toContain("jobs:");
    for (const f of [...BATERIA, "publish-image.yml"]) {
      expect(gatilhos(ler(f)), `${f}: bloco \`on:\` não encontrado`).not.toBe("");
    }
  });

  it.each(BATERIA)("%s dispara em PR, e não de novo no push de main", (nome) => {
    const on = gatilhos(ler(nome));
    expect(on, `${nome} precisa continuar disparando em pull_request`).toMatch(/pull_request:/);
    expect(
      on,
      `${nome} voltou a disparar em push. Provável causa: uma fusão com o upstream ` +
        "reescreveu o bloco `on:` — o corte é DESTE FORK e some sem conflito. " +
        "Cada volta dessas dobra o custo de toda entrega.",
    ).not.toMatch(/^\s*push:/m);
  });

  it("a publicação da imagem CONTINUA em push de main e de tag", () => {
    // O outro lado, e o que importa mais: é esta que entrega o produto à VPS.
    const on = gatilhos(ler("publish-image.yml"));
    expect(on, "sem isto o `latest` que a VPS puxa deixa de ser publicado").toMatch(/^\s*push:/m);
    expect(on).toMatch(/branches:\s*\["?main"?\]/);
    expect(on, "a tag de versão também publica").toMatch(/tags:\s*\["?v\*"?\]/);
  });
});
