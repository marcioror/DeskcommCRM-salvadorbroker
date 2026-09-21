#!/usr/bin/env bash
# O SQL DESTA CASA NO BANCO-MOLDE DOS INVARIANTES.
#
# ⚠️ ARQUIVO DO FORK. Existe para que `scripts/test-db.sh` tenha UMA linha nossa
# e não duas, e a razão é um gate do upstream, não estética:
# `test-db-aplica-o-baseline-num-lugar-so.test.ts` exige que a única linha do
# test-db.sh que alimenta o psql com arquivo seja a do baseline, dentro de
# `aplicar_baseline`. Ele está certo: é essa linha que grava a contagem de
# aplicações que um invariante lê depois. Uma segunda entrada por `<` ali seria
# uma aplicação que não conta.
#
# Então o `<` mora aqui, e lá fica só a chamada.
#
# Quem usa: `aplicar_baseline`, no test-db.sh, logo depois do baseline. A ordem
# importa e é a mesma da instalação real (install.sh e update.sh): primeiro o
# baseline do upstream, depois o que é nosso.
#
# Espera encontrar `psql_install` já definida pelo chamador.
aplicar_sql_local_no_molde() {
  local arquivo
  for arquivo in "${ROOT:?}"/supabase/local/*.sql; do
    [ -e "$arquivo" ] || break
    psql_install < "$arquivo"
  done
}
