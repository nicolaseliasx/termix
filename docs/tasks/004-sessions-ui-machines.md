# 004 — Criar UI Sessions-first e integrar Machines

## Objetivo

Entregar a experiência web/mobile para criar, listar, abrir e gerenciar sessões persistentes, tornando Sessions a home autenticada.

## Contexto

- Repo remoto `/home/admin/termix`; APIs/WS/schedulers vêm das tasks 001–003.
- Shell/rail em `src/ui/AppShell.tsx` e `src/ui/sidebar/rail-items.ts`; terminal em `src/ui/features/terminal`.
- Feature flags core já existem; Sessions é core, não optional.
- Preserve tema recente e componentes atuais. Produção ainda não deve ser tocada.

## Escopo

- Cliente API/tipos/hook com AbortController, polling limitado pausado em tab oculta e mensagens de erro por code.
- Destination core `sessions`, primeira/default do rail, mobile e command palette; aproximar nav Sessions, Machines/Hosts, Proxmox, Alerts, Settings sem remover código nesta task.
- Sessions panel responsivo com nome, host, cwd, status, runtime, atividade, expiry e role.
- Create form: host, nome, cwd opcional, manual/1h/6h/24h/7d/custom.
- Ações create, writer/viewer attach, takeover, local detach, rename/expiry, kill com confirmação, adopt, refresh.
- Distinguir visualmente detach local e remote kill.
- Attach abre/reusa terminal tab com persistentSessionId/role; fechar tab envia detach e nunca DELETE.
- Machines/HostManager mostra contagem quando disponível e ações New Session/Sessions/SSH.
- Loading/empty/offline/conflict/error states e semântica acessível para mobile.
- RTL/Vitest por comportamento com accessible queries/userEvent e API mocks; não mockar React nem snapshots amplos.
- Atualizar docs/LOG.

## Fora de escopo

- Pruning de features antigas, redesign Proxmox, deploy.

## Dependências

- 001, 002, 003.

## Critérios de aceite

- [ ] Sessions é home autenticada desktop/mobile.
- [ ] Fluxos create/attach/view/takeover/detach/kill/adopt funcionam via contratos reais.
- [ ] Fechar tab nunca chama DELETE.
- [ ] Machines abre sessão e mostra contagem.
- [ ] Testes UI afetados, type-check e build core passam sem reintroduzir chunks optional.

## Verificação

```bash
NODE_ENV=test npx vitest run src/ui/tests/sessions
NODE_ENV=test npx vitest run src/ui/tests/shell src/ui/tests/sidebar
NODE_OPTIONS=--max-old-space-size=1536 npm run type-check
NODE_OPTIONS=--max-old-space-size=3072 TERMIX_BUILD_PROFILE=core npm run build
git diff --check
```

Use Node 24 isolado e preserve o tema.
