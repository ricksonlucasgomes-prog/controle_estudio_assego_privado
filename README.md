# Controle Estudio ASSEGO

Sistema privado para controle dos equipamentos do estudio de podcast da ASSEGO PM & BM.

## Estado atual

- React + Vite + TypeScript.
- Interface definitiva em `src/App.tsx`.
- Login local provisorio, ainda nao seguro para producao.
- Supabase preservado no repositorio para a proxima migracao.
- Deploy preparado para Netlify.

## Funcionalidades

- Login para admins e usuarios autorizados de retirada.
- Checklist de equipamentos.
- Conferencia diaria com nome, data/hora e pendencias.
- Retirada/devolucao de equipamento.
- Foto obrigatoria para salvar retirada.
- Foto de perfil por usuario.
- Observacoes com historico, nome, data/hora.
- Eventos locais de notificacao para login, retirada, conferencia e observacao.
- Camera ao vivo via YouTube embed.
- Link fixo para pasta oficial de midias do Google Drive do Lucas.

## Usuarios provisorios

Admins:

- Badu / `znuap844`
- Lucas / `gmunm956`
- Serginho / `whcvi244`

Usuarios de retirada:

- Tiago Junior / `qv8m2p71`
- Bruna / `r9d4kq26`
- Tulio / `m5xw7n83`
- Dani / `p2jh9s64`
- Flavio Araujo / `t6br3v91`
- Flavio Gabriel / `k8zy4c52`
- Tiago Raiz / `w3nc6a85`
- Arthur Renne / `n7fd2q48`

## Como rodar

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Netlify

- Build command: `npm run build`
- Publish directory: `dist`

## Proximas etapas

- Migrar login e dados para Supabase Auth/Postgres/Storage.
- Criar tabelas para observacoes, conferencias e notificacoes.
- Criar Edge Function para email.
- Adicionar WhatsApp via backend seguro.
- Transformar em PWA instalavel.
