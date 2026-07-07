# CONTEXTO EXTREMAMENTE DETALHADO PARA CLAUDE AI PRO

Projeto: Controle do Estudio ASSEGO PM & BM
Atualizado em: 2026-07-07
Autor deste contexto: Codex, a pedido do Lucas Rickson
Idioma de trabalho com Lucas: Portugues do Brasil, direto, pratico, sem enrolacao.

IMPORTANTE PARA CLAUDE:
Leia este arquivo inteiro antes de sugerir qualquer codigo. Este arquivo reflete o estado mais recente apos uma longa sessao de desenvolvimento, configuracao de Supabase, Google OAuth e ajustes de UI. O arquivo antigo estava desatualizado e foi substituido por este.

-------------------------------------------------------------------------------
1. RESUMO EXECUTIVO
-------------------------------------------------------------------------------

O produto e um app web privado para controlar equipamentos do estudio de podcast da ASSEGO PM & BM, em Goiania/GO.

O objetivo do sistema e:
- Reduzir perda de equipamentos.
- Registrar conferencia diaria do estudio.
- Controlar retirada e devolucao de equipamentos.
- Exigir foto obrigatoria ao retirar equipamento.
- Registrar observacoes com historico.
- Exibir camera ao vivo do estudio.
- Permitir login real por Supabase Auth, inclusive Google.
- Sincronizar os dados entre PC e celular usando Supabase.
- Futuramente enviar fotos para Google Drive e avisos por email/WhatsApp.

Stack atual:
- React 18.
- Vite 6.
- TypeScript 5.
- CSS puro em `src/styles.css`.
- Supabase JS `@supabase/supabase-js`.
- Supabase Auth com email/senha e Google.
- PWA simples com manifest e service worker.
- Sem Next.js.
- Sem Tailwind.
- Sem Material UI.
- Sem backend pesado no frontend.

Local atual do trabalho nesta maquina:

```text
C:\Assego\Sistema_Estúdio\app
```

Observacao importante:
O caminho informado no inicio da sessao como `C:\Produtos\SaaS` nao existe mais nesta maquina. O projeto real foi extraido para:

```text
C:\Assego\Sistema_Estúdio\app
```

O diretorio pai contem:

```text
C:\Assego\Sistema_Estúdio\AGENTS.md
C:\Assego\Sistema_Estúdio\AGENTS.md.pdf
C:\Assego\Sistema_Estúdio\zinNOQFM
C:\Assego\Sistema_Estúdio\controle_estudio_atualizado.zip
C:\Assego\Sistema_Estúdio\app\
```

`zinNOQFM` e um ZIP sem extensao que continha o app. O arquivo `controle_estudio_atualizado.zip` estava vazio. O app foi extraido para `app`.

-------------------------------------------------------------------------------
2. PERFIL DO DONO / MODO DE TRABALHO
-------------------------------------------------------------------------------

Lucas quer execucao pratica. Ele normalmente mostra prints e pergunta "onde?", "e agora?", "assim?". Responda com passos curtos, diretos e em portugues.

O metodo combinado e estilo Fabio Akita:
- Ler contexto antes de codar.
- Fazer passos pequenos.
- Manter o app sempre rodavel.
- Validar com comando real.
- Rodar `npm.cmd run build` antes de dizer que terminou.
- Nao inventar arquitetura grande.
- Nao apagar funcionalidades existentes.
- Nao colocar secrets no frontend.
- Nao commitar ou expor segredo.
- Explicar o proximo passo de forma visual e concreta quando Lucas estiver em painel web.

Quando Lucas esta configurando Supabase/Google Cloud:
- Diga exatamente onde clicar.
- Use os nomes que aparecem na tela dele.
- Nao de explicacoes longas se ele so quer orientacao.

-------------------------------------------------------------------------------
3. ESTADO ATUAL VALIDADO
-------------------------------------------------------------------------------

O app local esta rodando em:

```text
http://127.0.0.1:5173/
```

O servidor Vite estava ativo e respondendo HTTP 200.

Comandos que foram validados:

```powershell
npm.cmd install
npm.cmd run build
```

Build passou varias vezes com sucesso.

O Supabase CLI foi instalado nesta maquina via Scoop:

```text
C:\Users\lucas\scoop\shims\supabase.exe
```

Versao instalada:

```text
2.109.0
```

