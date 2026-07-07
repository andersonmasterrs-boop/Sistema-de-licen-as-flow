# Sistema de Licencas para Robos

Projeto inicial para gerenciar licencas de Expert Advisors e permitir verificacao direta pelo EA via API.

## Como rodar

Instale Node.js 18 ou superior e execute:

```bash
npm start
```

O painel fica em:

```text
http://localhost:3000
```

## GitHub e Vercel

Este primeiro MVP usa `data/db.json` como armazenamento local, criado automaticamente ao iniciar o servidor. Isso e otimo para validar o fluxo e testar o EA, mas nao e persistente no Vercel.

Para rodar em producao no Vercel, o proximo passo tecnico e trocar o armazenamento local por um banco externo, como Supabase ou Neon Postgres. O painel web ja fica em `public/`, e a regra de licenca ja esta concentrada em `src/server.js`, pronta para ser separada em funcoes serverless quando o banco estiver definido.

Login inicial:

```text
Usuario: admin
Senha: admin123
```

Altere esses valores em variaveis de ambiente quando colocar em producao:

```bash
ADMIN_USER=andre ADMIN_PASSWORD=sua-senha APP_PORT=3000 npm start
```

## Verificacao do EA

Endpoint principal:

```text
GET /api/license/check?account=19485815&robot=FLOWWIN.mq5&key=LIC-19485815-FLOWWIN&broker=XP
```

Resposta JSON quando autorizado:

```json
{
  "ok": true,
  "authorized": true,
  "reason": "AUTHORIZED",
  "expiresAt": "2027-06-16T14:31:00.000Z",
  "serverTime": "2026-07-07T20:00:00.000Z"
}
```

Para EAs que preferem resposta simples:

```text
GET /api/license/check?account=19485815&robot=FLOWWIN.mq5&key=LIC-19485815-FLOWWIN&format=text
```

Retorna `AUTHORIZED|2027-06-16T14:31:00.000Z` ou `DENIED|MOTIVO`.

## Logica de licenca

Uma licenca so autoriza quando:

- a conta existe;
- o robo existe;
- a chave da licenca confere;
- o status esta como `active`;
- a data de expiracao ainda nao passou;
- se a corretora for informada, ela precisa bater com a conta.

Cada verificacao salva um check-in em `data/db.json` com IP, horario, conta, robo e resultado.

## Proximos passos recomendados

1. Trocar `ADMIN_USER` e `ADMIN_PASSWORD`.
2. Cadastrar robos reais no painel.
3. Cadastrar usuarios e licencas.
4. Configurar a URL do servidor na lista de WebRequest permitidos do MetaTrader.
5. Hospedar em VPS/Render/Railway e usar HTTPS.
