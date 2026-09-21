# Colocando na VPS

Guia do zero até o app instalado no celular da família, com HTTPS em
**list.zanelatto.com**. Serve para qualquer VPS pequena (1 vCPU / 1 GB sobra).

- [1. Antes de começar](#1-antes-de-começar)
- [2. Opção A: tudo em Docker](#2-opção-a-tudo-em-docker-recomendado)
- [3. Opção B: Docker + Caddy já instalado na VPS](#3-opção-b-docker--caddy-já-instalado-na-vps)
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
[Opção B](#3-opção-b-docker--caddy-já-instalado-na-vps) ou pare o outro serviço.

**3. Docker instalado.**

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"     # saia e entre de novo para valer
docker --version
```

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

## 3. Opção B: Docker + Caddy já instalado na VPS

Use quando a VPS já tem um Caddy servindo outros sites.

```sh
cd /opt/lista-de-compras
cp .env.example .env && nano .env
docker compose up -d --build          # sem o perfil "proxy"
```

A aplicação fica em `127.0.0.1:3000`. Agora acrescente o site ao Caddy da
máquina — o bloco está pronto em `deploy/Caddyfile`; copie-o para dentro do seu
`/etc/caddy/Caddyfile`, ou use o arquivo inteiro se ele ainda não tiver nada:

```sh
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Com Nginx em vez de Caddy, use `deploy/nginx.conf` e o certbot:

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

- **iPhone/iPad:** precisa ser o **Safari**. Compartilhar → *Adicionar à Tela de
  Início* → *Adicionar*.
- **Android:** o Chrome mostra *Instalar aplicativo*. Se não mostrar, menu ⋮ →
  *Adicionar à tela inicial*.

Cada pessoa entra com a senha da casa e escolhe o próprio nome. A sessão dura
180 dias (`SESSION_DAYS`).

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

```sh
cd /opt/lista-de-compras
git pull
docker compose --profile proxy up -d --build
```

As migrações do banco rodam sozinhas na subida. Se mudou algo no front-end,
suba o `SHELL_VERSION` no topo de `public/sw.js` — é o que faz os celulares
buscarem a versão nova em vez da guardada em cache.

## 9. Problemas comuns

| Sintoma | O que verificar |
| --- | --- |
| Certificado não é emitido | `dig +short list.zanelatto.com` aponta para a VPS? Porta 80 aberta no firewall? Veja `docker compose logs caddy` |
| "address already in use" na porta 80 | Outro servidor web na máquina: `sudo ss -lptn 'sport = :80'`. Use a Opção B |
| "A porta 3000 já está em uso" | `sudo ss -lptn 'sport = :3000'` |
| Itens não aparecem sozinhos | Proxy bufferizando `/api/events`: teste com o `curl -N` da seção 5 |
| Não instala como app no celular | Só funciona em HTTPS, e no Safari (iOS) ou Chrome (Android) |
| Some a sessão toda hora | `SESSION_SECRET` mudando a cada subida — fixe no `.env` |
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
