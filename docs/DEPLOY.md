# Colocando na VPS

Guia completo do zero até o app instalado no celular da família. Serve para
qualquer VPS pequena (1 vCPU / 1 GB já sobra).

- [1. Pré-requisitos](#1-pré-requisitos)
- [2. Opção A: Docker](#2-opção-a-docker-recomendado)
- [3. Opção B: systemd](#3-opção-b-systemd-sem-docker)
- [4. HTTPS e domínio](#4-https-e-domínio)
- [5. Instalar no celular](#5-instalar-no-celular)
- [6. Backup e restauração](#6-backup-e-restauração)
- [7. Atualizando](#7-atualizando)
- [8. Problemas comuns](#8-problemas-comuns)

---

## 1. Pré-requisitos

- Uma VPS com Debian/Ubuntu (ou qualquer distro com Docker).
- Um subdomínio apontando para o IP da VPS, por exemplo
  `compras.seudominio.com.br` (registro `A`).
- Portas 80 e 443 liberadas no firewall.

> **Por que HTTPS é obrigatório?** Sem ele o navegador não instala o app na tela
> de início nem ativa o service worker (o que faz o app abrir offline).

Se for rodar sem Docker, instale o Node 22 ou mais novo:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # precisa ser >= v22.5
```

## 2. Opção A: Docker (recomendado)

```sh
sudo mkdir -p /opt/lista-de-compras
sudo chown "$USER" /opt/lista-de-compras
git clone https://github.com/renansz/shopping_list.git /opt/lista-de-compras
cd /opt/lista-de-compras

cp .env.example .env
nano .env        # defina HOUSEHOLD_PASSWORD com uma senha boa

docker compose up -d --build
docker compose logs -f     # confira "rodando em http://0.0.0.0:3000"
```

O container escuta apenas em `127.0.0.1:3000` — quem fala com a internet é o
proxy do passo 4. O banco fica no volume `lista-dados`, então `docker compose
down` não apaga nada.

Verificação rápida:

```sh
curl -s localhost:3000/api/health     # {"ok":true,...}
```

## 3. Opção B: systemd (sem Docker)

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
sudo systemctl status lista-de-compras
```

Logs: `journalctl -u lista-de-compras -f`.

## 4. HTTPS e domínio

### Caddy (mais simples — certificado automático)

```sh
sudo apt install -y caddy
sudo cp /opt/lista-de-compras/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # troque compras.seudominio.com.br
sudo systemctl reload caddy
```

### Nginx + certbot

```sh
sudo cp /opt/lista-de-compras/deploy/nginx.conf /etc/nginx/sites-available/lista-de-compras
sudo ln -s /etc/nginx/sites-available/lista-de-compras /etc/nginx/sites-enabled/
sudo nano /etc/nginx/sites-available/lista-de-compras    # troque o domínio
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d compras.seudominio.com.br
```

> **Atenção ao tempo real.** O endereço `/api/events` mantém uma conexão aberta
> (Server-Sent Events). Os dois arquivos de exemplo já vêm com buffer desligado
> e timeout longo; se você escrever a configuração do zero, não esqueça disso —
> sem esses ajustes a atualização automática para de funcionar a cada minuto.

Com `TRUST_PROXY=1` no `.env`, o app reconhece o HTTPS do proxy e marca o
cookie de sessão como `Secure`.

## 5. Instalar no celular

Abra `https://compras.seudominio.com.br` no celular:

- **iPhone/iPad:** precisa ser o **Safari**. Compartilhar → *Adicionar à Tela de
  Início* → *Adicionar*.
- **Android:** o Chrome mostra *Instalar aplicativo*. Se não mostrar, menu ⋮ →
  *Adicionar à tela inicial*.

Cada pessoa entra com a senha da casa e escolhe o próprio nome. A sessão dura
180 dias (`SESSION_DAYS`).

## 6. Backup e restauração

O banco inteiro é um arquivo: `data/shopping.db`.

**Backup manual:**

```sh
cd /opt/lista-de-compras
npm run backup /var/backups/lista
# com Docker:
docker compose exec lista node tools/backup.mjs /data/backups
```

O script usa o backup online do SQLite (cópia consistente mesmo com gente
usando), comprime com gzip e mantém os 30 mais recentes.

**Backup diário no cron:**

```sh
sudo crontab -e
# todo dia às 3h da manhã
0 3 * * * cd /opt/lista-de-compras && /usr/bin/node tools/backup.mjs /var/backups/lista
```

**Restaurar:**

```sh
sudo systemctl stop lista-de-compras          # ou: docker compose stop
gunzip -c /var/backups/lista/shopping-2026-01-15-03-00.db.gz > /opt/lista-de-compras/data/shopping.db
rm -f /opt/lista-de-compras/data/shopping.db-wal /opt/lista-de-compras/data/shopping.db-shm
sudo systemctl start lista-de-compras         # ou: docker compose start
```

## 7. Atualizando

```sh
cd /opt/lista-de-compras
git pull
docker compose up -d --build        # Docker
sudo systemctl restart lista-de-compras   # systemd
```

As migrações do banco rodam sozinhas na subida. Se você mexeu nos arquivos do
front-end, suba o `SHELL_VERSION` no topo de `public/sw.js` para os celulares
buscarem a versão nova em vez da guardada em cache.

## 8. Problemas comuns

| Sintoma | O que verificar |
| --- | --- |
| "A porta 3000 já está em uso" | Outro processo subiu antes: `ss -lptn 'sport = :3000'` |
| Não instala como app no celular | Só funciona em HTTPS e no Safari (iOS) ou Chrome (Android) |
| Itens não aparecem sozinhos | Proxy bufferizando `/api/events`; confira o passo 4 |
| Some a sessão toda hora | `SESSION_SECRET` mudando a cada subida — fixe no `.env` |
| Cookie não fica salvo | Falta `TRUST_PROXY=1` atrás do proxy HTTPS |
| "HOUSEHOLD_PASSWORD não definida" | O `.env` não foi lido: confira o caminho e o `EnvironmentFile` |
| App abre com dados antigos | Cache do service worker: suba o `SHELL_VERSION` em `public/sw.js` |

Para ver o que o servidor está fazendo:

```sh
journalctl -u lista-de-compras -f     # systemd
docker compose logs -f                # Docker
curl -s localhost:3000/api/health     # está vivo?
```
