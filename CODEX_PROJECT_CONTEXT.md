# CODEX_PROJECT_CONTEXT

## Atualizacao - materiais do programa e transmissao

- O formulario de agendamento coleta nome do programa, formato gravado/ao vivo, orientacoes de producao, arquivos e links externos.
- Materiais enviados pelo botao usam o bucket privado booking-materials, limitado por RLS ao proprio usuario e a equipe autorizada. O email recebe links assinados temporarios; videos maiores devem ser informados por link HTTPS.
- O app nunca solicita nem envia login, senha ou codigo de verificacao do YouTube. Para programas ao vivo, coleta o link do canal e exige acesso delegado pelas permissoes do YouTube Studio.
- A ativacao em producao depende de aplicar security_hardening_phase1.sql e publicar a versao correspondente da Edge Function submit-booking antes do frontend.

---

## Atualizacao - 2026-07-13

- O formulario de acesso e gravacao informa que os dados pessoais sao solicitados pela Presidencia da ASSEGO.
- O frontend envia chaves de idempotencia nas solicitacoes de agendamento e de equipamento.
- vercel.json e netlify.toml registram cabecalhos de seguranca do frontend.
- Os scripts security_hardening_phase1.sql e security_hardening_phase2.sql e a nova submit-booking formam uma implantacao em etapas; precisam ser aplicados/publicados no Supabase antes de considerar o hardening ativo em producao.
- src-tauri e as dependencias Tauri sao o scaffold inicial do aplicativo desktop. O build web esta validado; o executavel nativo ainda depende da instalacao do Rust/Cargo e da validacao especifica do Tauri.

---

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
    submit-booking/     # recebe a solicitação assinada; notificação fica no app
    request-access/     # viewer pede liberação de acesso
    upload-media/       # upload de mídia/foto
```

`studioApi.ts` expõe: `loadStudio`, `setCheck`, `resetChecks`, `upsertCheckout`,
`deleteCheckout`, `addObservation`, `addConference`, `addMedia`, `deleteMedia`.
Escritas no Supabase lançam erro para o `App.tsx` tratar.

## 5. Papéis (roles)

Tipo: `'admin' | 'developer' | 'borrower' | 'viewer'` (`src/supabase.ts`).
No app: `isAdmin = admin || developer`; `canManage = isAdmin || borrower`.

- **developer**: só Lucas Rickson. Acesso total (equivalente a admin em tudo
  que usa `isAdmin`/`current_user_role()`), e é o **aprovador único** de
  solicitações (agendamento e retirada de equipamento) — ver
  `current_user_is_lead_approver()` em `supabase/equipment_access.sql`.
  Requer `supabase/add_developer_role.sql` (ainda não executada) para o
  CHECK da coluna `profiles.role` aceitar o valor `'developer'`.
- **admin**: papel oficial de Badu, Sérgio Vinicius e Sgt. Tiago Raiz após
  aprovação manual. Gerencia equipamento/checklist/conferência e **vê** as
  listas de solicitações (RLS de SELECT via `current_user_is_booking_approver()`),
  mas **não aprova/rejeita** — só o `developer` (Lucas) tem UPDATE liberado.
- **borrower**: pode retirar equipamento e salvar conferência.
- **viewer**: só visualiza; **não vê a aba "Conferência"** (nav filtrada por
  `visibleTabs`); pode clicar "Pedir liberação" (→ `request-access`).

Regra de promoção (todas as roles acima `viewer`): **ninguém é promovido
automaticamente**. A pessoa precisa se cadastrar no app primeiro (login
próprio via Supabase Auth); só depois disso alguém já promovido roda um
`update public.profiles set role = ...` manual no SQL Editor (ver blocos
comentados em `supabase/schema.sql`). "Serginho" é tratado só como possível
apelido de Sérgio Vinicius, nunca um quarto admin.

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
5. não dispara WhatsApp, Telegram ou n8n; a notificação é interna no app:
   Lucas (developer) e os 3 admins oficiais (Badu, Sérgio Vinicius, Sgt.
   Tiago Raiz) veem novas solicitações na aba Agenda; só Lucas aprova/rejeita.

Colunas de `studio_booking_requests`/`participants` espelham **exatamente** o
insert da função — não renomear sem ajustar `submit-booking/index.ts`.

## 8. Comandos

```bash
npm run dev     # vite --host 127.0.0.1 (porta 5173)
npm run build   # tsc -b && vite build  -> rodar SEMPRE antes de finalizar
npm run preview # vite preview (porta 4173)
```

Variáveis de ambiente (`.env`, ver `.env.example`): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_ACCESS_REQUEST_ENDPOINT`, `VITE_UPLOAD_ENDPOINT`.
O login com Google não depende mais de flag no frontend; se o provider estiver
ativo no Supabase, o botão chama o OAuth diretamente.

