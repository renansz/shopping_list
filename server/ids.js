import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// Id ordenavel por tempo: prefixo em base36 do timestamp + aleatorio.
// Ordenar por id equivale a ordenar por data de criacao.
export function newId(prefix = '') {
  const time = Date.now().toString(36).padStart(9, '0');
  const bytes = crypto.randomBytes(8);
  let rand = '';
  for (const byte of bytes) rand += ALPHABET[byte % ALPHABET.length];
  return `${prefix}${time}${rand}`;
}
