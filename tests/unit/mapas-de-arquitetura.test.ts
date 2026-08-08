import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Os mapas de `docs/architecture/` são FONTE, e ninguém os verificava.
 *
 * O item 13 do Definition of Done pede que "o mapa vivo reflita a peça nova com
 * ≥2 arestas". Até aqui isso era honra: os JSON não passavam por gate nenhum, e
 * os modos de falha são todos silenciosos —
 *
 *   - aresta apontando para um `id` que não existe (renomeou o node, esqueceu a
 *     aresta) → o render some com a ligação e o mapa passa a mentir por omissão,
 *     que é o jeito mais difícil de perceber;
 *   - node em `lane` inexistente → cai fora do desenho;
 *   - node ÓRFÃO, sem nenhuma aresta → é o oposto do que o DoD pede: a peça está
 *     no mapa e continua sendo ilha;
 *   - `mainPath` citando id morto → o fio condutor quebra.
 *
 * O gate é estrutural de propósito. Ele NÃO julga se o mapa descreve a realidade
 * do código — isso nenhum teste faz, e fingir que faz seria pior que não ter.
 * Ele garante que o mapa é internamente coerente, que é a parte verificável.
 */

const DIR = path.join(process.cwd(), "docs", "architecture");

interface Mapa {
  schema_version?: number;
  lanes?: Array<{ id: string; label: string }>;
  mainPath?: string[];
  nodes?: Array<{ id: string; lane: string; label: string }>;
  edges?: Array<{ id: string; from: string; to: string; label?: string }>;
}

const arquivos = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".architecture.json"))
  .sort();

/**
 * Mapas que descrevem desenho CONTRATADO e ainda não construído podem ter peças
 * sem aresta — `docs/architecture/README.md` diz isso de `crm-vivo` com todas as
 * letras ("é PLANTA, não fotografia"). A allowlist é de ÓRFÃOS apenas: os demais
 * casos valem para todos os arquivos, sem exceção.
 */
const PLANTA_COM_ORFAOS = new Set(["crm-vivo.architecture.json"]);

describe("mapas de arquitetura — coerência interna", () => {
  it("existe mapa para verificar (guarda de vacuidade)", () => {
    // Sem isto, apagar a pasta faria todos os casos abaixo passarem por não
    // haver o que verificar.
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it.each(arquivos)("%s é JSON válido com nodes e edges", (nome) => {
    const bruto = fs.readFileSync(path.join(DIR, nome), "utf8");
    const m = JSON.parse(bruto) as Mapa;
    expect(Array.isArray(m.nodes), `${nome} sem nodes`).toBe(true);
    expect(Array.isArray(m.edges), `${nome} sem edges`).toBe(true);
    expect(m.nodes!.length, `${nome} sem nenhuma peça`).toBeGreaterThan(0);
  });

  it.each(arquivos)("%s: toda aresta liga ids que existem", (nome) => {
    const m = JSON.parse(fs.readFileSync(path.join(DIR, nome), "utf8")) as Mapa;
    const ids = new Set(m.nodes!.map((n) => n.id));
    const quebradas = (m.edges ?? [])
      .flatMap((e) => [
        ids.has(e.from) ? null : `${e.id}: from="${e.from}"`,
        ids.has(e.to) ? null : `${e.id}: to="${e.to}"`,
      ])
      .filter((x): x is string => x !== null);
    expect(quebradas, `${nome} tem aresta para id inexistente`).toEqual([]);
  });

  it.each(arquivos)("%s: todo node está numa lane declarada", (nome) => {
    const m = JSON.parse(fs.readFileSync(path.join(DIR, nome), "utf8")) as Mapa;
    const lanes = new Set((m.lanes ?? []).map((l) => l.id));
    const fora = m.nodes!.filter((n) => !lanes.has(n.lane)).map((n) => `${n.id}→${n.lane}`);
    expect(fora, `${nome} tem node em lane inexistente`).toEqual([]);
  });

  it.each(arquivos)("%s: mainPath só cita ids que existem", (nome) => {
    const m = JSON.parse(fs.readFileSync(path.join(DIR, nome), "utf8")) as Mapa;
    const ids = new Set(m.nodes!.map((n) => n.id));
    const mortos = (m.mainPath ?? []).filter((id) => !ids.has(id));
    expect(mortos, `${nome} tem mainPath citando id morto`).toEqual([]);
  });

  it.each(arquivos)("%s: nenhuma peça é ilha — o DoD 13 pede ≥1 aresta", (nome) => {
    const m = JSON.parse(fs.readFileSync(path.join(DIR, nome), "utf8")) as Mapa;
    const ligados = new Set((m.edges ?? []).flatMap((e) => [e.from, e.to]));
    const orfaos = m.nodes!.filter((n) => !ligados.has(n.id)).map((n) => n.id);
    if (PLANTA_COM_ORFAOS.has(nome)) {
      // Dívida CONGELADA: o mapa é planta e o README declara isso. Só não pode
      // piorar — se alguém acrescentar peça solta, este número sobe e reprova.
      expect(orfaos.length, `${nome}: órfãos aumentaram além do congelado`).toBeLessThanOrEqual(4);
      return;
    }
    expect(orfaos, `${nome} tem peça sem nenhuma ligação`).toEqual([]);
  });

  it("o índice de atrito está no mapa, e com mais de duas arestas", () => {
    // O caso concreto do DoD 13 para o trabalho desta branch. Genérico demais
    // não guardaria nada: "algum mapa existe" é verdade desde sempre.
    const m = JSON.parse(
      fs.readFileSync(path.join(DIR, "indice-de-atrito.architecture.json"), "utf8"),
    ) as Mapa;
    const grau = (id: string) =>
      (m.edges ?? []).filter((e) => e.from === id || e.to === id).length;
    for (const peca of ["demandas", "fnatrito", "libradar", "toolradar", "inbox"]) {
      expect(grau(peca), `${peca} com menos de 2 arestas — é ilha pelo invariante 1`).toBeGreaterThanOrEqual(2);
    }
  });
});
