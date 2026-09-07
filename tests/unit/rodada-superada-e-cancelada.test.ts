import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * RODADA SUPERADA É CANCELADA — EM PR, E SÓ EM PR.
 *
 * ## O defeito que este arquivo congela
 *
 * Sem `concurrency`, cada push numa branch com PR aberto deixa a rodada
 * anterior correndo até o fim contra um commit que ninguém mais vai olhar.
 * Medido numa única sessão de sincronização com o upstream (2026-09-07): dois
 * `e2e` completos ficaram órfãos, ~25 min de runner cada.
 *
 * Este repositório é PRIVADO — 2.000 min/mês — e a cota já esgotou uma vez
 * (2026-08-26). O sintoma daquele dia é o que torna o desperdício caro: job que
 * não consegue INICIAR aparece como `failure` com zero passos e ~2 segundos,
 * sem log e sem anotação. Parece defeito do commit e não é. Minuto queimado à
 * toa aproxima esse estado, e ele custa uma triagem inteira.
 *
 * ## Por que um guarda, e não só a configuração
 *
 * `.github/workflows/*.yml` são arquivos que o upstream MEXE. Uma fusão que
 * sobrescreva um deles leva o bloco junto sem conflito nenhum — e a perda é
 * invisível: nada fica vermelho, o CI só volta a gastar o dobro. É o mesmo modo
 * de falha que `preambulo-do-ci-nao-come-o-relogio.test.ts` guarda para o teto
 * dos jobs, e a razão de ele existir.
 *
 * ## Sem parser YAML, com controle positivo
 *
 * `yaml`/`js-yaml` não estão nas dependências do projeto (js-yaml só como
 * transitiva do eslint) — mesma restrição, e mesma saída, do teste do teto:
 * regex estreito mais um caso que prova que o instrumento enxerga alguma coisa.
 * Sem esse controle, um regex que parou de casar devolve "não encontrei" e todas
 * as asserções seguintes passam por vacuidade.
 */

const RAIZ = join(__dirname, "..", "..");

/**
 * Os quatro que rodam em PR e custam runner.
 *
 * `release.yml` fica de FORA de propósito: ele só dispara em push de `main` e em
 * `workflow_dispatch`, e cancelar um corte de release pela metade é pior que
 * gastar o minuto. `relogio.yml` já tem o seu próprio `concurrency`
 * (`cancel-in-progress: false`, uma batida por vez) e a regra dele é outra.
 * `acolhida.yml` dispara em `opened` e só — não há rodada a superar.
 */
const FLUXOS = ["ci.yml", "e2e.yml", "perf.yml", "publish-image.yml"];

function fonte(nome: string): string {
  return readFileSync(join(RAIZ, ".github", "workflows", nome), "utf8");
}

/** O bloco `concurrency:` de TOPO — não o de um job. Ancorado em coluna 0. */
function blocoDeTopo(yml: string): string | null {
  const m = /^concurrency:\n((?:[ \t].*\n|\n)*)/m.exec(yml);
  return m ? m[1]! : null;
}

describe("rodada superada é cancelada em PR, e nunca em push de main", () => {
  it("o instrumento enxerga um bloco de topo (guarda de vacuidade)", () => {
    // Controle positivo: se o extrator quebrar, ele devolve `null` para tudo e
    // as asserções abaixo reprovariam — mas por motivo errado. Este caso separa
    // "o arquivo não tem o bloco" de "o regex parou de casar".
    expect(blocoDeTopo("concurrency:\n  group: x\n  cancel-in-progress: true\n")).toContain(
      "group: x",
    );
    expect(blocoDeTopo("jobs:\n  build:\n")).toBeNull();
    // E um `concurrency:` INDENTADO (de job) não pode ser confundido com o de
    // topo — é a diferença que faz o guarda medir a coisa certa.
    expect(blocoDeTopo("jobs:\n  build:\n    concurrency: algo\n")).toBeNull();
  });

  it.each(FLUXOS)("%s declara concurrency de topo", (nome) => {
    expect(
      blocoDeTopo(fonte(nome)),
      `${nome} perdeu o bloco \`concurrency:\` de topo. Provável causa: uma fusão com o ` +
        "upstream sobrescreveu o arquivo — o bloco é DESTE FORK e some sem conflito.",
    ).not.toBeNull();
  });

  it.each(FLUXOS)("%s agrupa por fluxo E por ref", (nome) => {
    // Sem `github.ref` no grupo, duas PRs diferentes cancelariam uma à outra —
    // e o sintoma seria "meu CI foi cancelado sozinho", sem causa visível.
    const bloco = blocoDeTopo(fonte(nome))!;
    expect(bloco).toMatch(/group:\s*\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  });

  it.each(FLUXOS)("%s só cancela quando o evento é pull_request", (nome) => {
    // A asserção que mais importa, e a que um `cancel-in-progress: true`
    // descuidado quebraria: em push de `main` (e de tag) sai a imagem publicada
    // e o histórico dos checks obrigatórios. Cancelar uma publicação pela
    // metade porque outro merge entrou atrás troca minuto de CI por imagem que
    // não existe.
    const bloco = blocoDeTopo(fonte(nome))!;
    expect(bloco).toMatch(
      /cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
    );
    expect(bloco, "`cancel-in-progress: true` cru cancelaria push de main também").not.toMatch(
      /cancel-in-progress:\s*true\s*$/m,
    );
  });
});
