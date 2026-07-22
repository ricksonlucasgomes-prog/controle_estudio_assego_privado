# Runbook — aplicação da v1.0.0 em produção

Roteiro **incremental**: sai do estado aplicado em **13/07/2026** e chega na
versão `1.0.0` (commit `82edee5`).

> Não confundir com a seção 14 da [DOCUMENTACAO.md](../DOCUMENTACAO.md), que é a
> ordem **do zero** (banco novo). Aqui o banco já existe e já tem as fases 1 e 2
> aplicadas na versão antiga.

Referência do que já foi aplicado em 13/07: papel `developer`, controle de
pedidos de equipamento, remoção das colunas de RG, hardening fases 1 e 2 e as
Edge Functions correspondentes.

---

## 0. Pré-requisitos

**Database → Extensions** — confirmar habilitadas:
`pgcrypto`, `pg_cron`, `pg_net`, `supabase_vault`.

**Vault** — criar o secret usado pelo cron do passo 6:

```sql
select vault.create_secret('<valor-forte-aqui>', 'cron_secret');
```

Guardar esse valor: ele precisa ser idêntico ao secret `CRON_SECRET` da Edge
Function `check-overdue-equipment` (passo 8).

Conferir também se `notification_worker_secret` já existe no Vault (foi criado
em 13/07 junto com o outbox):

```sql
select name from vault.secrets;
```

---

## 1 a 6. SQL Editor — rodar tudo numa sessão só

> **Não pausar entre o passo 1 e o passo 3.** Ver armadilha 3 abaixo.

| # | Arquivo | O que muda |
|---|---|---|
| 1 | `studio_booking.sql` | Dropa `requester_cpf` e `cpf`; leitura da lista por role |
| 2 | `equipment_access.sql` | Aprovador ancorado no e-mail de `auth.users`, não em `full_name` |
| 3 | `security_hardening_phase1.sql` | `create_signed_booking_v1` sem CPF + aprovador por UUID |
| 4 | `security_function_grants.sql` | Reaplica os grants das funções auxiliares |
| 5 | `data_retention.sql` | **Novo** — RPCs de retenção/eliminação + cron diário 04:30 UTC |
| 6 | `cron_overdue_equipment.sql` | **Reescrito** — usa Vault em vez de anon key embutida no SQL |

`security_hardening_phase2.sql` **não mudou** — não rodar de novo.

---

## Armadilhas

### 1. O passo 2 tem que vir antes do 3

`equipment_access.sql`, `security_hardening_phase1.sql` e
`fix_f04_approver_authz.sql` redefinem a **mesma** função
`current_user_is_lead_approver()` com `create or replace` — **vence o último que
roda**.

- `security_hardening_phase1.sql` (linha 74): ancora na tabela `lead_approvers`,
  por **UUID**. É a versão mais forte.
- `equipment_access.sql`: ancora no **e-mail** de `auth.users`.

Invertendo a ordem, a versão forte é substituída pela fraca — **sem nenhum erro
aparecer no SQL Editor**.

### 2. NÃO rodar `fix_f04_approver_authz.sql`

O conteúdo dele já está dentro de `equipment_access.sql` + `studio_booking.sql`
nas versões novas. Ele existe como hotfix isolado para um banco que **não** vai
receber o phase1 novo. Rodado depois do passo 3, sobrescreve a versão por UUID
pela versão por e-mail e desfaz parte do hardening.

### 3. Janela quebrada entre o passo 1 e o 3

O passo 1 dropa as colunas de CPF, mas a `create_signed_booking_v1` que está em
produção hoje (de 13/07) ainda tenta inserir `requester_cpf`. Nesse intervalo,
**todo agendamento novo falha**. Por isso: 1 a 6 de uma vez, sem pausa.

---

## 7. Publicar as Edge Functions

**A ordem geral é SQL → Edge Functions → frontend.** A RPC antiga *exige* CPF
(11 a 20 caracteres) e o frontend novo não envia mais; a RPC nova ignora o CPF
que o frontend antigo ainda envia. Só essa direção não quebra em nenhum momento.

8 funções mudaram na v1.0.0:

```powershell
supabase functions deploy submit-booking
supabase functions deploy decide-booking
supabase functions deploy request-access
supabase functions deploy request-equipment
supabase functions deploy studio-availability
supabase functions deploy upload-media
supabase functions deploy check-overdue-equipment
supabase functions deploy process-notification-outbox
```

---

## 8. Secrets novos

```powershell
supabase secrets set CRON_SECRET="<mesmo valor do vault cron_secret>"
supabase secrets set GOOGLE_CALENDAR_REFRESH_TOKEN="<token com escopo calendar.events>"
```

Sobre o Google Calendar (`decide-booking`):