## 9. Estado atual e pendências

Feito e commitado (local, sem push): backend + front do agendamento com
assinatura digital; redesign ASSEGO; aba Conferência restrita a `canManage`;
URL da Edge Function via `edgeFunctionUrl` (sem hard-code); aprovadores oficiais
conseguem listar/aprovar/rejeitar solicitações dentro do app; SQLs de
agendamento já foram aplicados no Supabase; `submit-booking` já foi publicada.

**Pendente:**
1. Badu, Sérgio Vinicius e Sgt. Tiago Raiz precisam criar login próprio no
   app primeiro; só depois disso alguém promove `profiles.role = 'admin'`
   manualmente para cada um (nenhuma promoção é automática).
2. Rodar `supabase/add_developer_role.sql` para o CHECK da coluna aceitar
   `'developer'` e então promover Lucas Rickson para esse papel.
3. Testar o fluxo "Assinar e enviar solicitação" ponta a ponta com usuário
   logado, conferindo cadastro no banco e aparição no painel interno da Agenda.

## 10. Regras de ouro / cuidados

- **Nunca** colocar secrets no repositório; front só usa `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY`. WhatsApp/tokens **só** via Edge Function + secrets.
- Dados de participantes são sensíveis (**LGPD**): tratar com cuidado, não expor
  em logs públicos, RLS conforme papel.
- Commits pequenos e reversíveis; app sempre rodável; validar no navegador
  antes de dizer "pronto". Não fazer `push` sem o Lucas pedir.


---

## 11. Atualização — 2026-07-09 (sessão Cowork)

### 11.1 Aba Ao Vivo — MVP local implementado (build OK, não commitado)
- Alterados apenas `src/App.tsx` e `src/styles.css`.
- Removido o modal de câmera como único ponto de entrada; a aba agora renderiza
  direto: player YouTube fixo no topo, info do episódio, filtros
  (Todos/Ao vivo/Gravados) e lista de episódios (`PODCAST_EPISODES`, tipo
  `PodcastEpisode`, ainda só com o item fixo do `STREAM_ID`).
- Botão flutuante de áudio (`Volume2`/`VolumeX` do lucide-react) adicionado,
  alterna `audioEnabled`; sem `audioUrl` real ainda, não quebra o app.
- `cameraOn`/`liveModal`/`id: 'camera'` mantidos internamente sem refator.
- `npm.cmd run build` passou. **Nenhum commit/push feito** — aguardando
  validação visual e autorização do Lucas.

### 11.2 Redesign Fase 1 — decisão de escopo
Lucas enviou 3 prints de referência (YouTube Music, Netflix, Spotify) e
confirmou: **são referência visual/funcional/de marketing para o redesign
geral do app (Fase 1)**, não apenas para a aba Ao Vivo.

Elementos identificados em cada referência:
- **YouTube Music:** pills de categoria roláveis no topo, fileiras horizontais
  por tema ("Hits de hoje", "Playlists da comunidade"), menu lateral (drawer)
  com Início/Explorar/Biblioteca/Upgrade.
- **Netflix:** banner de destaque no topo (hero) com CTA "Assistir", fileiras
  horizontais por categoria ("Continuar assistindo como Lucas", "Top 10").
- **Spotify:** banner promocional dispensável, fileiras horizontais
  ("Músicas em alta", "Artistas populares"), barra de navegação inferior fixa.

**Decisão registrada:** fechar a direção visual completa (todas as telas,
não só Ao Vivo) antes de continuar alterando código. Ou seja: a Fase 1 do
roadmap (seção 10 da versão anterior deste doc) segue em aberto — próximo
passo é consolidar essas referências num mockup/direção única, não
implementar redesign ainda.

**Pendências que continuam de pé** (seção 9 da versão anterior): as 3
perguntas sobre visibilidade por papel, e a aprovação final do mockup da
tela inicial.
