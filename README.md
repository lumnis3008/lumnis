# Lumnis — site e sistema de agendamento

Site institucional com uma aplicação de reservas, painel da equipe e API própria. O projeto não tem dependências de instalação: usa JavaScript, APIs padrão de Request/Response e SQLite nativo do Node.

## Abrir no Mac

Requer **Node 22.13 ou superior**. Na pasta do projeto:

```sh
npm start
```

- Site: `http://localhost:4788/`
- Agendamento: `http://localhost:4788/agenda`
- Painel da equipe: `http://localhost:4788/painel`
- Documentação OpenAPI: `http://localhost:4788/api/openapi.json`

Na primeira inicialização, o servidor gera uma senha longa em **`.local/admin-password`**, com permissão de leitura restrita ao usuário do Mac. Abra esse arquivo para copiar a senha do painel. A senha nunca é publicada no GitHub e não aparece na página. Também é possível fornecer `LUMNIS_ADMIN_PASSWORD` pelo ambiente. Variáveis documentadas em `.env.example`; o servidor não carrega arquivos `.env` automaticamente.

Por padrão, o servidor escuta apenas em `127.0.0.1`. Para uso público, use HTTPS numa hospedagem apropriada e configure a senha administrativa como segredo. Atrás de proxy, preserve o host externo; a aplicação verifica a origem das alterações. Não exponha o diretório do projeto com um servidor estático: use o servidor fornecido, que publica somente os arquivos permitidos.

## O que funciona

- Consulta de serviços, agendas e disponibilidade conforme duração, dias de trabalho, intervalos, antecedência e fuso horário.
- Criação de reservas salvas no banco de dados, com uma chave de idempotência para repetir envios sem duplicar registros.
- Bloqueio de horários sobrepostos por profissional/recurso, garantido também no banco por triggers atômicos, inclusive entre processos.
- Consulta da própria reserva, reagendamento e cancelamento por link privado. O link contém a chave no fragmento (`#`), que não é enviado ao servidor em navegações ou cabeçalhos Referer. As chamadas autenticadas usam `Authorization`.
- Arquivo `.ics` para adicionar o compromisso ao calendário. Isso **não é sincronização com Google Calendar**, nem envio automático de convite.
- Painel autenticado com lista por dia, filtros por agenda/situação, indicadores do dia e ações para concluir ou cancelar.
- Sessões administrativas em cookie HttpOnly, SameSite=Strict, Secure em HTTPS, com validade de oito horas e invalidação no logout.
- Validação de entradas, limite de tamanho de solicitação, limitação de tentativas e verificação de origem nas alterações.

A configuração inicial é **modo de teste**. Os serviços e as duas agendas são exemplos, não funcionários ou compromissos reais da Lumnis. As reservas funcionam e ficam gravadas, mas não representam atendimento contratado. Use nomes e e-mails fictícios para experimentar. Não há cobranças, prontuários, lembretes, envio de e-mail ou integrações de terceiros na API de reservas.

## Configurar a operação

Edite `booking-config.json`: nome, `mode` (`demo` ou `live`), fuso, serviços, duração, agendas responsáveis, dias da semana, períodos de atendimento, antecedência e horizonte de reserva. Reinicie o Node; para o Worker, gere e publique uma nova versão. A configuração é validada antes de iniciar ou compilar. Os identificadores de serviços e agendas devem ser preservados depois que existirem reservas; renomear ou excluir identificadores exige migração dos registros existentes.

Antes de colocar em operação real, substitua os exemplos pelos serviços e horários aprovados pela empresa e atualize os avisos de teste no site. Cada agenda representa um profissional ou recurso com capacidade para um atendimento por vez. Todos usam os períodos comuns de funcionamento definidos no arquivo. Não há regras individuais de feriado, exceções de jornada, contas para várias empresas ou permissões por funcionário nesta versão.

## Dados e privacidade

No Node, os dados ficam em `.local/lumnis.sqlite`; `LUMNIS_DATA_DIR` permite mudar o diretório. O diretório e as credenciais são ignorados pelo Git e nunca entram nos pacotes de distribuição. Faça backups do banco com a aplicação parada ou pela API de backup do SQLite, incluindo o cuidado com o modo WAL. Reiniciar não apaga reservas.

