# submit-booking - solicitacao interna no app

A Edge Function `submit-booking` grava a solicitacao de agendamento e a
assinatura digital. Ela nao envia WhatsApp, Telegram ou n8n neste fluxo.

Depois que a reserva e a assinatura sao gravadas, a notificacao acontece dentro
do proprio app:

1. o solicitante recebe sucesso no formulario;
2. os aprovadores oficiais entram na aba **Agenda**;
3. o painel **Notificacoes de agendamento** mostra as solicitacoes pendentes;
4. cada solicitacao exibe os dados pessoais preenchidos pelo usuario e pelos
   convidados;
5. Lucas, Badu e Sergio Vinicius podem aprovar ou rejeitar.

## Segurança

Os dados pessoais ficam no Supabase e sao lidos pelo frontend apenas via RLS.

A politica usa `public.current_user_is_booking_approver()`, que exige:

- `profiles.role = 'admin'`;
- `profiles.full_name` compatível com Lucas, Badu, Sergio Vinicius ou Serginho.

Hoje, para Badu e Sergio receberem as notificacoes internas, eles precisam:

1. criar login no app;
2. ter seus perfis atualizados para `role = 'admin'`;
3. ter `full_name` preenchido como `Badu`, `Sergio Vinicius`, `Sérgio Vinicius`
   ou `Serginho`.

## Payload recebido do frontend

```jsonc
{
  "requester": {
    "name": "Lucas Rickson Gomes da Silva",
    "email": "...",
    "whatsapp": "...",
    "rg": "...",
    "cpf": "...",
    "social": "...",
    "date": "2026-07-09",
    "time": "12:00"
  },
  "guests": [
    {
      "name": "Badu",
      "whatsapp": "...",
      "email": "...",
      "rg": "...",
      "cpf": "...",
      "social": "..."
    }
  ],
  "booking_details": {
    "date": "2026-07-09",
    "time": "12:00"
  },
  "signature": {
    "fullName": "...",
    "acceptedTerms": true,
    "termDocument": "Termo_de_Uso_Assego.pdf",
    "signedByEmail": "...",
    "userAgent": "..."
  }
}
```

## Tabelas envolvidas

- `studio_booking_requests`
- `studio_booking_participants`
- `legal_signatures`

## Deploy

```bash
supabase db query --linked --file supabase/studio_booking.sql
supabase db query --linked --file supabase/legal_signatures.sql
supabase functions deploy submit-booking
```
