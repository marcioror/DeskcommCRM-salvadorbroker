import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O CORTE DE RELEASE PULA ONDE NÃO HÁ APP — NÃO REPROVA.
 *
 * ## O defeito que este arquivo congela
 *
 * `release.yml` começa os dois jobs com `actions/create-github-app-token`,
 * lendo `secrets.RELEASE_APP_ID`. Num repositório sem esse segredo — ou seja,
 * em TODO fork que não seja o do autor — a action falha no primeiro passo:
 *
 *   Error: The 'client-id' (or deprecated 'app-id') input must be set to a
 *   non-empty string.
 *
 * E `cortar-tag` dispara em TODO push de `main`. Medido neste fork em
 * 2026-09-07: dois merges, dois e-mails de falha, cinco segundos cada — por um
 * job que nem tinha trabalho a fazer (o passo seguinte ao token é justamente
 * perguntar "este push foi um corte de release?", e a resposta é quase sempre
 * não).
 *
 * Vermelho recorrente que não significa nada é pior do que não ter aviso: ele
 * treina quem recebe a ignorar o vermelho, e o dia em que algo quebrar de
 * verdade o e-mail vai parecer com todos os outros.
 *
 * ## Por que a regra é do PRODUTO, e não uma conveniência do fork
 *
 * `relogio.yml` já resolve exatamente este problema, e o cabeçalho dele diz o
 * porquê: "NASCE DESLIGADO, e isto não é cautela decorativa: este arquivo vai
 * para a `main` de um produto self-host, e o fork de cada pessoa herda o
 * agendamento". A frase vale igual aqui — o cuidado só não tinha sido aplicado.
 * Quem clona o produto para operar a própria VPS herda `release.yml` e não tem
 * o App do autor: cortar release é ato de quem publica o produto, não de quem o
 * usa.
 *
 * ## Sem parser YAML, com controle positivo
 *
 * Mesma restrição e mesma saída dos outros guardas de workflow deste repo
 * (`preambulo-do-ci-nao-come-o-relogio`, `rodada-superada-e-cancelada`): regex
 * estreito mais um caso que prova que o instrumento enxerga alguma coisa — sem
 * ele, um regex que parou de casar devolve vazio e tudo passa por vacuidade.
 */

const YML = join(__dirname, "..", "..", ".github", "workflows", "release.yml");
const fonte = readFileSync(YML, "utf8");

/**
 * O corpo de um job de topo, de `  <nome>:` até o próximo job (2 espaços).
 *
 * ⚠️ A alternância é `    .*\n` OU `\n` — linha indentada, ou linha VAZIA. A
 * primeira versão deste extrator era `(?:    |\n).*\n`, e ela vazava: numa
 * linha em branco o `\n` casava o fim da linha e o `.*\n` seguinte engolia a
 * PRÓXIMA linha inteira, qualquer que fosse a indentação — inclusive o cabeçalho
 * do job seguinte. O corpo devolvido continha os jobs de baixo, e a asserção de
 * "o segredo não aparece em `run:`" reprovou apontando para código que não era
 * o medido. Instrumento que mede demais acusa o inocente.
 */
function job(nome: string): string | null {
  const re = new RegExp(`^  ${nome}:\\n((?:    .*\\n|\\n)*)`, "m");
  return re.exec(fonte)?.[1] ?? null;
}

/** Os dois que autenticam com o App e, sem ele, morriam no primeiro passo. */
const JOBS_DO_APP = ["abrir-pr-de-release", "cortar-tag"];

describe("release.yml não reprova em fork sem o App de release", () => {
  it("o instrumento acha os jobs (guarda de vacuidade)", () => {
    // Sem isto, um job renomeado devolveria `null` e as asserções abaixo
    // reprovariam pelo motivo errado — ou, se fossem escritas com `?.`,
    // passariam sem medir nada.
    expect(job("ha-app-de-release"), "o job-portão sumiu do release.yml").not.toBeNull();
    // O extrator não pode atravessar para o job seguinte — foi o defeito da
    // primeira versão dele, e sem este caso ele volta calado.
    expect(job("ha-app-de-release")!, "o corpo do portão vazou para o job de baixo").not.toContain(
      "abrir-pr-de-release:",
    );
    for (const nome of JOBS_DO_APP) {
      expect(job(nome), `job \`${nome}\` não encontrado`).not.toBeNull();
    }
  });

  it("o portão lê o segredo por `env`, e não o imprime", () => {
    const portao = job("ha-app-de-release")!;
    // `secrets` não existe em `jobs.<id>.if` — por isso o portão é um job, e
    // por isso ele lê o segredo para dentro de `env`. Se alguém trocar por uma
    // interpolação direta no `run:`, o valor vira texto no log.
    expect(portao).toMatch(/env:\s*\n\s*APP_ID:\s*\$\{\{\s*secrets\.RELEASE_APP_ID\s*\}\}/);
    expect(portao, "o segredo não pode ser interpolado dentro do `run:`").not.toMatch(
      /run:[\s\S]*\$\{\{\s*secrets\./,
    );
    expect(portao).toMatch(/configurado=(sim|nao)/);
  });

  it.each(JOBS_DO_APP)("%s só roda quando o App está configurado", (nome) => {
    const corpo = job(nome)!;
    expect(corpo, `\`${nome}\` precisa de \`needs: ha-app-de-release\``).toMatch(
      /needs:\s*ha-app-de-release/,
    );
    expect(
      corpo,
      `\`${nome}\` precisa condicionar ao output do portão — sem isso ele reprova ` +
        "em todo fork sem o segredo, a cada push de `main`.",
    ).toMatch(/if:.*needs\.ha-app-de-release\.outputs\.configurado\s*==\s*'sim'/);
  });

  it("o gatilho de cada job continua o mesmo — o portão SOMA, não substitui", () => {
    // A condição nova não pode ter comido a antiga: `abrir-pr-de-release` é
    // manual e `cortar-tag` é de push. Trocar uma pela outra faria o corte
    // rodar na hora errada, que é pior do que o defeito consertado aqui.
    expect(job("abrir-pr-de-release")!).toMatch(/github\.event_name\s*==\s*'workflow_dispatch'/);
    expect(job("cortar-tag")!).toMatch(/github\.event_name\s*==\s*'push'/);
  });
});
