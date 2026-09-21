# Como funciona por dentro

Documento para quem for mexer no código (inclusive você mesmo, daqui a um ano).

## Princípio

Uma família não é carga: são cinco pessoas, algumas dezenas de itens por
semana. O projeto foi feito para caber numa VPS barata e não apodrecer:
**nenhuma dependência de runtime**. Só Node, SQLite embutido e o navegador.

Isso significa: sem `npm install`, sem etapa de build, sem lockfile para
atualizar, sem vulnerabilidade herdada de pacote de terceiros. O custo é
escrever à mão algumas coisas que um framework daria de graça (roteador,
helpers de DOM) — cerca de 200 linhas, todas neste repositório.

## Mapa dos arquivos

```
server/
  index.js     sobe o HTTP, trata sinais e erros de porta
  config.js    lê .env e as variáveis de ambiente
  db.js        abre o SQLite e roda as migrações
  store.js     as regras do produto (o coração)
  app.js       rotas da API, sessão e transmissão dos eventos
  http.js      roteador (com suporte a rota pública), estáticos, requisição
  auth.js      cookie de sessão, senha da casa, limite de tentativas
  sessions.js  sessão no banco e convites (link mágico)
  events.js    hub de Server-Sent Events

public/
  index.html   casca do app
  app.css      todo o estilo (variáveis CSS, tema claro/escuro)
  sw.js        service worker: abre offline e instala como app
  js/
    app.js     inicialização, render da tela, compositor de itens, menu
    views.js   telas e componentes (lista, itens, folhas, histórico)
    actions.js tudo que altera dados; atualiza a tela antes do servidor responder
    api.js     fetch + fila offline (outbox)
    state.js   estado do cliente e cópia local para abrir sem rede
    live.js    conexão de tempo real
    router.js  rotas por hash
    ui.js      avisos, folhas deslizantes, confirmações, menu lateral
    dom.js     helpers de DOM, ícones e formatação de datas
```

## Dados

Duas tabelas. `lists` e `items`.

```
lists(id, name, status, is_current, created_at, updated_at,
      finished_at, created_by, finished_by)
items(id, list_id, name, qty, url, note, checked, position,
      created_at, updated_at, checked_at, created_by, checked_by)
```

Decisões que valem explicação:

- **`is_current`** materializa a regra "sempre existe uma lista atual".
  `ensureCurrentList()` é chamado na subida e em toda leitura de estado: se
  ninguém é a atual, a lista aberta mais recente é promovida; se não há
  nenhuma, uma nova é criada. A tela inicial nunca fica órfã.
- **`status = 'open' | 'finished'`** em vez de apagar. O histórico precisa
  guardar o que foi comprado *e* o que ficou faltando.
- **Finalizar copia os pendentes** para a lista nova em vez de movê-los. Assim
  a lista finalizada continua sendo um retrato fiel daquela ida ao mercado.
- **`position` é REAL** para permitir reordenação futura sem reescrever a
  tabela inteira.
- **Ids ordenáveis por tempo** (`l_` + timestamp em base36 + aleatório):
  ordenar por id já é ordenar por criação.
- **WAL ligado**: leitura e escrita simultâneas sem travar, importante quando
  várias pessoas mexem na lista ao mesmo tempo.

As migrações ficam num array em `db.js` e rodam sozinhas na subida. Para mudar
o esquema, acrescente um item novo — nunca edite um já aplicado.

## Tempo real

`GET /api/events` mantém uma conexão aberta por aparelho (Server-Sent Events).
A cada alteração, o servidor transmite a lista inteira já pronta:

```
list:updated    { list: {...com itens...}, by: "Ana", origin: "<id do cliente>" }
lists:changed   { }                  → o menu recarrega os resumos
list:removed    { listId }
```

Por que SSE e não WebSocket: o navegador reconecta sozinho, passa por qualquer
proxy HTTP, e a comunicação só precisa ir numa direção (as alterações sobem por
`fetch` normal). Zero dependência no servidor.

Cada cliente manda um cabeçalho `X-Client-Id`; o evento volta com esse
`origin`, e quem originou ignora o próprio eco — a tela de quem digitou não
pisca.

Detalhe de operação: proxies gostam de bufferizar essa resposta. O servidor
manda `X-Accel-Buffering: no` e os exemplos em `deploy/` desligam o buffer.

## Offline

O supermercado tem sinal ruim. O app trata isso em três camadas:

1. **Service worker** guarda a casca do app, então ele abre mesmo sem rede.
2. **Cópia local do estado** (`localStorage`) mostra a última lista conhecida.
3. **Outbox** (`public/js/api.js`): se o `fetch` falha por rede, a alteração
   entra numa fila persistida. Quando a conexão volta (evento `online`, volta
   do segundo plano ou reconexão do SSE), a fila é enviada em ordem.

