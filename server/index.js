import http from 'node:http';
import { verificarAmbiente } from './verifica-ambiente.js';

// Os demais módulos entram por import() de propósito: num Node antigo o
// `node:sqlite` falharia ao carregar antes de qualquer código rodar, e o
// usuário veria ERR_UNKNOWN_BUILTIN_MODULE em vez da explicação abaixo.
await verificarAmbiente();

const { loadDotEnv, readConfig } = await import('./config.js');
const { openDatabase } = await import('./db.js');
const { createApp } = await import('./app.js');

loadDotEnv();
const config = readConfig();

if (!config.authDisabled && !config.password) {
  console.error(
    'HOUSEHOLD_PASSWORD não definida.\n' +
      'Defina a senha da casa no .env (veja .env.example) ou use AUTH_DISABLED=1 em desenvolvimento.',
  );
  process.exit(1);
}

const db = openDatabase(config.dbFile);
const app = createApp({ config, db });
const server = http.createServer(app.handler);

// SSE segura conexoes por muito tempo de propósito.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `A porta ${config.port} já está em uso. Pare o outro processo ou mude PORT no .env.`,
    );
  } else if (error.code === 'EACCES') {
    console.error(`Sem permissão para usar a porta ${config.port}. Use uma porta acima de 1024.`);
  } else {
    console.error('Erro ao subir o servidor:', error.message);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`${config.appName} rodando em http://${config.host}:${config.port}`);
  console.log(`Banco: ${config.dbFile}`);
  if (config.authDisabled) console.log('ATENÇÃO: autenticação desligada (AUTH_DISABLED=1).');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nRecebido ${signal}, encerrando...`);
  app.close();
  server.close(() => {
    try {
      db.close();
    } catch {
      // banco já fechado
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
