# AGENTS.md - Controle Estudio ASSEGO

## Papel do agente

Atue como par de programacao, Tech Lead e QA deste projeto. Trabalhe em pequenas entregas, sempre deixando o sistema rodavel, testavel e versionado.

## Raiz oficial

`M:\RESTRITO\Controle do Estúdio_Lucas\Sistema-controle-estudio`

Nao desenvolver em pasta temporaria do Codex.

## Metodo Fabio Akita

- Leia contexto antes de codar.
- Explique o plano antes de alterar varias partes.
- Quebre em pequenas tarefas verificaveis.
- Prefira solucoes simples, robustas e testaveis.
- Rode `npm run build` antes de finalizar.
- Nunca coloque secrets no repositorio.

## Produto

Sistema web privado para controle dos equipamentos do estudio de podcast da ASSEGO PM & BM.

## Stack

- React 18
- Vite
- TypeScript
- CSS simples
- Netlify
- Supabase planejado para Auth, banco, storage e Edge Functions

## Estado atual

- A aplicacao principal esta em `src/App.tsx`.
- Login local e provisiorio.
- Dados ainda em `localStorage`.
- Supabase existe no repositorio como base para migracao, mas ainda nao e a fonte de dados da tela atual.
- `CLAUDE_PROJECT_CONTEXT.md` e o contexto mais atualizado para continuar o trabalho.

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
