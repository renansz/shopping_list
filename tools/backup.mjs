/**
 * Backup do banco sem parar o servidor e sem depender do cliente sqlite3.
 *
 *   node tools/backup.mjs [destino]
 *
 * Usa o backup online do SQLite: a cópia sai consistente mesmo com alguém
 * marcando itens no mercado durante a execução.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import { loadDotEnv, readConfig } from '../server/config.js';

loadDotEnv();
const config = readConfig();
const destino = path.resolve(process.argv[2] || path.join(config.dataDir, 'backups'));
const manter = Number(process.env.MANTER_BACKUPS || 30);

if (!fs.existsSync(config.dbFile)) {
  console.error(`Banco não encontrado em ${config.dbFile}`);
  process.exit(1);
}

fs.mkdirSync(destino, { recursive: true });
const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const arquivo = path.join(destino, `shopping-${carimbo}.db`);

const db = new DatabaseSync(config.dbFile, { readOnly: true });
await backup(db, arquivo);
db.close();

await pipeline(fs.createReadStream(arquivo), zlib.createGzip(), fs.createWriteStream(`${arquivo}.gz`));
fs.unlinkSync(arquivo);

// Mantém apenas os backups mais recentes.
const antigos = fs
  .readdirSync(destino)
  .filter((nome) => /^shopping-.*\.db\.gz$/.test(nome))
  .sort()
  .reverse()
  .slice(manter);
for (const nome of antigos) fs.unlinkSync(path.join(destino, nome));

const tamanho = (fs.statSync(`${arquivo}.gz`).size / 1024).toFixed(1);
console.log(`Backup criado: ${arquivo}.gz (${tamanho} kB)`);
if (antigos.length > 0) console.log(`Removidos ${antigos.length} backups antigos.`);