Nome, e-mail, serviço, agenda, horário e situação são salvos. Os tokens privados são armazenados como hashes, não em texto. A disponibilidade pública não retorna clientes. O painel autenticado e o link privado da reserva permitem ler somente o que cada acesso autoriza. O navegador mantém uma solicitação pendente em `sessionStorage` para recuperar um envio interrompido; ela é removida após confirmação. Não compartilhamos dados de reserva com Formspree.

O cancelamento mantém o registro, mas libera o horário. Não há exclusão automática de dados nesta versão; defina a política de retenção e o processo de atendimento a solicitações de remoção antes do uso público. Não solicite documentos ou informações médicas pela agenda.

O formulário comercial do site preserva o endpoint Formspree original (`https://formspree.io/f/xovkqork`). É um fluxo separado: o recebimento deve ser confirmado pelo responsável. As fontes são carregadas do Google Fonts, com alternativas locais.

## API

O arquivo `openapi.json` documenta os endpoints. Exemplo de fluxo para uma integração:

1. `GET /api/catalog` para identificar serviços e agendas.
2. `GET /api/availability?serviceId=conversa&resourceId=equipe-1&date=AAAA-MM-DD` para horários em ISO/UTC.
3. Gere uma chave aleatória de 32 bytes em hexadecimal e uma UUID para `Idempotency-Key`.
4. `POST /api/bookings` com `Authorization: Bearer <chave>`, `Idempotency-Key` e JSON com `serviceId`, `resourceId`, `startsAt`, `name`, `email`, `consent: true`.
5. Guarde o ID e a chave privada para `GET /api/bookings/:id` e `PATCH /api/bookings/:id` com `{action: "cancel"}` ou `{action: "reschedule", startsAt: "..."}`.

Reutilize a mesma chave de idempotência e o mesmo corpo para repetir um envio não confirmado. Um conflito de horário retorna `409`, entradas inválidas retornam `400`, e limite de tentativas retorna `429`. Não há CORS externo habilitado. Integrações servidor a servidor podem usar a API; integrações de navegador em outro domínio precisam de uma política de origens explicitamente implementada.

O login administrativo é `POST /api/admin/login`, com senha em JSON e cabeçalho `Origin` igual ao servidor. O cookie resultante autoriza a listagem e as alterações administrativas. Nunca coloque essa senha em um aplicativo público ou repositório.

## Worker e publicação Sites

`npm run build` produz `dist/server/index.js`: Worker ESM único com o site e a API, usando binding D1 `DB`. A configuração de hospedagem existente é preservada em `.openai/hosting.json`, agora com `d1: "DB"`. O schema e os triggers estão em `drizzle/0000_booking.sql`, com o journal de migrações em `drizzle/meta/`. Sites deve aplicar a migração antes de publicar o Worker. Não crie tabelas nas requisições.

Configure **`LUMNIS_ADMIN_PASSWORD` como segredo no ambiente hospedado** antes de usar o painel. Sem esse segredo, o login hospedado retorna `503`; não existe senha padrão. O site permanece com a audiência privada já configurada. O banco local e o D1 hospedado são separados; não há transferência automática de dados entre eles. A compilação também produz `dist/client/`, útil para inspeção dos arquivos, mas uma hospedagem exclusivamente estática não executa a API.

Não marque como publicado até a hospedagem confirmar a implantação. Se a conexão com o repositório da hospedagem estiver indisponível, o sistema ainda pode rodar localmente pelo Node.

## Verificações

```sh
npm run check
npm test
npm run build
```

Os testes usam SQLite real em memória e em disco temporário: conflitos concorrentes, idempotência, persistência, reagendamento, cancelamento, autenticação, expiração de sessão, origem, limites e validação. Também exercitam o Worker compilado com um adaptador que reproduz o contrato D1. Isso não substitui a validação num D1 real nem o teste visual em navegador. Para testar o fluxo completo, inicie o servidor, abra a agenda com dados fictícios e acompanhe a reserva no painel.
