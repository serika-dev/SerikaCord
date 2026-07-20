// Ambient Bun type declarations (no import/export to keep this a script file)

interface BunServerWebSocket<T = unknown> {
  send(data: string | ArrayBufferLike): boolean;
  close(code?: number, reason?: string): void;
  terminate(): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(topic: string, data: string | ArrayBufferLike): boolean;
  readonly readyState: number;
  readonly OPEN: number;
  readonly remoteAddress: string | null;
  data: T;
}

interface BunServeOptions<T = unknown> {
  port?: number;
  idleTimeout?: number;
  fetch: (req: Request, server: { upgrade: (req: Request, options?: { data?: T; headers?: Record<string, string> }) => boolean }) => Response | undefined | Promise<Response | undefined>;
  websocket?: {
    sendPings?: boolean;
    maxPayloadLength?: number;
    open: (ws: BunServerWebSocket<T>) => void;
    message: (ws: BunServerWebSocket<T>, message: string | Buffer) => void | Promise<void>;
    close: (ws: BunServerWebSocket<T>, code: number, reason: string) => void;
    pong?: (ws: BunServerWebSocket<T>) => void;
    drain?: (ws: BunServerWebSocket<T>) => void;
  };
}

declare module 'bun' {
  export type ServerWebSocket<T = unknown> = BunServerWebSocket<T>;
}

declare const Bun: {
  serve<T = unknown>(options: BunServeOptions<T>): { stop?: () => void };
};
