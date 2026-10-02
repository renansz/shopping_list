/**
 * Redefine a senha da casa pelo servidor. É a saída para quando a senha é
 * esquecida: depois da primeira troca pelo app, o HOUSEHOLD_PASSWORD do
 * ambiente não vale mais.
 *
 *   node tools/senha.mjs                       # pergunta a senha (não aparece na tela)
 *   node tools/senha.mjs "nova senha aqui"     # direto (fica no histórico do shell)
 *   node tools/senha.mjs --derrubar-tudo       # além de trocar, desloga todo mundo
 *
 * Com Docker:
 *   docker compose exec lista node tools/senha.mjs
 */
import readline from 'node:readline';
import { loadDotEnv, readConfig } from '../server/config.js';
import { verificarAmbiente } from '../server/verifica-ambiente.js';

await verificarAmbiente();

const { openDatabase } = await import('../server/db.js');
const { GerenciadorDeSenha, TAMANHO_MINIMO } = await import('../server/senha.js');
const { SessionStore } = await import('../server/sessions.js');

loadDotEnv();
const config = readConfig();

const argumentos = process.argv.slice(2);
const derrubarTudo = argumentos.includes('--derrubar-tudo');
const senhaDoArgumento = argumentos.find((a) => !a.startsWith('--'));

/** Lê a senha sem ecoar no terminal. */
function perguntaEscondido(pergunta) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(pergunta);
    const aoDigitar = (char) => {
      // Reescreve a linha sem os caracteres digitados.
      if (['\n', '\r', '\u0004'].includes(char.toString())) return;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(pergunta);
    };
    process.stdin.on('data', aoDigitar);
    rl.question('', (resposta) => {
      process.stdin.off('data', aoDigitar);
      rl.close();
      process.stdout.write('\n');
      resolve(resposta);
    });
  });
}

const db = openDatabase(config.dbFile);
const senhas = new GerenciadorDeSenha(db, config.password);

let nova = senhaDoArgumento;
if (!nova) {
  nova = await perguntaEscondido(`Nova senha da casa (mínimo ${TAMANHO_MINIMO} caracteres): `);
  const confirmacao = await perguntaEscondido('Digite de novo: ');
  if (nova !== confirmacao) {
    console.error('As duas senhas não são iguais. Nada foi alterado.');
    process.exit(1);
  }
}

try {
  const info = senhas.define(nova, { por: 'linha de comando' });
  console.log('Senha da casa redefinida.');
  console.log(`Banco: ${config.dbFile}`);
  console.log(`Quando: ${info.atualizadaEm}`);

  if (derrubarTudo) {
    const sessions = new SessionStore(db);
    const quantas = sessions.revokeAll('senha redefinida pela linha de comando');
    console.log(`Sessões encerradas: ${quantas} (todo mundo entra de novo com a senha nova).`);
  } else {
    console.log('Quem já está logado continua logado. Use --derrubar-tudo para encerrar todas as sessões.');
  }
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
} finally {
  db.close();
}
