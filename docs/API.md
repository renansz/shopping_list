# Referência da API

Tudo devolve JSON. Todas as rotas exigem a sessão (cookie `sl_session`), exceto
`/api/health`, `/api/me`, `/api/login`, `/api/logout` e as duas rotas de
convite (`GET`/`POST /api/invites/:id...`) — essas existem justamente para
funcionar sem sessão prévia.

Erros vêm no formato `{ "error": "mensagem em português" }` com o status HTTP
apropriado: `400` dado inválido, `401` sem sessão, `403` origem não permitida,
`404` não encontrado, `409` regra de negócio (ex.: editar lista finalizada),
`410` convite inválido/expirado/já usado, `429` excesso de tentativas,
`500` erro interno.

Requisições que alteram dados precisam de `Content-Type: application/json` e,
quando o navegador manda `Origin`, ele precisa bater com o host.

A sessão não expira por tempo: o cookie é renovado a cada requisição
autenticada (`Max-Age` de 400 dias, o teto que os navegadores aceitam) e só
para de valer por logout ou revogação — ver `/api/sessions` abaixo.

## Sessão

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/api/me` | Diz se há sessão e quem é |
| `POST` | `/api/login` | `{ name, password }` → cria a sessão |
| `POST` | `/api/logout` | Encerra a sessão (revoga no servidor, não só limpa o cookie) |
| `GET` | `/api/health` | `{ ok: true, uptime }` para monitoramento |

## Convites (link mágico)

Quem já tem acesso gera um link nomeado para outra pessoa entrar sem senha.
Abrir o link (`GET`) nunca gasta o convite — só o `POST` de confirmar gasta.
Isso é proposital: WhatsApp, Telegram e iMessage buscam a URL sozinhos para
montar a prévia, antes de qualquer humano clicar; se o `GET` consumisse,
o link chegaria morto para quem recebeu.

| Método | Rota | Sessão? | O que faz |
| --- | --- | --- | --- |
| `POST` | `/api/invites` | sim | `{ name }` → cria o convite, devolve `{ invite, url }` |
| `GET` | `/api/invites` | sim | Lista os convites pendentes (não usados, não expirados) |
| `DELETE` | `/api/invites/:id` | sim | Cancela um convite ainda não usado |
| `GET` | `/api/invites/:id` | não | Só consulta: `{ valid: true, name }` ou `{ valid: false, reason }` |
| `POST` | `/api/invites/:id/consume` | não | Gasta o convite, cria a sessão, devolve `{ ok, user }` |

O convite vale por 7 dias e é de uso único.

## Acessos (sessões ativas)

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/api/sessions` | Lista os aparelhos com acesso: nome, como entrou, último uso |
| `DELETE` | `/api/sessions/:id` | Revoga um aparelho específico — efeito imediato |
| `POST` | `/api/sessions/revoke-all` | `{ password }` → revoga todos, inclusive quem pediu |

`revoke-all` exige a senha da casa de novo (não basta estar logado), por ser
destrutivo: derruba a família inteira de uma vez.