Porem ainda nao ha autenticacao local do Supabase CLI:

```text
supabase projects list
```

retornou erro informando que precisa de:

```text
supabase login
```

ou `SUPABASE_ACCESS_TOKEN`.

O PATH do usuario ja contem:

```text
C:\Users\lucas\scoop\shims
```

Mas em sessoes antigas do terminal o comando `supabase` pode nao aparecer ate abrir novo PowerShell. Se necessario, use:

```powershell
$env:PATH = "$env:USERPROFILE\scoop\shims;$env:PATH"
supabase --version
```

-------------------------------------------------------------------------------
4. CREDENCIAIS E CONFIG PUBLICAS
-------------------------------------------------------------------------------

Supabase project ref:

```text
nqjaxsehplhbusrleuhd
```

Supabase URL publica:

```text
https://nqjaxsehplhbusrleuhd.supabase.co
```

Anon/publishable key publica usada no frontend:

```text
sb_publishable_jjHstcI_83IswssJOLJD3A_Tx07H8vh
```

Essa chave e publishable/anon, portanto pode estar no frontend. A seguranca real vem de RLS e politicas.

NUNCA colocar no frontend:
- Supabase service_role.
- Google Client Secret.
- Refresh token Google.
- RESEND_API_KEY.
- Tokens WhatsApp.
- Qualquer secret real.

Arquivo `.env` local atual:

```env
VITE_SUPABASE_URL=https://nqjaxsehplhbusrleuhd.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_jjHstcI_83IswssJOLJD3A_Tx07H8vh
VITE_GOOGLE_AUTH_ENABLED=true
```

Arquivo `.env.example` tambem foi atualizado com:

```env
VITE_SUPABASE_URL=https://nqjaxsehplhbusrleuhd.supabase.co
VITE_SUPABASE_ANON_KEY=cole_a_anon_public_key_aqui
VITE_ACCESS_REQUEST_ENDPOINT=
VITE_GOOGLE_AUTH_ENABLED=true
```

Observacao:
`VITE_ACCESS_REQUEST_ENDPOINT` e opcional. Se vazio, o app usa:

```text
VITE_SUPABASE_URL/functions/v1/request-access
```

-------------------------------------------------------------------------------
5. GOOGLE LOGIN / SUPABASE AUTH
-------------------------------------------------------------------------------

O login com Google foi configurado no Supabase Dashboard.

Erro inicial que ocorreu ao clicar em "Entrar com Google":

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

Causa:
Provider Google ainda estava desabilitado no Supabase.

Depois Lucas configurou:
- Supabase > Authentication > Sign In / Providers > Supabase Auth > Auth Providers > Google.
- Google ficou `Enabled`.
- Foi criado OAuth Client no Google Cloud.
- Foi configurado callback URL:

```text
https://nqjaxsehplhbusrleuhd.supabase.co/auth/v1/callback
```

No Google Cloud, Lucas passou pela nova interface "Google Auth Platform".
Menus vistos:
- Visao geral.
- Branding.
- Publico-alvo.
- Clientes.
- Acesso a dados.
- Central de verificacao.
- Configuracoes.

No Branding, o dominio autorizado precisou ser corrigido:
- `www.assego.com.br` deu erro.
- O correto e usar dominio privado de nivel superior:

```text
assego.com.br
```

O Google reclamou de dominio ausente `studiovisualacademy.com` porque em algum campo anterior havia esse dominio. Lucas disse que corrigiu tudo.

O Google OAuth client foi criado e exibiu Client ID e Client Secret em print.

SEGURANCA:
O Client Secret apareceu em print durante a conversa. Se esse print for publicado fora ou compartilhado em lugar inseguro, regenere o secret no Google Cloud. Nao escreva esse secret neste arquivo nem em codigo.

Depois de configurar, Lucas fez login com Google com sucesso e entrou no app.

Estado atual apos login:
- O usuario aparece como:

```text
Lucas Rickson - visualizacao
```

Isso significa que a autenticacao funcionou, mas a tabela `profiles` ainda tem role `viewer` para o usuario dele.

O app ja tem regra no schema para que novos usuarios com email `ricksonlucasgomes@gmail.com` sejam `admin`, mas isso so vale apos rodar o SQL atualizado. Como o usuario ja existe, precisa rodar update manual uma vez.

SQL necessario AGORA para promover Lucas:

