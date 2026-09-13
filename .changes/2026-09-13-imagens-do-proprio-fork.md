---
impacto: capacidade_nova
secao: alterado
titulo: O kit passa a apontar para as imagens que ESTA instalação publica
---

O `hostgator-setup-kit` trazia `ghcr.io/melgarafael` cravado como namespace das
três imagens. Num fork isso tem um efeito que não aparece em erro nenhum: o
`update.sh` reescreve `APP_IMAGE`/`WORKER_IMAGE`/`SCHEDULER_IMAGE` no `.env` a
partir de `IMG_NS`, e esses `export` vencem o que o operador tinha fixado. Um
clique em "Atualizar agora" trocava o CRM inteiro pelo código do upstream — sem
a proteção de contato e sem o módulo de imóveis — e o rollback do `agent.sh` não
cobre, porque ele volta a **imagem**, não o `git checkout`.

`IMG_NS` agora é `ghcr.io/marcioror`, e junto com ele as outras três declarações
independentes do mesmo valor: os defaults das três linhas `image:` de
`docker-compose.prod.yml`, as três `*_IMAGE` de `.env.hostgator.example`, e a
âncora de `tests/unit/namespace-das-imagens.test.ts`. São as quatro que o
próprio `_common.sh` manda trocar juntas — e o teste-âncora reprova em sete
pontos se alguém trocar só uma.

**A URL do repositório ficou de propósito apontando para o upstream** (em
`install.sh`, `comecar.sh`, `_common.sh` e nos três Dockerfiles). Ela não
participa do caminho de atualização — o `update.sh` opera sobre um checkout que
já existe, via `git fetch origin` — e trocá-la só acrescentaria superfície de
conflito a cada sincronização.

Nada muda sozinho para quem já roda: o `.env` desta instalação fixa as três
imagens, e os defaults só valem quando a variável está ausente. O que muda é o
destino do botão de atualizar, quando houver versão publicada para ele instalar.