Itens criados offline recebem um id temporário `tmp_...`. Quando o servidor
responde com o id real, a fila reescreve os pedidos seguintes que citavam o id
temporário. Entrada que o servidor rejeita com erro 4xx é descartada — senão a
fila travaria para sempre.

Na tela, tudo é otimista: marcar um item pinta na hora e só depois confirma com
o servidor; se der erro, volta ao estado anterior e aparece um aviso.

## Sessão e convites

Uma senha para a casa inteira (`HOUSEHOLD_PASSWORD`) e um nome por pessoa, que
serve só para mostrar quem pediu e quem comprou cada item. Não há cadastro nem
e-mail — para uma família, isso seria burocracia. Existem dois jeitos de
entrar:

- **Senha da casa** — o caminho de sempre, e o único que funciona quando
  ninguém mais tem acesso (recuperação).
- **Convite (link mágico)** — quem já está dentro gera, no menu **Acessos**,
  um link nomeado ("convite para a Ana") e manda por WhatsApp. Abrir o link
  mostra só "Entrar como Ana?"; a pessoa toca e entra, sem senha e sem digitar
  o próprio nome. O convite vale por 7 dias e se gasta no primeiro uso.

  Abrir o link e usá-lo são coisas propositalmente separadas: WhatsApp,
  Telegram e iMessage buscam a URL sozinhos para montar a prévia, antes de
  qualquer humano clicar. Se o simples `GET` consumisse o convite, ele
  chegaria morto para quem recebeu — por isso `GET /api/invites/:id` é só
  leitura (pode ser chamado várias vezes) e o convite só é gasto num `POST`
  explícito, que a interface só dispara quando a pessoa toca no botão.

**Sessão vira registro no banco**, não mais um cookie com prazo embutido:
tabelas `sessions` e `invites` (migração `002`). Isso troca uma expiração por
tempo fixo por uma revogação explícita — exatamente o que a família pediu
("só sair por logout ou reset"). O cookie carrega só um token opaco de 256
bits (sem HMAC: a própria entropia já o torna imprevisível, e o servidor faz
a busca por chave primária); a cada requisição autenticada, a sessão é
"tocada" (`last_seen_at` atualizado) e o cookie é reemitido com `Max-Age` de
400 dias — o teto que os navegadores aceitam — o que na prática nunca expira
para quem usa o app com alguma regularidade.

A tela **Acessos** lista cada sessão ativa (nome, como entrou, último uso) com
um botão para revogar uma por uma, mais um "encerrar todas" que exige a senha
da casa de novo, por ser destrutivo (desloga todo mundo, inclusive quem
pediu).

Proteções: comparação de senha em tempo constante, limite de 10 tentativas por
IP a cada 10 minutos (login e consumo de convite têm contadores separados),
conferência de `Origin` em toda requisição que altera dados, corpo limitado a
1 MB e links de item restritos a `http`/`https` (nada de `javascript:`
virando item clicável).

## Front-end sem framework

O estado vive em `state.js` e quem quiser saber de mudanças se inscreve em
`subscribe()`. Toda alteração redesenha a tela dentro de um
`requestAnimationFrame` (posição da rolagem é preservada). Com listas de algumas
dezenas de itens isso é instantâneo e dispensa qualquer reconciliação.

A única parte que **não** é redesenhada é a barra de adicionar item: ela vive
fora da área de render justamente para não perder foco nem o texto digitado.

As rotas são por hash (`#/`, `#/historico`, `#/lista/<id>`) porque funcionam
offline, no modo tela cheia do iOS e sem configuração no servidor. Os caminhos
são propositalmente sem acento: o navegador codificaria `ó` como `%C3%B3` no
`location.hash` e a comparação deixaria de bater (já aconteceu — há teste para
isso em `test/rotas.test.js`).

## Ícones

`tools/gen-icons.mjs` desenha os PNGs do zero: as formas são definidas por
distância (SDF), o anti-aliasing sai de supersampling e o PNG é escrito na mão
com `zlib`. Roda com `npm run icons`. É o que permite não ter nenhuma
dependência de build no projeto.

## Testes

```sh
npm test
```

- `test/store.test.js` — as regras: lista atual garantida, finalizar levando
  pendências, lista finalizada que não aceita edição, sugestões, cópia.
- `test/sessoes.test.js` — sessão e convite isolados: revogação, expiração,
  uso único, prévia que nunca consome.
- `test/api.test.js` — sobe o servidor de verdade e exercita as rotas,
  incluindo login, convite ponta a ponta (dois "aparelhos" com cookies
  independentes), revogação em tempo real, reset geral e um cliente SSE
  recebendo evento de outro aparelho.
- `test/rotas.test.js` — o roteador do navegador.

Todos usam `node:test` e SQLite em memória; não precisam de rede nem de banco
externo.
