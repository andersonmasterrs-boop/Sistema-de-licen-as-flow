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

Para rodar em producao no Vercel, configure um banco externo. O caminho recomendado neste projeto e Supabase.

O projeto tambem inclui uma funcao serverless unica em `api/index.js` para rodar no Vercel. Para dados permanentes, o sistema usa automaticamente Supabase quando as variaveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` existirem.

Como alternativa, tambem aceita Vercel KV/Upstash com `KV_REST_API_URL` e `KV_REST_API_TOKEN`. Sem Supabase/KV, o sistema usa memoria temporaria da funcao, que pode resetar e nao e confiavel para solicitacoes pendentes.

## Supabase

1. Crie um projeto gratuito no Supabase.
2. Abra o SQL Editor.
3. Execute o arquivo `supabase/schema.sql`.
4. No Supabase, copie:
   - Project URL
   - service_role key
5. No Vercel, em `Settings > Environment Variables`, cadastre:

```text
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
```

6. Faca redeploy no Vercel.

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
GET /api/license/check?account=19485815&name=Nome%20do%20Cliente&robot=Rompedor%20Flow&key=LIC-19485815-ROMPEDOR-FLOW&broker=XP&server=ServidorMT5
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
GET /api/license/check?account=19485815&name=Nome%20do%20Cliente&robot=Rompedor%20Flow&key=LIC-19485815-ROMPEDOR-FLOW&format=text
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

Quando uma conta ainda nao cadastrada tenta carregar o EA, o sistema cria uma solicitacao pendente com conta, nome, corretora, servidor, robo e chave enviada. No painel, use `Usuarios e licencas > Solicitacoes pendentes` para cadastrar e liberar a licenca.

No endpoint `/api/health`, confira o campo `storage`:

- `supabase`: dados persistentes ativos via Supabase.
- `kv`: dados persistentes ativos.
- `memory`: apenas memoria temporaria, nao recomendado para producao.

## Proximos passos recomendados

1. Trocar `ADMIN_USER` e `ADMIN_PASSWORD`.
2. Cadastrar robos reais no painel.
3. Cadastrar usuarios e licencas.
4. Configurar a URL do servidor na lista de WebRequest permitidos do MetaTrader.
5. Hospedar em VPS/Render/Railway e usar HTTPS.