```sql
update public.profiles p
set role = 'admin', full_name = 'Lucas Rickson'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'ricksonlucasgomes@gmail.com';
```

Depois:
- Clicar em Sair.
- Entrar de novo com Google.
- Ou atualizar com Ctrl+F5.

Esperado:

```text
Lucas Rickson - admin
```

-------------------------------------------------------------------------------
6. ESTRUTURA DE ARQUIVOS ATUAL
-------------------------------------------------------------------------------

Arquivos principais:

```text
index.html
vite.config.ts
tsconfig.json
package.json
package-lock.json
netlify.toml
.env
.env.example
CLAUDE_PROJECT_CONTEXT.md
AGENTS.md
README.md

public/
  logo.png
  manifest.webmanifest
  sw.js
  icon-192.png
  icon-512.png
  icon-maskable-512.png
  apple-touch-icon.png

src/
  main.tsx
  App.tsx
  supabase.ts
  studioApi.ts
  styles.css
  vite-env.d.ts

supabase/
  schema.sql
  seed.sql
  functions/
    upload-media/
      index.ts
    request-access/
      index.ts
```

Atencao:
Nao ha `.git` dentro de `C:\Assego\Sistema_Estúdio\app` no estado extraido. `git status` nao funciona ali. O projeto veio de ZIP. Se for continuar em Claude, confirme se Lucas quer inicializar git, conectar ao repo remoto ou trabalhar nesta pasta.

Repositorio GitHub informado no AGENTS:

```text
ricksonlucasgomes-prog/controle_estudio_assego_privado
```

Branch de producao:

```text
main
```

Vercel producao:

```text
https://controle-estudio-assego-privado.vercel.app/
```

Netlify antigo:
Existe como legado. Nao desligar sem autorizacao do Lucas.

-------------------------------------------------------------------------------
7. CODIGO ALTERADO NA SESSAO
-------------------------------------------------------------------------------

7.1 `src/studioApi.ts`

Criado para tirar persistencia de dentro do `App.tsx` e centralizar acesso ao Supabase.

Exporta tipos:
- `Checkout`
- `MediaItem`
- `ConferenceRecord`
- `ObservationRecord`
- `NotificationEvent`
- `StudioState`

Exporta constantes:
- `STUDIO_KEY = 'assego-studio-state-v2'`
- `DEFAULT_DRIVE_FOLDER`
- `emptyStudioState`

Exporta funcoes:
- `writeLocalStudio(value)`
- `loadStudio()`
- `setCheck(itemId, checked, userId)`
- `resetChecks(itemIds, userId)`
- `upsertCheckout(itemId, checkout)`
- `deleteCheckout(itemId)`
- `addObservation(record, userId)`
- `addConference(record, userId)`
- `addMedia(record, userId)`
- `deleteMedia(id)`

Comportamento:
- Se nao houver Supabase, usa/fica com localStorage.
- Se Supabase falhar, `loadStudio()` volta para localStorage.
- Escritas no Supabase lancam erro para o `App.tsx` tratar.

Tabelas usadas:
- `studio_checklist`
- `studio_checkouts`
- `studio_observations`
- `studio_conferences`
- `studio_media`

7.2 `src/App.tsx`

Foi atualizado para:
- Importar tipos e funcoes de `studioApi.ts`.
- Usar `writeLocalStudio(studio)` para cache local.
- Carregar dados compartilhados com `loadStudio()` apos login.
- Assinar Realtime nas 5 tabelas do estudio.
- Em mudancas Realtime, recarregar o estado pelo `loadStudio()`.
- Persistir mudancas no Supabase com atualizacao otimista.
- Manter fallback local se falhar.
- Exibir aviso curto se falhar sincronizacao:

```text
Salvo neste aparelho; sincronizacao pendente
```

Mutacoes alteradas:
- `toggleCheck()`
- `takeItem()`
- `returnItem()`
- `resetChecklist()`
- `saveConference()`
- `saveObservation()`
- `uploadMediaPhoto()`
- `removeMedia()`

Tambem foi adicionado:
- `GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true'`
- Enquanto false, o botao Google nao redireciona para erro cru do Supabase.
- Depois ficou true no `.env` local.

Fluxo `requestAccess()`:
- Existe botao "Pedir liberacao" para `viewer`.
- Chama Edge Function `request-access`.
- No momento falha porque a funcao nao foi publicada/configurada com secrets.