- `GOOGLE_CALENDAR_REFRESH_TOKEN` — cria o evento no Calendar ao aprovar a
  reserva. **Sem ele, a aprovação funciona normalmente e o evento é apenas
  pulado** — não quebra nada.
- `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` — opcionais; se
  ausentes, reutiliza os do Drive (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
- `GOOGLE_CALENDAR_ID` — opcional, default `primary`. Usar o mesmo calendário do
  `STUDIO_CALENDAR_ICAL_URL` faz os horários aprovados bloquearem a
  disponibilidade automaticamente.

---

## 9. Publicar o frontend

Por último, o build web (Vercel). `npm run build` já foi validado localmente
nesta versão.

---

## 10. Conferência

```sql
-- 3 jobs esperados:
--   assego-process-notification-outbox   (*/5 * * * *)
--   check-overdue-equipment-daily        (0 13 * * *)
--   assego-purge-expired-pii-daily       (30 4 * * *)
select jobname, schedule, active from cron.job;

-- exatamente 1 aprovador principal:
select count(*) from public.lead_approvers;

-- as colunas de CPF não podem mais existir:
select column_name from information_schema.columns
where table_name in ('studio_booking_requests', 'studio_booking_participants')
  and column_name in ('requester_cpf', 'cpf', 'requester_rg', 'rg');
-- esperado: 0 linhas

-- expurgo manual, retorna o jsonb de contagens:
select public.purge_expired_booking_pii_v1(6);
```

**Teste de fumaça no app** (fluxo que já foi validado ponta a ponta em 13/07):
cadastro → agendamento → assinatura/hash → e-mail da equipe → sininho →
aprovação → e-mail do solicitante. Na v1.0.0, conferir também se o evento
aparece no Google Calendar após a aprovação.

---

## Rollback

Os scripts são idempotentes (`create or replace` / `if not exists`), mas o
passo 1 é **destrutivo**: dropar `requester_cpf` / `cpf` não tem volta pelos
scripts. Antes de começar, tirar um backup no painel
(**Database → Backups**). Como o app já não coleta CPF desde a v1.0.0, a perda
desses dados é intencional — é justamente a minimização exigida pela LGPD
(ver [LGPD.md](../LGPD.md)).

---

## Adendo — mudanças pós-1.0.0 (CPF e CEP)

Depois da v1.0.0, por decisão expressa do responsável pelo sistema, parte da
minimização foi **conscientemente revertida**:

- **21/07/2026 — CPF voltou** a ser coletado (solicitante e convidados). Ver
  `readd_booking_cpf.sql`. O RG **permanece fora**.
- **22/07/2026 — CEP passou a ser coletado** (solicitante e convidados), com
  validação de existência via **ViaCEP** no front-end e na Edge Function.

> ⚠️ A **seção 10** deste runbook está desatualizada por causa disto: a
> conferência que exige "0 linhas" para as colunas de CPF **não vale mais**.
> Agora `requester_cpf` / `cpf` **e** `requester_cep` / `cep` **devem existir**
> (só `requester_rg` / `rg` continuam ausentes).

### Aplicar a migração do CEP

1. **SQL Editor** — rodar `apply_cep_migration.sql` (script único e idempotente:
   cria as colunas `requester_cep`/`cep`, recria `create_signed_booking_v1` com o
   CEP e atualiza as funções de anonimização). *Deve retornar "Success. No rows
   returned".*
2. **Edge Functions** (terminal, CLI do Supabase):
   ```powershell
   supabase functions deploy submit-booking
   supabase functions deploy process-notification-outbox
   ```
3. **Frontend** — `git push` na `main` (o Vercel builda sozinho). Traz a máscara
   e a validação de CEP, além do popup de notificações.

Ordem obrigatória **SQL → Edge Functions → frontend**: a RPC nova aceita CEP; se
o frontend subir antes da RPC, o agendamento com CEP falharia.

### Conferência do CEP

```sql
-- as 2 colunas de CEP devem existir:
select table_name, column_name from information_schema.columns
where table_schema = 'public' and column_name in ('requester_cep', 'cep')
order by table_name;
-- esperado: studio_booking_participants.cep e studio_booking_requests.requester_cep
```

### Opcional — espelhar agendamentos no Google Sheets (tempo real)

A Edge Function `submit-booking` grava cada agendamento (com todos os dados
pessoais, inclusive CPF e CEP) numa planilha do Google Sheets, via Apps Script
Web App. **Só ativa quando os secrets estiverem definidos** — sem eles, o app
funciona normalmente e apenas não grava na planilha.

```powershell
supabase secrets set SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/.../exec"
supabase secrets set SHEETS_WEBHOOK_SECRET="<mesmo segredo do Apps Script>"
supabase functions deploy submit-booking
```

Passo a passo para criar a planilha + o Apps Script:
[google_sheets_apps_script.md](google_sheets_apps_script.md).
