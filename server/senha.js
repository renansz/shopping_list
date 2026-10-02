/**
 * Senha da casa: guardada no banco como hash, trocável pelo próprio app.
 *
 * O `HOUSEHOLD_PASSWORD` do ambiente passa a ser só a senha INICIAL. Assim que
 * alguém troca a senha pelo app, o valor do ambiente deixa de valer — senão
 * trocar a senha não adiantaria nada para quem já conhecia a antiga.
 *
 * Esqueceu a senha? `node tools/senha.mjs` redefine pelo servidor (ver README).
 */
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { ValidationError } from './store.js';

const CHAVE_HASH = 'password_hash';
const CHAVE_DATA = 'password_updated_at';
const CHAVE_AUTOR = 'password_updated_by';

export const TAMANHO_MINIMO = 8;
const TAMANHO_MAXIMO = 200;

// Parâmetros do scrypt. 16384 é o padrão do Node: ~50 ms por verificação numa
// VPS modesta, o que é barato para quem sabe a senha e caro para quem chuta.
const N = 16384;
const R = 8;
const P = 1;
const BYTES = 32;

/** Espaços nas pontas vêm de teclado de celular, não da intenção de quem digita. */
export function normaliza(senha) {
  return String(senha ?? '').trim();
}

export function geraHash(senha) {
  const sal = crypto.randomBytes(16);
  const derivada = crypto.scryptSync(normaliza(senha), sal, BYTES, { N, r: R, p: P });
  return ['scrypt', N, R, P, sal.toString('base64url'), derivada.toString('base64url')].join('$');
}

/** @returns {boolean} false também quando o hash guardado está corrompido. */
export function confereHash(senha, guardado) {
  if (typeof guardado !== 'string') return false;
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, sal, esperado] = partes;
  let derivada;
  try {
    derivada = crypto.scryptSync(normaliza(senha), Buffer.from(sal, 'base64url'), BYTES, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  const alvo = Buffer.from(esperado, 'base64url');
  if (alvo.length !== derivada.length) return false;
  return crypto.timingSafeEqual(derivada, alvo);
}

/** Compara duas senhas em texto puro sem vazar o tamanho pelo tempo de resposta. */
function comparaTextoPuro(tentativa, esperada) {
  const a = crypto.createHash('sha256').update(normaliza(tentativa)).digest();
  const b = crypto.createHash('sha256').update(normaliza(esperada)).digest();
  return crypto.timingSafeEqual(a, b);
}

export function validaSenha(senha) {
  const limpa = normaliza(senha);
  if (limpa.length < TAMANHO_MINIMO) {
    throw new ValidationError(`A senha precisa ter pelo menos ${TAMANHO_MINIMO} caracteres.`);
  }
  if (limpa.length > TAMANHO_MAXIMO) {
    throw new ValidationError('Essa senha é longa demais.');
  }
  if (new Set(limpa).size === 1) {
    throw new ValidationError('Escolha uma senha menos óbvia.');
  }
  return limpa;
}

export class GerenciadorDeSenha {
  /**
   * @param {object} db banco aberto
   * @param {string} senhaDoAmbiente valor de HOUSEHOLD_PASSWORD (senha inicial)
   */
  constructor(db, senhaDoAmbiente = '') {
    this.db = db;
    this.senhaDoAmbiente = senhaDoAmbiente;
  }

  /** true quando já trocaram a senha pelo app (o ambiente deixou de valer). */
  get personalizada() {
    return Boolean(getSetting(this.db, CHAVE_HASH));
  }

  get info() {
    return {
      personalizada: this.personalizada,
      atualizadaEm: getSetting(this.db, CHAVE_DATA),
      atualizadaPor: getSetting(this.db, CHAVE_AUTOR),
      tamanhoMinimo: TAMANHO_MINIMO,
    };
  }

  confere(tentativa) {
    const guardado = getSetting(this.db, CHAVE_HASH);
    if (guardado) return confereHash(tentativa, guardado);
    // Ainda na senha inicial, a que veio do .env.
    if (!this.senhaDoAmbiente) return false;
    return comparaTextoPuro(tentativa, this.senhaDoAmbiente);
  }

  /** Valida e grava a nova senha. @returns {object} info atualizada */
  define(novaSenha, { por = null } = {}) {
    const limpa = validaSenha(novaSenha);
    setSetting(this.db, CHAVE_HASH, geraHash(limpa));
    setSetting(this.db, CHAVE_DATA, new Date().toISOString());
    setSetting(this.db, CHAVE_AUTOR, por ?? '');
    return this.info;
  }
}
