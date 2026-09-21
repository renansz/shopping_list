/**
 * Confere se o Node é novo o bastante ANTES de qualquer outra coisa.
 *
 * O `node:sqlite` só existe sem flag a partir do 22.13.0. Em versões antigas o
 * erro que aparece é `ERR_UNKNOWN_BUILTIN_MODULE`, que não ajuda ninguém —
 * aqui a mensagem diz o que fazer.
 */

const MINIMA = [22, 13, 0];

export function versaoSuficiente(versao, minima = MINIMA) {
  const partes = String(versao).replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < minima.length; i += 1) {
    const atual = Number.isFinite(partes[i]) ? partes[i] : 0;
    if (atual > minima[i]) return true;
    if (atual < minima[i]) return false;
  }
  return true;
}

export const versaoMinima = MINIMA.join('.');

function explicar(motivo) {
  return [
    motivo,
    '',
    `Este app precisa do Node ${versaoMinima} ou mais novo (você está no ${process.version}).`,
    'O banco usado é o SQLite embutido no próprio Node, que só ficou disponível',
    `sem flag a partir da versão ${versaoMinima}.`,
    '',
    'Como resolver:',
    '  nvm install 22 && nvm use 22       (com nvm)',
    '  brew upgrade node                  (macOS com Homebrew)',
    '  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs',
    '',
    'Ou rode com Docker, que já traz a versão certa:',
    '  docker compose up -d --build',
  ].join('\n');
}

/** Encerra o processo com uma explicação em vez de um erro obscuro. */
export async function verificarAmbiente() {
  if (!versaoSuficiente(process.versions.node)) {
    console.error(explicar('Versão do Node muito antiga.'));
    process.exit(1);
  }
  try {
    await import('node:sqlite');
  } catch {
    console.error(explicar('O módulo node:sqlite não está disponível nesta instalação do Node.'));
    process.exit(1);
  }
}
