/**
 * Conexão em tempo real (Server-Sent Events).
 * O navegador reconecta sozinho; aqui só tratamos os estados de conexão
 * para a interface mostrar se está "ao vivo" ou não.
 */
export function connectLive({ onEvent, onStatus }) {
  let source = null;
  let retryTimer = null;
  let closedByUs = false;

  function open() {
    clearTimeout(retryTimer);
    try {
      source = new EventSource('/api/events');
    } catch {
      onStatus(false);
      return;
    }

    source.onopen = () => onStatus(true);

    source.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data));
      } catch {
        // frame inválido: ignora
      }
    };

    source.onerror = () => {
      onStatus(false);
      if (closedByUs) return;
      // EventSource já tenta reconectar; se o navegador desistiu, reabrimos.
      if (source.readyState === EventSource.CLOSED) {
        retryTimer = setTimeout(open, 3000);
      }
    };
  }

  open();

  // Voltar do segundo plano no celular costuma matar o stream silenciosamente.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && source?.readyState === EventSource.CLOSED) {
      open();
    }
  });

  window.addEventListener('online', () => {
    if (source?.readyState === EventSource.CLOSED) open();
  });

  return {
    close() {
      closedByUs = true;
      clearTimeout(retryTimer);
      source?.close();
      onStatus(false);
    },
    get connected() {
      return source?.readyState === EventSource.OPEN;
    },
  };
}