Mensagem atual quando falha:

```text
Nao foi possivel enviar o email. Verifique deploy/secrets da funcao.
```

7.3 Camera / YouTube

Lucas pediu para remover coisas que remetem ao YouTube e deixar visual de camera real "REC".

Limite tecnico:
Nao da para remover 100% marca/controles do YouTube dentro de iframe. O YouTube ainda pode exibir marca, titulo, overlay e controles proprios em alguns momentos.

O que foi feito:
- Adicionado `controls=0`, `modestbranding=1`, `iv_load_policy=3`, `disablekb=1`, `fs=0`.
- Criado overlay visual de camera:
  - `REC CAM 01`
  - Data/hora
  - `ASSEGO ESTUDIO`
  - `1080P - AUTO`
  - Cantos de enquadramento
  - Mira central
  - Linhas tipo scan

Arquivos:
- `src/App.tsx`
- `src/styles.css`

Classes CSS novas:
- `.camera-rec`
- `.camera-frame`
- `.camera-overlay`
- `.camera-hud`
- `.frame-corner`
- `.focus-mark`

Problema visual ainda presente:
A captura mais recente ainda mostra:
- Titulo do YouTube: "ESTUDIO | AO VIVO - LINK PRIVADO..."
- Logo/canal "Assego Oficial"
- YouTube no canto inferior.

Se Lucas insistir em remover totalmente, a resposta correta e:
Precisa trocar a origem do video para um feed web real, por exemplo:
- HLS `.m3u8`
- WebRTC
- RTSP convertido em backend para HLS/WebRTC
- Servico de camera/IP camera com player proprio

Enquanto for YouTube iframe, nao ha controle total.

7.4 Logo

Lucas enviou:

```text
C:\Users\lucas\OneDrive\Área de Trabalho\logo.png
```

Foi comparado com:

```text
C:\Assego\Sistema_Estúdio\app\public\logo.png
```

Hashes SHA256 eram iguais:

```text
71FBADBF328C466E9C3795B2E81F8F228DD59AEF6B7AAD1D055298C79B5F8A83
```

Portanto a logo da pagina ja era exatamente a imagem enviada.

Para evitar cache velho do PWA, foi atualizado:

```text
public/sw.js
```

De:

```js
const CACHE = 'assego-estudio-v1';
```

Para:

```js
const CACHE = 'assego-estudio-v2';
```

7.5 Supabase schema

`supabase/schema.sql` foi atualizado com:
- Regra no trigger `handle_new_user()`:

```sql
case
  when lower(new.email) = 'ricksonlucasgomes@gmail.com' then 'admin'
  else 'viewer'
end
```

- Update manual para conta existente do Lucas:

```sql
update public.profiles p
set role = 'admin', full_name = 'Lucas Rickson'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'ricksonlucasgomes@gmail.com';
```

- Tabelas compartilhadas:
  - `studio_checklist`
  - `studio_checkouts`
  - `studio_observations`
  - `studio_conferences`
  - `studio_media`

- RLS habilitado nessas tabelas.
- Politicas:
  - select para qualquer autenticado.
  - escrita para `admin` e `borrower`.
- Realtime publicado com blocos `do $$ ... exception when duplicate_object then null; end $$;`

7.6 Edge Function `request-access`

Arquivo criado:

```text
supabase/functions/request-access/index.ts
```

Objetivo:
Usuario logado como `viewer` pode clicar "Pedir liberacao" e mandar email aos admins.

Requer secrets:

```powershell
supabase secrets set RESEND_API_KEY=... MAIL_FROM="Estudio ASSEGO <avisos@dominio>" MAIL_TO="ricksonlucasgomes@gmail.com,comunicacaoassego@gmail.com,P3dacao@gmail.com"
```

Deploy:

```powershell
supabase functions deploy request-access
```

Status:
Codigo existe, mas nao esta publicado/configurado. Por isso o botao falha no app.

7.7 Edge Function `upload-media`

Ja existia e foi lida.

Arquivo:

```text
supabase/functions/upload-media/index.ts
```

Objetivo:
- Receber foto autenticada.
- Enviar para Google Drive.
- Enviar email via Resend.

Requer secrets:

