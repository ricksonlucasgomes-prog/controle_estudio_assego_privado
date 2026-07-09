# CODEX_PROJECT_CONTEXT

Contexto de projeto para o **Codex** (par de IA do Lucas). Leia antes de codar.
Snapshot fiel ao estado atual em **2026-07-08**. Se algo no código divergir
deste arquivo, o **código é a fonte da verdade** — e atualize este arquivo.

> Convívio com o outro agente: `CLAUDE_PROJECT_CONTEXT.md` é um log histórico
> longo e em parte desatualizado. Este arquivo é o resumo curto e atual.
> As regras de trabalho (ritmo XP + disciplina Akita, Definition of Done)
> estão em `AGENTS.md` — valem para Codex e Claude.

---

## 1. Ambiente

- Root do projeto: `C:\Assego\Sistema_Estúdio\app`
- Repositório: https://github.com/ricksonlucasgomes-prog/Estudio_assego.git (`origin`, branch `main`)
- Projeto Supabase (ref): `nqjaxsehplhbusrleuhd` → `https://nqjaxsehplhbusrleuhd.supabase.co`
- Responsável final pelo código: **Lucas Rickson**. A IA acelera, não decide sozinha.

## 2. Produto

Sistema web **privado** para o estúdio de podcast da **ASSEGO PM & BM**. Cobre:
agenda/reserva do estúdio, cautela (retirada/devolução) de equipamentos,
conferência diária de equipamentos e câmera ao vivo. Identidade visual
institucional ASSEGO (fundo escuro, azul + amarelo, Montserrat).

## 3. Stack

- React 18 + Vite + TypeScript, CSS puro (`src/styles.css`), PWA.
- Supabase: **Auth real** (email/senha + Google OAuth) e **banco como fonte
  primária** de dados. `localStorage` é apenas **fallback** quando o Supabase
  não está configurado. Edge Functions em Deno.
- Deploy do front: Netlify/Vercel.

## 4. Estrutura de arquivos

```
src/
  App.tsx        # componente principal (abas, modal de reserva, toda a UI)
  main.tsx       # bootstrap React
  supabase.ts    # client Supabase + edgeFunctionUrl(name) + tipos de auth
  studioApi.ts   # camada de dados (Supabase primário, localStorage fallback)
  styles.css
supabase/
  schema.sql            # profiles, equipment, checklists, current_user_role(), RLS
  seed.sql
  studio_booking.sql    # studio_booking_requests + studio_booking_participants + RLS
  legal_signatures.sql  # trilha imutável de assinatura (FK -> studio_booking_requests)
  functions/
    submit-booking/     # recebe a solicitação assinada, grava e notifica (n8n)
    request-access/     # viewer pede liberação de acesso
    upload-media/       # upload de mídia/foto
```

`studioApi.ts` expõe: `loadStudio`, `setCheck`, `resetChecks`, `upsertCheckout`,
`deleteCheckout`, `addObservation`, `addConference`, `addMedia`, `deleteMedia`.
Escritas no Supabase lançam erro para o `App.tsx` tratar.

## 5. Papéis (roles)

Tipo: `'admin' | 'borrower' | 'viewer'`. No app: `canManage = admin || borrower`.

- **admin**: gerencia tudo; cria reserva direta; aprova solicitações; lê dados sensíveis.
- **borrower**: pode retirar equipamento e salvar conferência.
- **viewer**: só visualiza; **não vê a aba "Conferência"** (nav filtrada por
  `visibleTabs`); pode clicar "Pedir liberação" (→ `request-access`).

## 6. Abas (bottom-tabs)

`Agenda` (inicial) · `Câmera` · `Conferência` (só `canManage`) · `Cautela`.

- **Agenda**: Google Calendar embutido + botão que abre o modal de reserva.
- **Câmera**: abre a transmissão ao vivo em popup.
- **Conferência**: checklist de equipamentos. Regra: com pendências, o botão
  "Salvar conferência" fica desabilitado até haver observação; a observação é
  salva como `notes` da conferência **e** no histórico de observações.
- **Cautela**: retirada/devolução + mídia (fotos hoje em base64, não ideal).

## 7. Fluxo de agendamento (o mais novo/sensível)

Modal em `App.tsx` → dados do solicitante + convidados → **gate jurídico (LGPD)**
de 3 passos: (1) baixar `Termo_de_Uso_Assego.pdf` (em `/public`), (2) aceitar,
(3) assinar com nome completo. Só então o front faz `POST` em
`edgeFunctionUrl('submit-booking')` com o JWT da sessão.

A Edge Function `submit-booking`:
1. valida o JWT (usa a anon key + `Authorization` do usuário → respeita RLS);
2. grava em `studio_booking_requests` + `studio_booking_participants`;
3. grava a assinatura em `legal_signatures` (imutável) com **hash SHA-256** do
   payload canônico + **IP** (`x-forwarded-for`) + user-agent (não-repúdio);
4. **compensação**: se a assinatura falhar, desfaz a reserva (delete);
5. dispara webhook opcional para o n8n se `N8N_WEBHOOK_URL` estiver setado.

Colunas de `studio_booking_requests`/`participants` espelham **exatamente** o
insert da função — não renomear sem ajustar `submit-booking/index.ts`.

## 8. Comandos

```bash
npm run dev     # vite --host 127.0.0.1 (porta 5173)
npm run build   # tsc -b && vite build  -> rodar SEMPRE antes de finalizar
npm run preview # vite preview (porta 4173)
```

Variáveis de ambiente (`.env`, ver `.env.example`): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_AUTH_ENABLED`, `VITE_ACCESS_REQUEST_ENDPOINT`.

## 9. Estado atual e pendências

Feito e commitado (local, sem push): backend + front do agendamento com
assinatura digital; redesign ASSEGO; aba Conferência restrita a `canManage`;
URL da Edge Function via `edgeFunctionUrl` (sem hard-code).

**Pendente (precisa do acesso Supabase do Lucas):**
1. Rodar SQLs no SQL Editor **nesta ordem**: `schema.sql` → `studio_booking.sql`
   → `legal_signatures.sql`.
2. `supabase functions deploy submit-booking`.
3. (Opcional) `supabase secrets set N8N_WEBHOOK_URL="..."` para notificar.
4. Testar o fluxo "Assinar e enviar solicitação" ponta a ponta.
5. **Falta UI de admin** para listar/aprovar/rejeitar `studio_booking_requests`
   (hoje nada consome as solicitações depois de criadas).

## 10. Regras de ouro / cuidados

- **Nunca** colocar secrets no repositório; front só usa `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY`. WhatsApp/tokens **só** via Edge Function + secrets.
- Dados de participantes são sensíveis (**LGPD**): tratar com cuidado, não expor
  em logs públicos, RLS conforme papel.
- Commits pequenos e reversíveis; app sempre rodável; validar no navegador
  antes de dizer "pronto". Não fazer `push` sem o Lucas pedir.
