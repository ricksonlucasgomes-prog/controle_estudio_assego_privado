# AGENTS.md - Controle Estudio ASSEGO

## Papel do agente

Atue como par de programacao, Tech Lead e QA deste projeto. Trabalhe em pequenas entregas, sempre deixando o sistema rodavel, testavel e versionado.

## Raiz oficial

`M:\RESTRITO\Controle do Estúdio_Lucas\Sistema-controle-estudio`

Nao desenvolver em pasta temporaria do Codex.

## Metodologia Rickson para programar com IA

Sintese pessoal do Lucas Rickson: o ritmo do XP + a disciplina do metodo Fabio Akita para trabalhar com IA. Todo agente (Claude, Codex/GPT) DEVE seguir isto neste projeto.

### Ritmo (XP)

- Ciclos curtos de ~40 min; o app fica SEMPRE rodavel.
- Releases pequenos. Se quebrar, volte ao commit anterior — nada de "refatorar tudo e testar depois".
- Pair programming de IAs: uma gera, a outra revisa (Codex <-> Claude).
- Validation-First: nenhuma tarefa fica "pronta" sem um passo de validacao no navegador/localhost.
- Antes de pedir/gerar codigo, aplique os 3 valores: Simplicidade ("da pra fazer so com Supabase + Edge Function?"), Feedback rapido (sempre entregar codigo + passo de validacao), Coragem (apagar codigo antigo se a refatoracao for melhor).

### Disciplina (Akita) — regras de ouro

- Leia e ENTENDA todo o codigo antes de aceitar. Nada de colar as cegas.
- Contexto e rei: leia `CLAUDE_PROJECT_CONTEXT.md` / CONTEXTO_PROJETO antes de codar.
- Ceticismo: a IA erra com confianca — valide cada afirmacao.
- Fundamentos primeiro: saiba o que roda por baixo; nao terceirize o entendimento.
- Commits pequenos e reversiveis a cada passo que funciona.
- Rode e teste voce mesmo; nao confie no "deve funcionar".
- A IA acelera, mas o responsavel final pelo codigo e o Lucas.
- Nunca coloque secrets no repositorio.

### Definition of Done (porta pro Release)

Uma entrega so vai para producao quando: codigo entendido, `npm run build` limpo (sem erro de TS), validado no navegador (comportamento real), commit reversivel feito, contexto atualizado se a arquitetura mudou, e revisao cruzada das IAs (Codex <-> Claude).

## Produto

Sistema web privado para controle dos equipamentos do estudio de podcast da ASSEGO PM & BM.

## Stack

- React 18
- Vite
- TypeScript
- CSS simples
- Netlify / Vercel
- Supabase (Auth, banco, storage e Edge Functions) — em uso real, nao mais so planejado

## Ambiente

- Root do projeto: `C:\Assego\Sistema_Estúdio\app`
- Repositorio git: https://github.com/ricksonlucasgomes-prog/Estudio_assego.git (remote `origin`, branch `main`)

## Estado atual

- A aplicacao principal esta em `src/App.tsx`.
- Auth via Supabase Auth real (login por email/senha e Google OAuth).
- Dados persistidos em tabelas Supabase (fonte primaria). `localStorage` e apenas fallback quando o Supabase nao esta configurado/disponivel.
- Contexto de projeto: `CODEX_PROJECT_CONTEXT.md` (resumo curto e atual — leia primeiro). `CLAUDE_PROJECT_CONTEXT.md` e um log historico mais longo e em parte desatualizado; consulte para historico, mas o codigo e o `CODEX_PROJECT_CONTEXT.md` prevalecem sobre ele quanto ao estado atual.

## Regras de usuarios

Admins:

- Lucas
- Badu
- Sergio Vinicius / Serginho

Usuarios autorizados de retirada:

- Tiago Junior
- Bruna
- Tulio
- Dani
- Flavio Araujo
- Flavio Gabriel
- Tiago Raiz
- Arthur Renne

## Requisitos criticos

- Foto obrigatoria ao retirar equipamento.
- Observacoes devem gerar historico com nome, data e hora.
- Observacoes/comentarios devem gerar aviso por email.
- Login, retirada e conferencia tambem devem gerar aviso por email.
- Foto da retirada deve ir junto no aviso de email.
- WhatsApp deve ser implementado depois via backend seguro.
- Nao enviar email ou WhatsApp diretamente do frontend.

## Segurança

- Usar apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no frontend.
- Nunca usar `service_role` no frontend.
- Secrets de email/WhatsApp devem ficar em Edge Functions ou outro backend seguro.
- RLS deve proteger inventario, retiradas, conferencias, observacoes e logs.