```powershell
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... DRIVE_FOLDER_ID=18cH79GjFKmY4RcAW8ngFlnd_0EEBxU7U RESEND_API_KEY=... MAIL_FROM="Estudio ASSEGO <avisos@dominio>" MAIL_TO="ricksonlucasgomes@gmail.com,comunicacaoassego@gmail.com,P3dacao@gmail.com"
```

Deploy:

```powershell
supabase functions deploy upload-media
```

Status:
Codigo existe, mas backend ainda depende de secrets e deploy.

-------------------------------------------------------------------------------
8. SUPABASE SQL A RODAR
-------------------------------------------------------------------------------

O proximo passo critico no Supabase e rodar o SQL atualizado.

Lucas precisa ir em:

```text
Supabase Dashboard > projeto controle-estudio > SQL Editor > New query
```

E rodar o conteudo de:

```text
C:\Assego\Sistema_Estúdio\app\supabase\schema.sql
```

Se ele nao quiser rodar tudo agora, o minimo para virar admin e:

```sql
update public.profiles p
set role = 'admin', full_name = 'Lucas Rickson'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'ricksonlucasgomes@gmail.com';
```

Mas para sincronizacao de dados entre aparelhos funcionar, precisa criar tambem as tabelas `studio_*`, RLS e Realtime.

IMPORTANTE:
Como existe schema antigo com tabelas `equipment`, `equipment_loans`, `checklists`, etc., rodar o arquivo inteiro usa `create table if not exists`, entao nao deve destruir essas tabelas. Mesmo assim, confira antes em producao.

-------------------------------------------------------------------------------
9. STATUS DE SINCRONIZACAO ENTRE APARELHOS
-------------------------------------------------------------------------------

Codigo frontend para sincronizar via Supabase ja foi implementado.

Mas para funcionar de verdade:
1. Rodar `supabase/schema.sql` no SQL Editor.
2. Garantir `profiles.role` correto para Lucas/admin.
3. Testar em dois navegadores/aparelhos.

Fluxo esperado apos schema:
- Admin marca checklist no PC.
- Celular recebe via Realtime ou reload.
- Admin salva observacao no PC.
- Celular ve observacao.
- Admin salva conferencia.
- Outro aparelho ve ultima conferencia.
- Retirada/devolucao sincronizam.
- Fotos ficam salvas como base64 em tabela por enquanto, nao ideal para longo prazo.

Observacao tecnica:
Atualmente `studio_media.photo` e `studio_checkouts.photo` guardam data URL/base64. Funciona, mas pode pesar o banco. Melhor futuro:
- Supabase Storage ou Google Drive para arquivo.
- Tabela guarda URL/metadados.

-------------------------------------------------------------------------------
10. STATUS DE AUTH / ROLES
-------------------------------------------------------------------------------

Tipos de role:

```ts
export type UserRole = 'admin' | 'borrower' | 'viewer';
```

No app:

```ts
const canManage = role === 'admin' || role === 'borrower';
```

`viewer`:
- Ve app.
- Nao pode salvar conferencia.
- Nao pode marcar checklist.
- Nao pode retirar.
- Nao pode observar.
- Ve banner:

```text
Seu acesso esta como visualizacao. Um admin precisa liberar seu perfil para retirar equipamentos e salvar conferencias.
```

Admin esperado:
- Lucas Rickson: `ricksonlucasgomes@gmail.com`

Emails obrigatorios de aviso:
- `ricksonlucasgomes@gmail.com`
- `comunicacaoassego@gmail.com`
- `P3dacao@gmail.com`

-------------------------------------------------------------------------------
11. PENDENCIAS IMEDIATAS
-------------------------------------------------------------------------------

Prioridade 1: promover Lucas para admin

Rodar:

```sql
update public.profiles p
set role = 'admin', full_name = 'Lucas Rickson'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'ricksonlucasgomes@gmail.com';
```

Depois:
- Sair.
- Entrar com Google.
- Confirmar topo:

```text
Lucas Rickson - admin
```

Prioridade 2: rodar schema completo

Rodar `supabase/schema.sql` para criar as tabelas `studio_*`.

Prioridade 3: testar sync real

Teste minimo:
1. Abra app no Chrome.
2. Abra app em janela anonima ou outro navegador.
3. Login com contas diferentes se possivel.
4. Marque checklist.
5. Salve observacao.
6. Salve conferencia.
7. Verifique se aparece no outro navegador.

