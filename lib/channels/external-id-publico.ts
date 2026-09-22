/**
 * O `external_id` de uma mensagem na forma que pode SAIR numa resposta de API.
 *
 * ─── Por que existe ─────────────────────────────────────────────────────────
 *
 * Um dos transportes de mensagem monta o id como `{fromMe}_{chat}_{bare}`, e o
 * trecho do meio é o endereço do contato — o telefone, em texto plano, dentro
 * de um campo que ninguém classificaria como "dado de contato". `external_id`
 * não passa por `protegerContato`/`podeVerContatoSensivel` por isso mesmo, e
 * sem esta normalização o número que `/api/v1/contacts` esconde do corretor
 * voltava inteiro pela caixa de entrada dele (achado C3 da revisão final de
 * `feat/protecao-contato-corretor`).
 *
 * ─── Por que CONDICIONADO, e não corte cego ─────────────────────────────────
 *
 * A primeira versão cortava a cauda depois do último `_` em qualquer id. Isso
 * era indistinguível do certo enquanto havia um transporte só. Com o canal
 * intermediado (migration 0132) o id passou a poder ser o identificador opaco
 * do provedor — que não carrega endereço nenhum e pode ter `_` no meio.
 * Cortá-lo não esconderia nada e devolveria na resposta um id que não existe do
 * outro lado, quebrando qualquer correlação que dependa dele. Só há o que
 * esconder quando há endereço embutido; quando não há, o id sai intacto.
 *
 * ─── Fronteira ─────────────────────────────────────────────────────────────
 *
 * Mora em `lib/channels/` porque é aqui que a doutrina de restrição de canal
 * (`docs/doctrine/restricao-de-canal.md`, invariante 1) permite conhecer a
 * forma concreta de um transporte. A versão anterior fazia isto dentro de
 * `app/api/v1/messages/_handler.ts`, que é feature: o `lint:channels` reprovou,
 * e com razão — a feature passava a depender do formato de um transporte
 * específico, que é exatamente o acoplamento que o seam existe para impedir.
 *
 * Só a RESPOSTA muda. O que fica GRAVADO continua o id completo: a ingestão e o
 * dedup do ack dependem da forma exata que o webhook entrega, e normalizar na
 * escrita quebraria a correlação.
 */
import { bareWaMessageId, chatIdFromWaMessageId } from "@/lib/waha/message-id";

export function externalIdParaResposta(externalId: string | null): string | null {
  if (!externalId) return null;
  // Sem endereço embutido não há o que esconder — e cortar seria só dano.
  if (chatIdFromWaMessageId(externalId) === null) return externalId;
  return bareWaMessageId(externalId);
}
