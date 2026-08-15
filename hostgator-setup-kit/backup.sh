#!/usr/bin/env bash
# Backup: dump do banco (Supabase) + snapshot das sessões do WhatsApp.
# Supabase free NÃO tem backup automático — rode isto num cron diário.
#
#   crontab -e →  0 3 * * *  cd /caminho/deskcommcrm && bash hostgator-setup-kit/backup.sh
source "$(dirname "$0")/_common.sh"
enter_project

# O conteúdo daqui é o BANCO INTEIRO e as credenciais da sessão do WhatsApp —
# quem lê o .tgz manda mensagem como se fosse a empresa. Nasciam 644 (qualquer
# conta do servidor lia), medido em 2026-08-15.
#
# São as três pontas, porque cada uma cobre um buraco das outras: o `umask`
# alcança o dump (redirecionamento do shell), o `chmod` do diretório é a trava
# real (sem travessia, o modo dos arquivos deixa de importar) e o `chmod`
# dentro do contêiner é o único que alcança o .tgz — ele é criado pelo alpine
# rodando como root, e um `chmod` aqui fora falha com "Operation not permitted"
# para o dono do projeto.
umask 077

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
# Timestamp vem do host (não do script) pra manter determinismo do kit.
ts="$(date +%Y%m%d-%H%M%S)"

step "Dump do banco → $BACKUP_DIR/db-$ts.sql.gz"
docker run --rm postgres:17-alpine pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges \
  | gzip > "$BACKUP_DIR/db-$ts.sql.gz"
c_grn "✓ banco: $(du -h "$BACKUP_DIR/db-$ts.sql.gz" | awk '{print $1}')"

step "Snapshot das sessões do WhatsApp → $BACKUP_DIR/waha-$ts.tgz"
vol="$(dc config --volumes 2>/dev/null | grep -m1 waha-data || echo '')"
proj="$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
docker run --rm -v "${proj}_waha-data:/data:ro" -v "$BACKUP_DIR:/out" alpine:3.20 \
  sh -c "tar czf /out/waha-$ts.tgz -C /data . && chmod 600 /out/waha-$ts.tgz" 2>/dev/null \
  && c_grn "✓ sessões WhatsApp salvas" \
  || c_ylw "⚠ não achei o volume waha-data (nome pode variar). Ajuste manualmente se necessário."

# Retenção: mantém os 14 mais recentes de cada tipo.
step "Limpando backups antigos (mantém 14)"
ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/waha-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm -f
c_grn "✓ backup concluído em $BACKUP_DIR"
