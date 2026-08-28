# 005 — Validar, fazer backup e deploy controlado

## Objetivo

Validar toda a feature concluída, criar backup/rollback e publicar a imagem na LAN com saúde comprovada.

## Contexto

- Repo remoto `/home/admin/termix`; depende das tasks 001–004 concluídas.
- Produção atual: compose `docker/docker-compose.local.yml`, container `termix`, image `docker-termix`, volume persistente descoberto por inspect, portas 8080/8443, HTTPS self-signed.
- Dump permanece em `/tmp/termix-core-dumps/termix-core-20260826-021512.22` e não entra no build.
- Usuário autorizou execução sequencial e deploy final; nenhum commit/push/stage é autorizado.

## Escopo

- Rodar schema/check/type/lint/testes backend+frontend/build core sequencial em Node 24; corrigir falhas introduzidas antes de deploy.
- Smoke temporário com DB novo, migration duas vezes, health, scheduler start/stop, REST auth e assets Sessions.
- Verificar command injection/marker mismatch/cross-user/viewer forged input/log redaction e ausência de processos/containers órfãos.
- Corrigir propagação de build args Docker para flags atuais e excluir `.codex`, `.opencode`, backups e core dumps do contexto/imagem.
- Capturar image ID/config/mount/logs redigidos da produção.
- Resolver volume real via `docker inspect`; criar backup tar timestampado read-only em `/home/admin/termix/backups`; validar tamanho/listagem/checksum sem expor conteúdo.
- Taggear imagem atual como rollback timestampado.
- Build candidate sem parar produção; smoke candidate com DATA_DIR temporário/portas únicas.
- Se tudo saudável, atualizar apenas `termix` via compose, sem recriar/remover volume e sem prune. Aguardar health e verificar 8080/8443/login/health/assets Sessions/migration sem loop.
- Se falhar, restaurar imagem rollback e saúde; nunca restaurar DB backup sem corrupção comprovada e coordenação.
- Atualizar LOG/DEPLOY/PERSISTENT_SESSIONS com backup, image tags, health e verificação manual.

## Fora de escopo

- Commit, push, prune, remover guacd/features antigas, criar/kill tmux real automaticamente.

## Dependências

- 001, 002, 003, 004.

## Critérios de aceite

- [ ] Todos os changed-path tests/schema/type/lint/build passam.
- [ ] Candidate isolado saudável antes de produção.
- [ ] Backup verificável e rollback tag existem.
- [ ] Novo container produção healthy em 8080/8443 e UI Sessions disponível.
- [ ] Nenhum volume/image foi removido; rollback documentado.

## Verificação

```bash
npm run schema:check
NODE_OPTIONS=--max-old-space-size=1536 npm run type-check
NODE_ENV=test npx vitest run src/backend/tests/hosts/sessions src/backend/tests/database/routes/persistent-sessions.test.ts
NODE_ENV=test npx vitest run src/ui/tests/sessions src/ui/tests/shell src/ui/tests/sidebar
NODE_OPTIONS=--max-old-space-size=3072 TERMIX_BUILD_PROFILE=core npm run build
npm run lint
git diff --check
docker compose -f docker/docker-compose.local.yml config
docker ps --filter name=termix
```

Use Node 24 e registre comandos exatos de backup/candidate/deploy/rollback no LOG.
