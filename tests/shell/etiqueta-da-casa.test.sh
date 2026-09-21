#!/usr/bin/env bash
#
# `etiqueta_mais_alta_da_casa` — a escolha de versão não pode sair da linha de
# código desta instalação.
#
# ── O defeito que este arquivo prende ──────────────────────────────────────
#
# `agent.sh` e `update.sh` escolhiam a versão-alvo com
# `git tag -l 'v*' --sort=-v:refname | head -1`: a mais alta de TODAS as tags
# que o clone guarda. Um clone guarda as do upstream também — basta alguém ter
# rodado `git fetch --tags` uma vez, e o `install.sh` do próprio kit faz isso.
#
# Medido na instalação real em 2026-09-13: `main` em v1.16.1, clone guardando a
# v1.20.0 do upstream, e a escolha caindo na v1.20.0. O `git checkout` seguinte
# do `update.sh` trocaria o produto inteiro pelo código do outro repositório —
# em silêncio, com a tela dizendo "atualizado". O rollback do `agent.sh` não
# cobre: ele volta a IMAGEM, não o checkout.
#
# ── Por que o controle negativo importa aqui ───────────────────────────────
#
# Um teste que só afirma "devolveu a nossa" passa também num repositório onde a
# tag alheia nem existe — ou seja, passa sem medir nada. Por isso o caso 1
# prova, no MESMO repositório de teste, que a expressão ANTIGA devolve a tag
# alheia. Sem essa linha, este arquivo ficaria verde para sempre depois de uma
# regressão que reintroduzisse o bug.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FALHAS=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
nok()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FALHAS=$((FALHAS + 1)); }
igual() { if [ "$2" = "$3" ]; then ok "$1"; else nok "$1 — esperado '$3', veio '$2'"; fi; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# ── Um repositório com DUAS linhas de código a partir de uma base comum ─────
#
# É a forma exata de um fork: base compartilhada, e depois cada lado seguindo
# por si. A tag alheia recebe número MAIS ALTO de propósito — é assim que ela
# vence um `--sort=-v:refname` e é esse o caso que interessa.
casa="$SANDBOX/casa"
espelho="$SANDBOX/espelho.git"

git init --quiet --initial-branch=main "$casa"
git -C "$casa" config user.email teste@exemplo.invalido
git -C "$casa" config user.name  Teste

echo base > "$casa/a.txt"
git -C "$casa" add a.txt
git -C "$casa" commit --quiet -m "base comum"
git -C "$casa" tag v1.0.0

# A linha do UPSTREAM: sai da base e ganha uma tag mais alta.
git -C "$casa" checkout --quiet -b upstream
echo deles > "$casa/b.txt"
git -C "$casa" add b.txt
git -C "$casa" commit --quiet -m "commit do upstream"
git -C "$casa" tag v9.9.9

# A NOSSA linha: sai da mesma base, número menor.
git -C "$casa" checkout --quiet main
echo nosso > "$casa/c.txt"
git -C "$casa" add c.txt
git -C "$casa" commit --quiet -m "commit desta instalação"
git -C "$casa" tag v1.1.0

# `main@{upstream}` só resolve com um remote de verdade — e o nome do remote é
# DE PROPÓSITO diferente de `origin`: é o caso do fork, onde `origin` aponta
# para o upstream e o repositório do dono atende por outro nome.
git init --quiet --bare "$espelho"
git -C "$casa" remote add github-dono "$espelho"
git -C "$casa" push --quiet github-dono main
git -C "$casa" branch --quiet --set-upstream-to=github-dono/main main

printf '\n\033[1metiqueta_mais_alta_da_casa — a versão-alvo não sai da nossa linha\033[0m\n'

# ── Caso 1: CONTROLE NEGATIVO ──────────────────────────────────────────────
antiga="$(cd "$casa" && git tag -l 'v*' --sort=-v:refname | head -1)"
igual "controle: a expressão ANTIGA escolhe a tag do upstream (o defeito existe)" \
      "$antiga" "v9.9.9"

# ── Caso 2: a função nova ──────────────────────────────────────────────────
nova="$(cd "$casa" && source "$RAIZ/hostgator-setup-kit/_common.sh" >/dev/null 2>&1; etiqueta_mais_alta_da_casa)"
igual "a função escolhe a tag desta instalação, não a mais alta do clone" \
      "$nova" "v1.1.0"

# ── Caso 3: uma versão nova NOSSA passa a ser escolhida ────────────────────
#
# Prova que o filtro não é "escolha sempre a mesma": ele segue a nossa linha
# quando ela anda. Sem este caso, uma função que devolvesse constante passaria.
echo mais > "$casa/d.txt"
git -C "$casa" add d.txt
git -C "$casa" commit --quiet -m "a versão seguinte desta instalação"
git -C "$casa" tag v1.2.0
git -C "$casa" push --quiet github-dono main
depois="$(cd "$casa" && source "$RAIZ/hostgator-setup-kit/_common.sh" >/dev/null 2>&1; etiqueta_mais_alta_da_casa)"
igual "quando a nossa linha ganha versão, é ela que passa a ser escolhida" \
      "$depois" "v1.2.0"

# ── Caso 4: sem rastreamento configurado, degrada em vez de emudecer ───────
#
# Um clone raso (o `install.sh` clona com `--depth 1`) ou um remote com outro
# nome não podem fazer a função devolver VAZIO: a tela nunca mais ofereceria
# atualização, e um botão que some é mais difícil de diagnosticar que um botão
# que erra. O contrato é cair no comportamento antigo.
solto="$SANDBOX/solto"
git init --quiet --initial-branch=main "$solto"
git -C "$solto" config user.email teste@exemplo.invalido
git -C "$solto" config user.name  Teste
echo x > "$solto/a.txt"
git -C "$solto" add a.txt
git -C "$solto" commit --quiet -m "sozinho"
git -C "$solto" tag v3.0.0
degradado="$(cd "$solto" && source "$RAIZ/hostgator-setup-kit/_common.sh" >/dev/null 2>&1; etiqueta_mais_alta_da_casa)"
igual "sem ramo rastreado, devolve a mais alta em vez de vazio" \
      "$degradado" "v3.0.0"

printf '\n'
if [ "$FALHAS" -eq 0 ]; then
  printf '\033[32mtodos os casos passaram\033[0m\n'
  exit 0
fi
printf '\033[31m%s caso(s) reprovaram\033[0m\n' "$FALHAS"
exit 1
