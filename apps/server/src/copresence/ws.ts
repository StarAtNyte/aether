/**
 * A minimal server side of RFC 6455 WebSocket, enough for the co-presence relay: the opening handshake, masked text
 * frames from the client (no fragmentation: every message is small), ping / pong, close, and a hard frame size cap.
 * Anything else (binary frames, continuation frames, unmasked client frames, invalid UTF-8, oversized frames) closes
 * the connection with the matching status code. No dependency: the relay is the only WebSocket the server speaks.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const KEY_RE = /^[A-Za-z0-9+/]{22}==$/;

/** The `Sec-WebSocket-Accept` value for a client key. */
export function acceptKey(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** One open WebSocket (server side). */
export interface WsConnection {
  /** Send a text message (ignored once closing). */
  send(text: string): void;
  /** Start the closing handshake (the socket ends shortly after). */
  close(code?: number, reason?: string): void;
  onText(fn: (text: string) => void): void;
  onClose(fn: (code: number) => void): void;
  readonly open: boolean;
}

/** True when `req` asks for a WebSocket upgrade with a well-formed key and version 13. */
export function isUpgradeRequest(req: IncomingMessage): boolean {
  const upgrade = String(req.headers.upgrade ?? '').toLowerCase();
  const key = req.headers['sec-websocket-key'];
  return req.method === 'GET' && upgrade === 'websocket' && typeof key === 'string' && KEY_RE.test(key) && req.headers['sec-websocket-version'] === '13';
}

/** Answer an upgrade request with a plain HTTP response and end the socket. */
export function refuseUpgrade(socket: Duplex, status: number, body = ''): void {
  if (socket.destroyed) return;
  const reason = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 421: 'Misdirected Request', 426: 'Upgrade Required', 429: 'Too Many Requests', 503: 'Service Unavailable' }[status] ?? 'Error';
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\n\r\n${body}`);
}

function frame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : Buffer.from([0x80 | opcode, 126, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([head, payload]);
}

/**
 * Complete the handshake of an upgrade request (already checked with {@link isUpgradeRequest}) and return the
 * connection. Frames longer than `maxFrameBytes` close it with 1009.
 */
export function acceptUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, opts: { maxFrameBytes: number }): WsConnection {
  const key = String(req.headers['sec-websocket-key']);
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const textFns: Array<(t: string) => void> = [];
  const closeFns: Array<(code: number) => void> = [];
  let buf: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let state: 'open' | 'closing' | 'closed' = 'open';
  let closeCode = 1006;

  const finish = (): void => {
    if (state === 'closed') return;
    state = 'closed';
    for (const fn of closeFns) fn(closeCode);
    if (!socket.destroyed) socket.destroy();
  };
  const close = (code = 1000, reason = ''): void => {
    if (state !== 'open') return;
    state = 'closing';
    closeCode = code;
    const r = Buffer.from(reason.slice(0, 100), 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    if (!socket.destroyed) socket.end(frame(0x8, p));
    // The peer may never answer the close: end it anyway.
    setTimeout(finish, 1000).unref();
  };

  const parse = (): void => {
    while (state === 'open' && buf.length >= 2) {
      const b0 = buf[0] as number;
      const b1 = buf[1] as number;
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      if ((b0 & 0x70) !== 0) return close(1002, 'reserved bits');
      if ((b1 & 0x80) === 0) return close(1002, 'unmasked frame');
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        return close(1009, 'frame too large');
      }
      if (len > opts.maxFrameBytes) return close(1009, 'frame too large');
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] as number) ^ (mask[i & 3] as number);
      buf = buf.subarray(off + 4 + len);
      if (opcode === 0x1) {
        if (!fin) return close(1003, 'fragmented message');
        let text: string;
        try {
          text = decoder.decode(payload);
        } catch {
          return close(1007, 'invalid utf-8');
        }
        for (const fn of textFns) fn(text);
      } else if (opcode === 0x8) {
        closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        state = 'closing';
        if (!socket.destroyed) socket.end(frame(0x8, payload.subarray(0, 2)));
        return finish();
      } else if (opcode === 0x9) {
        if (!socket.destroyed && len <= 125) socket.write(frame(0xa, payload));
      } else if (opcode === 0xa) {
        // pong: nothing to do
      } else {
        return close(1003, 'unsupported frame');
      }
    }
  };

  socket.on('data', (chunk: Buffer) => {
    if (state !== 'open') return;
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    // A partial frame larger than the cap can never become valid.
    if (buf.length > opts.maxFrameBytes + 16) {
      parse();
      if (state === 'open' && buf.length > opts.maxFrameBytes + 16) close(1009, 'frame too large');
      return;
    }
    parse();
  });
  socket.on('close', finish);
  socket.on('error', finish);
  socket.on('end', finish);
  queueMicrotask(parse);

  return {
    send(text: string) {
      if (state === 'open' && !socket.destroyed) socket.write(frame(0x1, Buffer.from(text, 'utf8')));
    },
    close,
    onText(fn) {
      textFns.push(fn);
    },
    onClose(fn) {
      closeFns.push(fn);
    },
    get open() {
      return state === 'open';
    },
  };
}