Prioridade 4: publicar Edge Function `request-access`

Necessita:
- `supabase login`
- `supabase link --project-ref nqjaxsehplhbusrleuhd`
- Configurar Resend ou outro provedor de email.
- Setar secrets.
- Deploy.

Prioridade 5: publicar Edge Function `upload-media`

Necessita:
- Google OAuth/refresh token para Drive.
- Resend.
- Secrets.
- Deploy.
- `VITE_UPLOAD_ENDPOINT` no frontend/Vercel.

-------------------------------------------------------------------------------
12. COMANDOS IMPORTANTES
-------------------------------------------------------------------------------

Rodar local:

```powershell
cd "C:\Assego\Sistema_Estúdio\app"
npm.cmd run dev
```

Build:

```powershell
cd "C:\Assego\Sistema_Estúdio\app"
npm.cmd run build
```

Supabase CLI nesta sessao, se PATH nao recarregou:

```powershell
$env:PATH = "$env:USERPROFILE\scoop\shims;$env:PATH"
supabase --version
```

Login Supabase CLI:

```powershell
supabase login
```

Linkar projeto:

```powershell
supabase link --project-ref nqjaxsehplhbusrleuhd
```

Deploy da funcao request-access:

```powershell
supabase functions deploy request-access
```

Deploy da funcao upload-media:

```powershell
supabase functions deploy upload-media
```

Secrets request-access:

```powershell
supabase secrets set RESEND_API_KEY="..." MAIL_FROM="Estudio ASSEGO <avisos@dominio>" MAIL_TO="ricksonlucasgomes@gmail.com,comunicacaoassego@gmail.com,P3dacao@gmail.com"
```

Secrets upload-media:

```powershell
supabase secrets set GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." GOOGLE_REFRESH_TOKEN="..." DRIVE_FOLDER_ID="18cH79GjFKmY4RcAW8ngFlnd_0EEBxU7U" RESEND_API_KEY="..." MAIL_FROM="Estudio ASSEGO <avisos@dominio>" MAIL_TO="ricksonlucasgomes@gmail.com,comunicacaoassego@gmail.com,P3dacao@gmail.com"
```

-------------------------------------------------------------------------------
13. UI / DESIGN ATUAL
-------------------------------------------------------------------------------

Tema:
- Azul escuro "control room".
- Cards com borda azul.
- Destaques em azul e vermelho.
- UI em portugues.
- Logo ASSEGO oficial no login/topbar.

Arquivo de estilo:

```text
src/styles.css
```

Logo:

```text
public/logo.png
```

O arquivo ja e a logo enviada por Lucas.

PWA cache:

```text
public/sw.js
const CACHE = 'assego-estudio-v2';
```

Se logo antiga aparecer:
- Ctrl+F5.
- Limpar cache.
- Em PWA instalado, talvez remover/reinstalar atalho.

Camera:
- Usa iframe YouTube com `STREAM_ID = kSgcFevrC0o`.
- Visual customizado de `REC`.
- Ainda aparecem elementos YouTube por limitacao do iframe.

Se for melhorar:
- Considerar mascarar um pouco melhor, mas nao prometer remover total.
- Solucao real e feed de camera sem YouTube.

-------------------------------------------------------------------------------
14. OBSERVACOES SOBRE ARQUIVOS E ENCODING
-------------------------------------------------------------------------------

O arquivo `C:\Assego\Sistema_Estúdio\AGENTS.md` exibiu texto com mojibake em PowerShell (`EstÃºdio`, etc.), provavelmente por encoding. Este arquivo novo foi escrito principalmente em ASCII para evitar problemas.

Ao editar codigo:
- Identificadores sem acento.
- Textos UI podem ter acento, mas o projeto ja usa muitos textos sem acento.
- Mantenha consistencia.

-------------------------------------------------------------------------------
15. RISCOS E CUIDADOS
-------------------------------------------------------------------------------

1. Nao use service_role no frontend.

2. Nao salve Google Client Secret no repo.
O secret apareceu em print. Se houver risco de exposicao, oriente Lucas a regenerar no Google Cloud.

3. Nao prometa remover YouTube completamente enquanto for iframe YouTube.

4. Cuidado com base64 no banco.
As fotos podem pesar. Funciona para MVP, mas deve migrar para Storage/Drive.

