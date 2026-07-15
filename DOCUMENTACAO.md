# Documentação Técnica — Assego Studio

Documentação de ponta a ponta do aplicativo de **agenda e controle de
equipamentos do estúdio de podcast da ASSEGO PM & BM** (Goiânia/GO).

> Documentos complementares: [`LGPD.md`](LGPD.md) (política de dados),
> `AGENTS.md` / `CLAUDE_PROJECT_CONTEXT.md` / `CODEX_PROJECT_CONTEXT.md`
> (histórico de desenvolvimento).

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Stack e arquitetura](#2-stack-e-arquitetura)
3. [Estrutura de pastas](#3-estrutura-de-pastas)
4. [Autenticação e papéis (roles)](#4-autenticação-e-papéis-roles)
5. [Funcionalidades e fluxos](#5-funcionalidades-e-fluxos)
6. [Frontend](#6-frontend)
7. [Modelo de dados e RLS](#7-modelo-de-dados-e-rls)
8. [Backend — Edge Functions](#8-backend--edge-functions)
9. [Segurança](#9-segurança)
10. [LGPD e dados pessoais](#10-lgpd-e-dados-pessoais)
11. [Variáveis de ambiente e secrets](#11-variáveis-de-ambiente-e-secrets)
12. [Como rodar e build](#12-como-rodar-e-build)
13. [Deploy](#13-deploy)
14. [Ordem de execução dos SQLs](#14-ordem-de-execução-dos-sqls)
15. [Jobs agendados (cron)](#15-jobs-agendados-cron)
16. [Limitações e pendências](#16-limitações-e-pendências)

---

## 1. Visão geral

App web privado (PWA + build desktop via Tauri) para a equipe do estúdio da
ASSEGO. Objetivos:

- **Agendar** gravações no estúdio (com regras, termo de uso e assinatura digital).
- **Controlar equipamentos**: retirada, devolução, conferência diária, foto obrigatória.
- **Solicitar** acesso/liberação de perfil e pedidos de equipamento por quem não é da equipe.
- **Notificar** a administração por e-mail e por um "sininho" dentro do app.
- Sincronizar dados entre dispositivos via Supabase (Realtime).

Produção (Vercel): `https://assegostudio.vercel.app` (e o legado
`https://controle-estudio-assego-privado.vercel.app`).

---

## 2. Stack e arquitetura

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript 5 + Vite 6, CSS puro (`src/styles.css`) |
| Ícones | `lucide-react` |
| Desktop | Tauri 2 (`src-tauri/`) — identifier `br.org.assego.studio` |
| PWA | `public/manifest.webmanifest` + `public/sw.js` |
| Backend | Supabase (Postgres + Auth + Realtime + Storage + Edge Functions Deno) |
| Auth | Supabase Auth (e-mail/senha + Google OAuth) |
| E-mail | SMTP Gmail (denomailer) nas Edge Functions; Resend opcional no `upload-media` |
| Arquivos | Supabase Storage (bucket privado `booking-materials`) e Google Drive (fotos de equipamento) |

**Arquitetura em uma frase:** o frontend fala com o Supabase (dados + auth +
realtime) diretamente para leitura protegida por RLS; **toda escrita sensível**
(agendamento, decisão, pedido de equipamento) passa por **Edge Functions** que
chamam **RPCs transacionais** `SECURITY DEFINER`, com **outbox** durável para
e-mails e **idempotência**.

```
Navegador/PWA/Tauri
   │  (anon key + JWT do usuário)
   ├──► Supabase Postgres (SELECT via RLS; Realtime nas tabelas do estúdio)
   └──► Edge Functions (Deno) ──► RPC SECURITY DEFINER (transação)
                                    ├─ grava dados + assinatura + outbox
                                    └─ app_notifications (sininho)
        Edge Function ──► SMTP/Resend (e-mail)  │
        pg_cron ──► process-notification-outbox (reprocessa e-mails)
        pg_cron ──► check-overdue-equipment (atraso de devolução)
        pg_cron ──► purge_expired_booking_pii (retenção LGPD)
```

---

## 3. Estrutura de pastas

```
src/
  main.tsx              # entrypoint React + registro do Service Worker
  App.tsx               # aplicação inteira (abas, estado, fluxos)  ~3200 linhas
  LandingPage.tsx       # página inicial / apresentação
  studioApi.ts          # acesso ao Supabase (tipos + funções de leitura/escrita)
  supabase.ts           # cliente Supabase + tipos de papel (UserRole/Profile)
  termsContent.ts       # textos dos Termos de Uso (agendamento e equipamentos)
  TermsScrollPopup.tsx  # popup de leitura obrigatória (scroll-to-accept)
  styles.css            # estilos (tema institucional ASSEGO)

public/
  manifest.webmanifest, sw.js, logo/ícones
  Termo_de_Uso_Assego.pdf   # termo v2.0 (gerado do termsContent, sem RG/CPF)

src-tauri/              # empacotamento desktop (Rust/Tauri)

supabase/
  schema.sql                      # tabelas base + profiles + RLS iniciais
  seed.sql                        # equipamentos iniciais
  studio_booking.sql              # tabelas de agendamento + RLS
  legal_signatures.sql            # trilha imutável de assinatura digital
  equipment_access.sql            # pedidos de equipamento + aprovador único
  security_hardening_phase1.sql   # RPCs, outbox, idempotência, rate limit
  security_hardening_phase2.sql   # fecha acesso direto (só via Edge/RPC)
  security_function_grants.sql    # revoga EXECUTE herdado
  add_developer_role.sql          # habilita role 'developer'
  data_retention.sql              # retenção/expurgo (LGPD) + cron
  remove_booking_rg.sql           # migração histórica (remoção de RG)
  notification_outbox_cron.sql    # cron do worker de e-mail
  cron_overdue_equipment.sql      # cron do aviso de atraso
  functions/                      # Edge Functions (Deno)
    submit-booking/               # cria agendamento assinado + e-mail
    decide-booking/               # aprova/rejeita agendamento + e-mail
    request-equipment/            # pedido de equipamento + e-mail
    request-access/               # pedido de liberação de acesso
    studio-availability/          # disponibilidade de horários (ICS)
    upload-media/                 # foto de equipamento → Drive + e-mail
    process-notification-outbox/  # worker que reprocessa e-mails
    check-overdue-equipment/      # aviso de atraso de devolução
```

---

## 4. Autenticação e papéis (roles)

Login por **Supabase Auth** (e-mail/senha ou Google). Ao criar usuário, o
trigger `handle_new_user()` cria um `profiles` com role **`viewer`** — ninguém
vira admin sozinho.

Papéis (`UserRole` em `src/supabase.ts`):

| Papel | Acesso |
|---|---|
| `viewer` | Vê o app; **não** vê PII operacional; pode pedir liberação e pedir equipamento justificando. |
| `borrower` | Equipe operacional: checklist, retirada/devolução, conferência, observações, mídia. |
| `admin` | Tudo do borrower + vê listas de agendamentos/pedidos com dados pessoais. |
| `developer` | Acesso total (equivalente a admin). Papel do desenvolvedor/dono (Lucas). |

Regras no frontend (`App.tsx`):
- `isAdmin = role === 'admin' || role === 'developer'`
- `canManage = isAdmin || role === 'borrower'`
- `isLeadApprover = isAdmin && email === LEAD_APPROVER_EMAIL`

**Aprovador único:** apenas o *lead approver* (Lucas) **aprova/rejeita**
solicitações. No backend, isso é ancorado por **UUID** na tabela
`lead_approvers` (`current_user_is_lead_approver()`), não por nome. Os demais
admins (Badu, Sérgio Vinicius, Sgt. Tiago Raiz) **veem** as listas mas não
decidem. Promoção de papel é **manual** via SQL Editor.

---

## 5. Funcionalidades e fluxos

Abas principais (`MAIN_TABS`): **Agenda**, **Ao Vivo**, **Conferência**, **Equipamento**.

### 5.1 Agenda (reserva do estúdio)
1. Usuário preenche solicitante (nome, WhatsApp, e-mail, rede social) e
   convidados (mesmos campos). **CPF e RG não são coletados.**
2. Escolhe data/horário: **regular** (seg–sex 9–17h, exceto 12h; sáb 9–12h,
   blocos de 1h) ou **excepcional após as 17h** (blocos de 30 min até 23h30).
   Disponibilidade vem da Edge Function `studio-availability` (lê um ICS).
3. Programa: nome, formato (gravado/ao vivo). Se **ao vivo**, exige link de
   canal `youtube.com` e reconhecimento de acesso por permissão delegada
   (nenhuma senha é coletada). Materiais podem ser enviados (bucket privado)
   ou informados por links `https`.
4. **Termo de Uso v2.0** em popup com *scroll-to-accept* + **assinatura
   digital** (nome completo, que deve bater com o do solicitante).
5. `submit-booking` grava tudo numa transação (RPC `create_signed_booking_v1`),
   registra a **assinatura imutável** (`legal_signatures`) com hash SHA-256 +
   IP + user-agent, cria o aviso no sininho dos admins e dispara e-mail.

### 5.2 Decisão do agendamento
O lead approver aprova/rejeita → `decide-booking` (RPC `set_booking_status_v1`)
muda o status, cria `app_notification` para o solicitante e envia e-mail de
decisão. Idempotente. **Ao aprovar**, cria automaticamente o evento no
**Google Calendar** do administrador (id do evento = UUID da reserva sem
hifens → sem duplicar; não-fatal se não configurado). Ver secrets
`GOOGLE_CALENDAR_*` na seção 11.

### 5.3 Equipamento
- **Conferência**: checklist dos equipamentos; se houver pendência, exige
  observação para liberar a conferência.
- **Retirada/devolução** (`studio_checkouts`) por admin/borrower, com foto e
  justificativa; prazo de devolução de **7 dias corridos**. A devolução move o
  registro para `studio_checkout_history` (histórico imutável).
- **Pedido de equipamento** por quem não é da equipe: `request-equipment`
  (RPC `create_equipment_request_v1`), aprovado/rejeitado só pelo lead approver.
- **Foto de equipamento** (`upload-media`): envia ao Google Drive e notifica.

### 5.4 Ao Vivo
Aba de transmissão. Atualmente exibe estado vazio ("Nenhuma transmissão
configurada") — placeholder para transmissão oficial futura.

### 5.5 Notificações
Sininho no app (`app_notifications`, com Realtime) + e-mails transacionais via
outbox. Pedido de liberação de acesso: `request-access`.

---

## 6. Frontend

- **`App.tsx`** concentra estado e telas. Cache local em `localStorage`
  (`assego-studio-state-v2`, `assego-profile-photos-v3`) como *fallback* —
  Supabase é a fonte primária. **PII de agendamento não vai para o localStorage**
  (fica só em estado React e é enviada à Edge Function).
- **`studioApi.ts`**: tipos (`BookingRequest`, `BookingParticipant`,
  `EquipmentRequest`, `AppNotification`, etc.) e funções de leitura/escrita.
  Leituras respeitam RLS; escritas sensíveis vão por Edge Function.
- **`supabase.ts`**: cria o cliente com `persistSession`, `autoRefreshToken`,
  `detectSessionInUrl`. `edgeFunctionUrl(name)` monta a URL das funções.
- **PWA**: Service Worker registrado só em produção; em dev ele é
  desregistrado e o cache limpo (evita código velho).

---

## 7. Modelo de dados e RLS

Tabelas principais (Postgres/Supabase, schema `public`):

| Tabela | Função |
|---|---|
| `profiles` | Perfil + `role`. Trigger cria como `viewer`. |
| `equipment`, `equipment_loans`, `checklists`, `checklist_items` | Modelo base de inventário. |
| `studio_checklist`, `studio_checkouts`, `studio_observations`, `studio_conferences`, `studio_media` | Estado operacional do estúdio (Realtime). |
| `studio_checkout_history` | Histórico imutável de retiradas encerradas. |
| `studio_booking_requests`, `studio_booking_participants` | Agendamentos + convidados (**sem RG/CPF**). |
| `legal_signatures` | Assinatura digital **imutável** (só INSERT do próprio + SELECT admin). |
| `studio_equipment_requests` | Pedidos de equipamento. |
| `lead_approvers` | UUID do aprovador único. |
| `notification_outbox` | Fila durável de e-mails (só service_role). |
| `app_notifications` | Sininho por usuário (Realtime). |
| `security_rate_limits` | Rate limit atômico (só service_role). |
| `audit_logs` | Trilha de auditoria (leitura só admin). |

**RLS (Row Level Security)** habilitada em todas. Padrões após o hardening:
- `viewer` **não** enxerga PII operacional nem agendamentos de terceiros.
- Solicitante vê os próprios agendamentos; admin/developer veem todos (SELECT).
- **Escrita direta bloqueada** (fase 2): inserts/updates de agendamento,
  participantes, assinatura e pedidos só acontecem via Edge Function/RPC.
- `legal_signatures`: **sem** policy de UPDATE/DELETE → imutável.

Autorização é baseada em **papel (role)** e **UUID** — nunca em `full_name`
(texto livre, falsificável). Correção do pentest F-04.

---

## 8. Backend — Edge Functions

Todas em Deno (`supabase/functions/*/index.ts`). CORS por **allowlist** de
origens; autenticação por **Bearer JWT** (exceto as de cron, por `x-cron-secret`).

| Função | O que faz | Auth |
|---|---|---|
| `submit-booking` | Valida payload, verifica materiais no Storage, rate limit, chama `create_signed_booking_v1`, envia e-mail (via outbox). | JWT |
| `decide-booking` | Aprova/rejeita via `set_booking_status_v1`, envia e-mail de decisão e, na aprovação, cria o evento no Google Calendar. | JWT (lead approver na RPC) |
| `request-equipment` | Cria pedido via `create_equipment_request_v1`, notifica admins. | JWT |
| `request-access` | E-mail aos admins pedindo liberação de perfil. | JWT |
| `studio-availability` | Lê ICS do calendário e devolve horários livres. | JWT |
| `upload-media` | Foto de equipamento → Google Drive + e-mail (HTML escapado; remetente do token). | JWT |
| `process-notification-outbox` | Worker: reprocessa e-mails pendentes/falhos. | `x-cron-secret` |
| `check-overdue-equipment` | Avisa atraso de devolução (7 dias). | `x-cron-secret` |

**RPCs transacionais** (`SECURITY DEFINER`, em `security_hardening_phase1.sql`):
`create_signed_booking_v1`, `set_booking_status_v1`,
`create_equipment_request_v1`, `set_equipment_request_status_v1`,
`consume_rate_limit_v1`. Retenção: `purge_expired_booking_pii_v1`,
`anonymize_titular_pii_v1` (em `data_retention.sql`).

---

## 9. Segurança

- **RLS** em todas as tabelas; escrita sensível só por Edge/RPC (fase 2).
- **Aprovador único por UUID** (`lead_approvers`) — corrige F-04 (autorização
  por papel/UUID, nunca por nome).
- **Assinatura digital imutável**: hash SHA-256 do payload canônico + IP +
  user-agent; tabela sem UPDATE/DELETE (não-repúdio).
- **Idempotência** (chaves por `requester_id + idempotency_key`) e **unicidade
  de horário** (advisory lock + índice) evitam duplicidade/corrida.
- **Outbox durável**: e-mail nunca some se a entrega falhar (retry com backoff).
- **Rate limit** atômico por ator/ação (`consume_rate_limit_v1`).
- **Materiais** em bucket **privado**, prefixados pelo UUID do usuário; URLs
  assinadas por tempo limitado.
- **CORS por allowlist** em todas as funções; identidade sempre do **token**,
  nunca do corpo (corrige spoofing no `upload-media`).
- **CSP e headers** restritivos no `netlify.toml`, `vercel.json` e Tauri
  (`connect-src` só do Supabase; `frame-ancestors 'none'`; `object-src 'none'`).
- **Segredos**: nada de `service_role`/secrets no frontend (só a *anon key*
  pública). Segredos ficam em Supabase Secrets/Vault.

---

## 10. LGPD e dados pessoais

Ver [`LGPD.md`](LGPD.md) para o detalhamento (bases legais, retenção, direitos
do titular). Resumo:

- **Minimização**: RG e CPF **não** são coletados. Só nome, WhatsApp, e-mail,
  rede social, data/horário + assinatura.
- **Retenção padrão: 6 meses** após a finalidade — a PII operacional é
  **anonimizada** (job diário `purge_expired_booking_pii_v1`), preservando a
  `legal_signatures` (base legal de guarda/defesa de direitos).
- **Direito do titular**: `anonymize_titular_pii_v1('<uuid>')` (restrito ao
  aprovador principal) atende pedidos de eliminação e registra em `audit_logs`.
- Canais do titular e contato ASSEGO estão no `LGPD.md`.

---

## 11. Variáveis de ambiente e secrets

**Frontend** (`.env`, prefixo `VITE_`):

| Variável | Uso |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase. |
| `VITE_SUPABASE_ANON_KEY` | Anon/publishable key (pública). |
| `VITE_ACCESS_REQUEST_ENDPOINT` | Opcional; default = `.../functions/v1/request-access`. |
| `VITE_UPLOAD_ENDPOINT` | Opcional; default = `.../functions/v1/upload-media`. |

**Secrets do backend** (Supabase Secrets — **nunca no frontend**):
`SUPABASE_SERVICE_ROLE_KEY` (injetado), `GMAIL_USER`, `GMAIL_APP_PASSWORD`,
`NOTIFICATION_WORKER_SECRET`, `CRON_SECRET`, `STUDIO_CALENDAR_ICAL_URL`,
e (para `upload-media`) `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`,
`DRIVE_FOLDER_ID`, `RESEND_API_KEY`, `MAIL_FROM/MAIL_TO`.

Para o **Google Calendar** na aprovação (`decide-booking`):
`GOOGLE_CALENDAR_REFRESH_TOKEN` (obrigatório — escopo
`calendar.events`), opcionais `GOOGLE_CALENDAR_CLIENT_ID` /
`GOOGLE_CALENDAR_CLIENT_SECRET` (senão reutiliza os do Drive) e
`GOOGLE_CALENDAR_ID` (default `primary`). Sem o refresh token, a
aprovação segue normal e o evento é apenas pulado. Dica: usar o mesmo
calendário do `STUDIO_CALENDAR_ICAL_URL` faz os horários aprovados
bloquearem a disponibilidade automaticamente.
No Vault (pg_cron): `cron_secret`, `notification_worker_secret`.

---

## 12. Como rodar e build

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # tsc -b && vite build → dist/
npm run preview  # serve o build
```

Desktop (Tauri): `npx tauri dev` / `npx tauri build` (requer toolchain Rust).

---

## 13. Deploy

- **Web**: Vercel (`vercel.json`) — build `npm run build`, saída `dist/`,
  SPA fallback. Netlify existe como legado (`netlify.toml`). Configurar as
  `VITE_*` no painel.
- **Supabase**: rodar os SQLs (seção 14), publicar as Edge Functions
  (`supabase functions deploy <nome>`), configurar Secrets e os crons.
- **Desktop**: `tauri build` gera instaladores (targets "all").
- **PWA**: servido junto do web; ao mudar assets, subir o `CACHE` em
  `public/sw.js` para invalidar cache antigo.

---

## 14. Ordem de execução dos SQLs

No **SQL Editor do Supabase**, nesta ordem:

1. `schema.sql`
2. `seed.sql` (opcional — equipamentos iniciais)
3. `studio_booking.sql`
4. `legal_signatures.sql`
5. `add_developer_role.sql` (habilita o papel `developer`)
6. `equipment_access.sql`
7. `security_hardening_phase1.sql`
8. `security_hardening_phase2.sql` *(só depois das Edge Functions publicadas e
   validadas, e com exatamente 1 `lead_approver`)*
9. `security_function_grants.sql`
10. `data_retention.sql`
11. crons: `notification_outbox_cron.sql`, `cron_overdue_equipment.sql`
    (o cron de retenção já está em `data_retention.sql`)

> Requer as extensões `pgcrypto`, `pg_cron`, `pg_net`, `supabase_vault`
> habilitadas em *Database → Extensions*.

---

## 15. Jobs agendados (cron)

| Job | Frequência | Ação |
|---|---|---|
| `assego-process-notification-outbox` | a cada 5 min | Reprocessa e-mails pendentes/falhos. |
| `check-overdue-equipment-daily` | 13h UTC (10h BRT) | Avisa atraso de devolução (7 dias). |
| `assego-purge-expired-pii-daily` | 04:30 UTC | Anonimiza PII fora da janela de retenção (6 meses). |

---

## 16. Limitações e pendências

- **Ao Vivo** é placeholder (sem transmissão embutida no momento).
- Fotos de equipamento/checkout ainda podem ser guardadas como base64 em
  tabela (aceitável p/ MVP; ideal migrar 100% para Storage/Drive).
- Endereço/telefone **institucional** da ASSEGO a publicar no `LGPD.md`.
- Manter o `Termo_de_Uso_Assego.pdf` sincronizado com `src/termsContent.ts`
  (o PDF é regenerado a partir desse texto).
- `studio-availability` não expande eventos recorrentes (RRULE) do ICS.
- Algumas Edge Functions dependem de Secrets/deploy para funcionar em produção.

---

_Última atualização desta documentação: gerada a partir do estado atual do
repositório (branch `fix/lgpd-hardening`)._
