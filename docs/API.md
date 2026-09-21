# Referência da API

Tudo devolve JSON. Todas as rotas exigem a sessão (cookie `sl_session`), exceto
`/api/health`, `/api/me`, `/api/login` e `/api/logout`.

Erros vêm no formato `{ "error": "mensagem em português" }` com o status HTTP
apropriado: `400` dado inválido, `401` sem sessão, `403` origem não permitida,
`404` não encontrado, `409` regra de negócio (ex.: editar lista finalizada),
`429` excesso de tentativas de login, `500` erro interno.

Requisições que alteram dados precisam de `Content-Type: application/json` e,
quando o navegador manda `Origin`, ele precisa bater com o host.

## Sessão

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/api/me` | Diz se há sessão e quem é |
| `POST` | `/api/login` | `{ name, password }` → cria a sessão |
| `POST` | `/api/logout` | Encerra a sessão |
| `GET` | `/api/health` | `{ ok: true, uptime }` para monitoramento |

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
```
