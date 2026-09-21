/**
 * Hub de eventos em tempo real via Server-Sent Events.
 * SSE em vez de WebSocket: mesma latencia percebida para este caso, reconexão
 * automática no navegador e zero dependência extra no servidor.
 */
export class EventHub {
  constructor({ heartbeatMs = 25000 } = {}) {
    this.clients = new Set();
    this.lastId = 0;
    this.heartbeat = setInterval(() => this.#ping(), heartbeatMs);
    this.heartbeat.unref?.();
  }

  add(res, { name = null } = {}) {
    const client = { res, name };
    this.clients.add(client);
    res.write(`retry: 3000\n\n`);
    res.on('close', () => this.clients.delete(client));
    return () => this.clients.delete(client);
  }

  broadcast(type, data = {}) {
    this.lastId += 1;
    const payload = JSON.stringify({ type, ...data, at: new Date().toISOString() });
    const frame = `id: ${this.lastId}\nevent: message\ndata: ${payload}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
    return this.lastId;
  }

  #ping() {
    for (const client of this.clients) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        this.clients.delete(client);
      }
    }
  }

  get size() {
    return this.clients.size;
  }

  closeAll() {
    clearInterval(this.heartbeat);
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {
        // cliente já desconectado
      }
    }
    this.clients.clear();
  }
}