## Estado e listas

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/api/state` | Tudo que a tela inicial precisa: lista atual com itens, listas abertas e quantas finalizadas existem |
| `GET` | `/api/lists?status=open\|finished\|all&limit&offset` | Resumos das listas |
| `POST` | `/api/lists` | `{ name?, makeCurrent? }` cria lista |
| `GET` | `/api/lists/:id` | Lista com os itens |
| `PATCH` | `/api/lists/:id` | `{ name?, isCurrent? }` |
| `POST` | `/api/lists/:id/finish` | `{ carryOver?: true }` finaliza; devolve a finalizada e a nova atual |
| `POST` | `/api/lists/:id/reopen` | `{ makeCurrent?: false }` tira do histórico |
| `DELETE` | `/api/lists/:id` | Apaga a lista e os itens |
| `POST` | `/api/lists/:id/copy` | `{ targetListId, onlyPending?: true }` copia itens para outra lista |

Uma lista (`list`) tem:

```json
{
  "id": "l_mf3k...",
  "name": "Compras de 21/09",
  "status": "open",
  "isCurrent": true,
  "createdAt": "2026-09-21T12:00:00.000Z",
  "updatedAt": "2026-09-21T12:30:00.000Z",
  "finishedAt": null,
  "createdBy": "Renan",
  "finishedBy": null,
  "totalItems": 8,
  "checkedItems": 2,
  "pendingItems": 6,
  "items": []
}
```

## Itens

| Método | Rota | O que faz |
| --- | --- | --- |
| `POST` | `/api/lists/:id/items` | `{ name, qty?, url?, note? }` ou `{ names: [...] }` para vários de uma vez |
| `PATCH` | `/api/items/:id` | `{ name?, qty?, url?, note?, checked?, position? }` |
| `DELETE` | `/api/items/:id` | Remove o item |
| `POST` | `/api/lists/:id/reorder` | `{ itemIds: [...] }` na ordem desejada |
| `POST` | `/api/lists/:id/clear-checked` | Remove os itens já comprados |
| `POST` | `/api/lists/:id/uncheck-all` | Desmarca tudo |
| `GET` | `/api/suggestions?q&limit&excludeListId` | Sugestões vindas do histórico |
| `GET` | `/api/stats` | Contagens gerais e quantos aparelhos estão conectados |

Um item (`item`):

```json
{
  "id": "i_mf3k...",
  "listId": "l_mf3k...",
  "name": "Ração do Mel 15 kg",
  "qty": "1 saco",
  "url": "https://petlove.com.br/racao",
  "note": "",
  "checked": false,
  "position": 7,
  "createdAt": "2026-09-21T12:10:00.000Z",
  "updatedAt": "2026-09-21T12:10:00.000Z",
  "checkedAt": null,
  "createdBy": "Renan",
  "checkedBy": null
}
```

O campo `url` aceita endereço sem esquema (`loja.com/item` vira
`https://loja.com/item`) e recusa qualquer coisa que não seja `http`/`https`.

## Tempo real

`GET /api/events` — fluxo Server-Sent Events. Cada mensagem é um JSON:

```
data: {"type":"list:updated","list":{...},"by":"Ana","origin":"abc123","at":"..."}
data: {"type":"lists:changed","by":"Ana","origin":"abc123","at":"..."}
data: {"type":"list:removed","listId":"l_...","origin":"abc123","at":"..."}
data: {"type":"hello","at":"..."}
```

Mande o cabeçalho `X-Client-Id` nas alterações para receber de volta o campo
`origin` e poder ignorar o eco das suas próprias ações.

## Exemplos com curl

```sh
BASE=https://list.zanelatto.com

# entrar e guardar o cookie
curl -s -c cookies.txt -X POST $BASE/api/login \
  -H 'content-type: application/json' \
  -d '{"name":"Renan","password":"SENHA_DA_CASA"}'

# ver a lista atual
curl -s -b cookies.txt $BASE/api/state | head -c 400

# adicionar três itens de uma vez
LISTA=$(curl -s -b cookies.txt $BASE/api/state | grep -o '"id":"l_[^"]*' | head -1 | cut -d'"' -f4)
curl -s -b cookies.txt -X POST $BASE/api/lists/$LISTA/items \
  -H 'content-type: application/json' \
  -d '{"names":["Arroz","Feijão","Café"]}'

# acompanhar as alterações em tempo real
curl -N -b cookies.txt $BASE/api/events

# gerar um convite para a Ana entrar sem senha (usa o cookie do Renan acima)
curl -s -b cookies.txt -X POST $BASE/api/invites \
  -H 'content-type: application/json' -d '{"name":"Ana"}'
# -> devolve {"invite":{...},"url":"https://.../#/entrar/inv_..."}; mande o url por WhatsApp

# a Ana confirma o convite (nenhum cookie prévio, guarda o dela em cookies-ana.txt)
curl -s -c cookies-ana.txt -X POST $BASE/api/invites/SEU_INVITE_ID/consume -d '{}'
```