5. O botao "Pedir liberacao" falha enquanto `request-access` nao estiver deployada.
Nao tratar como bug de frontend.

6. Lucas ainda esta como viewer ate rodar SQL de promocao.

7. O app extraido nao esta em repo git nesta pasta.
Antes de commit/deploy, confirmar origem do repo e se deve inicializar/clonar.

8. Vercel ja tem env vars publicas segundo AGENTS, mas mudancas novas precisam ser conferidas:
- `VITE_GOOGLE_AUTH_ENABLED=true`
- `VITE_ACCESS_REQUEST_ENDPOINT` opcional.
- `VITE_UPLOAD_ENDPOINT` futuro.

-------------------------------------------------------------------------------
16. PROXIMO ROTEIRO RECOMENDADO PARA CLAUDE
-------------------------------------------------------------------------------

Se Lucas disser "vamos continuar", siga esta ordem:

1. Confirmar que ele rodou o SQL para virar admin.
2. Se nao rodou, guiar pelo Supabase SQL Editor.
3. Confirmar topo do app como:

```text
Lucas Rickson - admin
```

4. Rodar o schema completo se ainda nao foi rodado.
5. Testar as mutacoes:
   - checklist
   - observacao
   - conferencia
   - retirada/devolucao
6. Se der erro RLS/tabela inexistente, corrigir SQL.
7. So depois mexer em email/Drive.

Depois que admin/sync estiver funcionando:

8. Configurar Supabase CLI:

```powershell
supabase login
supabase link --project-ref nqjaxsehplhbusrleuhd
```

9. Escolher provedor de email.
Provavel recomendacao: Resend, por ser simples para Edge Function.

10. Configurar `request-access`.

11. Configurar `upload-media`.

12. Fazer deploy/push para Vercel/GitHub.

-------------------------------------------------------------------------------
17. CHECKLIST DE VERIFICACAO ANTES DE DIZER "PRONTO"
-------------------------------------------------------------------------------

Sempre validar:

```powershell
npm.cmd run build
```

Se mexer em login:
- Testar email/senha se possivel.
- Testar Google.
- Ver role no topo.

Se mexer em dados:
- Testar como admin.
- Testar como viewer.
- Testar dois navegadores.

Se mexer em Supabase:
- Conferir RLS.
- Conferir tabelas.
- Conferir Realtime.

Se mexer em Edge Function:
- Conferir secrets.
- Deploy.
- Testar chamada autenticada.
- Ver logs da funcao no Supabase.

-------------------------------------------------------------------------------
18. ULTIMA SITUACAO VISUAL REPORTADA POR LUCAS
-------------------------------------------------------------------------------

Lucas conseguiu entrar no app via Google.

Tela mostra:

```text
Lucas Rickson - visualizacao
```

Banner:

```text
Seu acesso esta como visualizacao. Um admin precisa liberar seu perfil para retirar equipamentos e salvar conferencias.
```

Ele clicou em "Pedir liberacao" e apareceu:

```text
Nao foi possivel enviar o email. Verifique deploy/secrets da funcao.
```

Isso e esperado porque a Edge Function `request-access` ainda nao foi publicada/configurada.

O proximo passo correto nao e mexer no botao. E promover Lucas via SQL.

-------------------------------------------------------------------------------
19. RESPOSTA CURTA PARA DAR AO LUCAS SE ELE PERGUNTAR "E AGORA?"
-------------------------------------------------------------------------------

"Agora falta rodar um SQL no Supabase para transformar seu usuario em admin. Va em SQL Editor > New query, cole o update do email `ricksonlucasgomes@gmail.com`, clique Run, depois saia e entre de novo no app. Quando aparecer `Lucas Rickson - admin`, continuamos testando a sincronizacao."

SQL:

```sql
update public.profiles p
set role = 'admin', full_name = 'Lucas Rickson'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'ricksonlucasgomes@gmail.com';
```

-------------------------------------------------------------------------------
20. NAO ESQUECER
-------------------------------------------------------------------------------

Este arquivo e para orientar Claude AI Pro. O arquivo `AGENTS.md` tambem existe e contem contexto geral, mas parte do estado evoluiu depois dele. Se houver conflito entre `AGENTS.md` e este arquivo quanto ao estado atual da sessao, este arquivo e mais recente.

Ainda assim, nao ignore `AGENTS.md`: ele contem regras de produto e seguranca importantes.
