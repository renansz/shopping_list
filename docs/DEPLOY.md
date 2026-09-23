# Colocando na VPS

Guia do zero até o app instalado no celular da família, com HTTPS em
**list.zanelatto.com**. Serve para qualquer VPS pequena (1 vCPU / 1 GB sobra).

- [1. Antes de começar](#1-antes-de-começar)
- [2. Opção A: tudo em Docker](#2-opção-a-tudo-em-docker-recomendado)
- [3. Opção B: já tem um proxy na VPS](#3-opção-b-já-tem-um-proxy-na-vps)
- [4. Opção C: systemd, sem Docker](#4-opção-c-systemd-sem-docker)
- [5. Conferindo se deu certo](#5-conferindo-se-deu-certo)
- [6. Instalar no celular](#6-instalar-no-celular)
- [7. Backup e restauração](#7-backup-e-restauração)
- [8. Atualizando](#8-atualizando)
- [9. Problemas comuns](#9-problemas-comuns)

---

## 1. Antes de começar

Três coisas precisam estar no lugar. Confira antes, porque são a causa de
quase todo problema de primeira instalação:

**1. DNS apontando para a VPS.** Um registro `A` de `list.zanelatto.com` para
o IP da máquina. Para conferir de qualquer lugar:

```sh
dig +short list.zanelatto.com        # tem que devolver o IP da VPS
```

A emissão do certificado depende disso: a Let's Encrypt vai bater nesse nome
pela porta 80 e precisa chegar na sua VPS.

**2. Portas 80 e 443 livres e abertas.** Livres na máquina e liberadas no
firewall (inclusive no painel do provedor, se houver):

```sh
sudo ss -lptn 'sport = :80 or sport = :443'    # não deve devolver nada
sudo ufw allow 80,443/tcp                      # se usar ufw
```

Se já houver um Nginx ou Apache ocupando essas portas, use a
[Opção B](#3-opção-b-já-tem-um-proxy-na-vps) ou pare o outro serviço.

**3. Docker instalado.**

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"     # saia e entre de novo para valer
docker --version
```

### Já tem outra aplicação nesta VPS?

Conviver é tranquilo — o que não pode é duas coisas disputando a mesma porta.
Rode este diagnóstico e siga a tabela:

```sh
sudo ss -lptn 'sport = :80 or sport = :443 or sport = :3000'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

| O que aparece | Caminho |
| --- | --- |
| Nada nas portas 80/443 | [Opção A](#2-opção-a-tudo-em-docker-recomendado): o Caddy deste repositório assume o HTTPS |
| Um Caddy, Nginx ou Traefik ocupando 80/443 | [Opção B](#3-opção-b-já-tem-um-proxy-na-vps): só a aplicação sobe, e o proxy que já existe ganha mais um site |
| A outra aplicação ocupa 80/443 **sem** proxy na frente | Ela precisa passar a atender atrás de um proxy; só há um dono possível para as portas 80 e 443 |
| A porta 3000 está ocupada | Defina `PORTA_LOCAL=3010` (ou outra livre) no `.env` — só muda o lado de fora do container |

Nenhum dos dois casos exige mexer na outra aplicação, desde que ela já esteja
atrás de um proxy: acrescentar um site é uma alteração aditiva, e o
`systemctl reload` recarrega a configuração sem derrubar o que está no ar.

## 2. Opção A: tudo em Docker (recomendado)

Um comando sobe a aplicação e o Caddy, que cuida do certificado sozinho.

```sh
sudo mkdir -p /opt/lista-de-compras
sudo chown "$USER" /opt/lista-de-compras
git clone https://github.com/renansz/shopping_list.git /opt/lista-de-compras
cd /opt/lista-de-compras

cp .env.example .env
nano .env          # defina HOUSEHOLD_PASSWORD com uma senha boa

docker compose --profile proxy up -d --build
```

Pronto. Em menos de um minuto `https://list.zanelatto.com` está no ar com
certificado válido.

Acompanhe a emissão do certificado (a primeira vez leva alguns segundos):

```sh
docker compose logs -f caddy
```

O que esse comando subiu:

| Container | Função |
| --- | --- |
| `lista-de-compras` | A aplicação, ouvindo em `127.0.0.1:3000` |
| `lista-caddy` | HTTPS nas portas 80/443, repassando para a aplicação |

Os dados ficam em volumes do Docker (`lista-dados` para o banco,
`caddy-dados` para os certificados), então `docker compose down` não apaga
nada. **Não remova o volume `caddy-dados`**: a Let's Encrypt limita a 5
certificados por domínio por semana, e recriar o volume pede um novo.

Para usar outro domínio, sem editar arquivo nenhum:

```sh
DOMINIO=outro.dominio.com docker compose --profile proxy up -d
```

## 3. Opção B: já tem um proxy na VPS

Use quando a VPS já serve outros sites. O caminho muda conforme onde esse
proxy roda — confira antes de escolher:

```sh
docker ps --format '{{.Names}}\t{{.Image}}'   # o proxy aparece na lista?
```

### 3a. O proxy roda dentro de um container Docker (caso mais comum)

Não dá para simplesmente apontar para `127.0.0.1:3000`: de dentro de um
container, `127.0.0.1` é o próprio container, nunca o host. A solução é
colocar esta aplicação na **mesma rede Docker** do proxy existente, para ele
alcançar pelo nome do serviço.

```sh
cd /opt/lista-de-compras
cp .env.example .env && nano .env
# defina HOUSEHOLD_PASSWORD e, no fim do arquivo, REDE_PROXY com o nome
# encontrado em `docker network ls` (geralmente "<pasta-do-outro-projeto>_default")

docker compose -f docker-compose.yml -f deploy/docker-compose.shared-proxy.yml up -d --build
```

Nenhuma porta é publicada no host — a aplicação só existe dentro dessa rede
Docker, o que já é uma isolação a mais.

**Deixe o overlay fixo no `.env`.** Se um dia alguém rodar só
`docker compose up -d`, sem o segundo `-f`, o container é recriado **fora**
da rede do proxy: o app continua de pé, mas o proxy deixa de enxergá-lo e o
site cai. Para não depender de lembrar, acrescente ao `.env`:

```sh
COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.shared-proxy.yml
```

O Docker Compose lê essa variável do `.env` da pasta do projeto, e a partir
daí `docker compose up -d --build`, `logs`, `ps` etc. já usam os dois arquivos
sozinhos. Confira com:

```sh
docker compose config | grep -A4 '^networks:'   # tem que listar a rede do proxy
```

**Com Caddy em container**, acrescente este bloco ao Caddyfile *dele* (não ao
deste repositório) — o modelo pronto está comentado no fim de
`deploy/Caddyfile`:

```caddyfile
list.zanelatto.com {
	encode gzip
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"

	reverse_proxy lista:3000 {
		flush_interval -1
		header_up X-Real-IP {remote_host}
		transport http {
			response_header_timeout 24h
		}
	}
}
```

```sh
docker exec <container-do-caddy> caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec <container-do-caddy> caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

`reload` aplica a configuração nova sem derrubar as conexões dos outros
sites — nunca use `restart` só para isto.

**Com Traefik em container**, ele descobre serviços pelas labels, mas só
enxerga containers que estejam na mesma rede que ele monitora — o mesmo
`docker-compose.shared-proxy.yml` resolve isso. Acrescente ao serviço `lista`:

```yaml
    labels:
      traefik.enable: "true"
      traefik.http.routers.lista.rule: Host(`list.zanelatto.com`)
      traefik.http.routers.lista.tls.certresolver: letsencrypt
      traefik.http.services.lista.loadbalancer.server.port: "3000"
```

### 3b. O proxy roda direto na VPS (não containerizado)

Aqui `127.0.0.1` já é o host de verdade, então o caminho mais simples
funciona sem overlay nenhum:

```sh
cd /opt/lista-de-compras
cp .env.example .env && nano .env
docker compose up -d --build          # sem o perfil "proxy"
```

Acrescente ao `/etc/caddy/Caddyfile` da máquina:

```caddyfile
list.zanelatto.com {
	encode gzip
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"

	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
		transport http {
			response_header_timeout 24h
		}
	}
}
```

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy      # reload não derruba os outros sites
```

Com Nginx, o princípio é o mesmo (`deploy/nginx.conf` já usa
`proxy_pass http://127.0.0.1:3000`): funciona direto quando o Nginx também
roda fora de container. Se o Nginx estiver em container, ele precisa entrar
na mesma rede do app — o mecanismo é igual ao do Traefik acima, trocando as
labels por um `proxy_pass http://lista:3000` dentro do bloco `server`.

```sh
sudo cp deploy/nginx.conf /etc/nginx/sites-available/lista-de-compras
sudo ln -s /etc/nginx/sites-available/lista-de-compras /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d list.zanelatto.com
```

> **Atenção ao tempo real.** O endereço `/api/events` mantém uma conexão HTTP
> aberta (Server-Sent Events). Os arquivos deste repositório já vêm com o
> buffer desligado (`flush_interval -1` no Caddy, `proxy_buffering off` no
> Nginx) e timeout longo. Se você escrever a configuração do zero e esquecer
> disso, o app para de atualizar sozinho e a conexão cai a cada minuto.

## 4. Opção C: systemd, sem Docker

Requer Node 22.13 ou mais novo na máquina.

```sh
sudo adduser --system --group --home /opt/lista-de-compras lista
sudo -u lista git clone https://github.com/renansz/shopping_list.git /opt/lista-de-compras
cd /opt/lista-de-compras

sudo -u lista cp .env.example .env
sudo -u lista nano .env               # HOUSEHOLD_PASSWORD e TRUST_PROXY=1
sudo -u lista mkdir -p data

sudo cp deploy/lista-de-compras.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lista-de-compras
```

Depois configure o proxy como na Opção B. Logs:
`journalctl -u lista-de-compras -f`.

## 5. Conferindo se deu certo

```sh
# a aplicação responde na própria VPS
curl -s localhost:3000/api/health                  # {"ok":true,...}

# o HTTPS está válido de fora
curl -sI https://list.zanelatto.com | head -1      # HTTP/2 200

# o HTTP redireciona para HTTPS
curl -sI http://list.zanelatto.com | head -1       # 308 Permanent Redirect

# o tempo real não está sendo bufferizado pelo proxy
curl -N https://list.zanelatto.com/api/events      # trava esperando eventos: certo
```

O último comando deve ficar parado (é uma conexão aberta) depois de devolver
`retry: 3000`. Se ele voltar na hora ou der erro, o proxy está segurando o
stream — reveja o aviso da seção 3.

## 6. Instalar no celular

Abra `https://list.zanelatto.com` no celular:

- **iPhone/iPad:** funciona no **Safari** e também no **Chrome** (iOS 16.4 ou
  mais novo). No Safari: Compartilhar → *Adicionar à Tela de Início* →
  *Adicionar*. No Chrome: botão Compartilhar na barra de endereço →
  *Adicionar à Tela de Início*. Se aparecer *Abrir como App Web*, deixe ligado.
- **Android:** o Chrome mostra *Instalar aplicativo*. Se não mostrar, menu ⋮ →
  *Adicionar à tela inicial*.

Cada pessoa entra com a senha da casa (ou por um link de convite gerado no
menu **Acessos** — sem senha nenhuma) e escolhe o próprio nome. A sessão não
expira sozinha: só sai por logout, ou se alguém revogar aquele acesso na
tela **Acessos**.

## 7. Backup e restauração

O banco inteiro é um arquivo só.

**Backup manual:**

```sh
cd /opt/lista-de-compras
docker compose exec lista node tools/backup.mjs /data/backups     # com Docker
npm run backup /var/backups/lista                                 # sem Docker
```

O script usa o backup online do SQLite (cópia consistente mesmo com gente
usando), comprime com gzip e mantém os 30 mais recentes.

**Backup diário no cron** (e uma cópia para fora da VPS, que é o que salva de
verdade):

```sh
sudo crontab -e
# todo dia às 3h
0 3 * * * cd /opt/lista-de-compras && docker compose exec -T lista node tools/backup.mjs /data/backups
```

**Tirar uma cópia do volume para a sua máquina:**

```sh
docker compose exec -T lista node tools/backup.mjs /data/backups
docker compose cp lista:/data/backups ./backups-locais
```

**Restaurar:**

```sh
cd /opt/lista-de-compras
docker compose stop lista
gunzip -c backups-locais/shopping-2026-01-15-03-00.db.gz > /tmp/restaurado.db
docker compose cp /tmp/restaurado.db lista:/data/shopping.db
docker compose exec lista sh -c 'rm -f /data/shopping.db-wal /data/shopping.db-shm'
docker compose start lista
```

## 8. Atualizando

Entre na VPS, vá para a pasta do projeto e puxe o código novo:

```sh
cd /opt/lista-de-compras        # ou onde o repositório foi clonado
git pull
```

Depois suba de novo com **o mesmo comando usado na instalação** — é aqui que
mais se derruba o site sem querer:

| Instalado com | Para atualizar |
| --- | --- |
| Opção A (Caddy deste repositório) | `docker compose --profile proxy up -d --build` |
| Opção 3a com `COMPOSE_FILE` no `.env` | `docker compose up -d --build` |
| Opção 3a sem `COMPOSE_FILE` | `docker compose -f docker-compose.yml -f deploy/docker-compose.shared-proxy.yml up -d --build` |
| Opção 3b (proxy direto na VPS) | `docker compose up -d --build` |
| Opção C (systemd) | `sudo systemctl restart lista-de-compras` |

Na Opção 3a, **nunca** use `--profile proxy`: ele tenta subir um segundo
Caddy nas portas 80/443, que já pertencem ao proxy existente.

Confira que voltou (o healthcheck leva uns 30 segundos para ficar `healthy`):

```sh
docker compose ps
curl -s https://list.zanelatto.com/api/health      # {"ok":true,...}
```

Se não voltar, `docker compose logs -f lista` mostra o motivo.

As migrações do banco rodam sozinhas na subida. Se mudou algo no front-end,
suba o `SHELL_VERSION` no topo de `public/sw.js` — é o que faz os celulares
buscarem a versão nova em vez da guardada em cache.

## 9. Problemas comuns

| Sintoma | O que verificar |
| --- | --- |
| Certificado não é emitido | `dig +short list.zanelatto.com` aponta para a VPS? Porta 80 aberta no firewall? Veja `docker compose logs caddy` |
| "address already in use" na porta 80 | Outro servidor web na máquina: `sudo ss -lptn 'sport = :80'`. Use a Opção B |
| "A porta 3000 já está em uso" | `sudo ss -lptn 'sport = :3000'` |
| Site fora do ar depois de atualizar, mas `docker compose ps` mostra o app de pé | Proxy em container (Opção 3a) e o app subiu sem o overlay: `docker inspect lista-de-compras --format '{{json .NetworkSettings.Networks}}'` não lista a rede do proxy. Suba de novo com os dois `-f` e fixe `COMPOSE_FILE` no `.env` |
| Itens não aparecem sozinhos | Proxy bufferizando `/api/events`: teste com o `curl -N` da seção 5 |
| Não instala como app no celular | Só funciona em HTTPS, no Safari ou Chrome do iOS (16.4+) e no Chrome do Android |
| Cookie não fica salvo | Falta `TRUST_PROXY=1` (o compose já define) |
| "HOUSEHOLD_PASSWORD não definida" | O `.env` não foi criado a partir do `.env.example` |
| App abre com dados antigos | Cache do service worker: suba o `SHELL_VERSION` em `public/sw.js` |
| Erro de versão do Node | Precisa ser 22.13+; com Docker isso já vem resolvido |

Para ver o que está acontecendo:

```sh
docker compose logs -f              # tudo
docker compose logs -f lista        # só a aplicação
docker compose logs -f caddy        # só o HTTPS
docker compose ps                   # o healthcheck está "healthy"?
```
