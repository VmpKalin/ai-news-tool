import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getState, getLatestDigest, runOnce } from './runState.js';
import type { Scheduler, PipelineRunner } from './scheduler.js';
import { openApiSpec, docsHtml } from './docs.js';

export interface ServerOptions {
  readonly port: number;
  readonly triggerToken: string | null;
  readonly scheduler: Scheduler;
  readonly runner: PipelineRunner;
}

export class HttpServer {
  private server: Server | null = null;

  constructor(private readonly options: ServerOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handle(req, res).catch((error) => {
          console.error('[Server] Unhandled request error', error);
          if (!res.headersSent) {
            sendJson(res, 500, { error: 'internal_server_error' });
          }
        });
      });

      this.server.once('error', reject);
      this.server.listen(this.options.port, () => {
        console.log(`[Server] Listening on port ${this.options.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.server;
      if (!server) {
        resolve();
        return;
      }
      this.server = null;
      server.close((err) => {
        if (err) reject(err);
        else {
          console.log('[Server] Closed');
          resolve();
        }
      });
      server.closeAllConnections();
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const path = (req.url ?? '/').split('?')[0];

    if (method === 'GET' && path === '/health') {
      return this.handleHealth(res);
    }
    if (method === 'POST' && path === '/digest/run') {
      return this.handleRun(req, res);
    }
    if (method === 'GET' && path === '/digest/latest') {
      return await this.handleLatest(res);
    }
    if (method === 'GET' && path === '/openapi.json') {
      sendJson(res, 200, openApiSpec);
      return;
    }
    if (method === 'GET' && (path === '/docs' || path === '/docs/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(docsHtml);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  }

  private handleHealth(res: ServerResponse): void {
    const state = getState();
    sendJson(res, 200, {
      status: 'ok',
      isRunning: state.isRunning,
      lastRun: state.lastRun,
      nextRun: this.options.scheduler.getNextRun()?.toISOString() ?? null,
    });
  }

  private async handleRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.checkAuth(req, res)) return;

    const result = await runOnce(this.options.runner);
    if (result.status === 'already_running') {
      sendJson(res, 409, { error: 'already_running' });
      return;
    }
    if (result.status === 'error') {
      sendJson(res, 500, { error: 'pipeline_failed', message: result.error });
      return;
    }
    sendJson(res, 202, { status: 'ok', digest: result.digest });
  }

  private async handleLatest(res: ServerResponse): Promise<void> {
    const digest = await getLatestDigest();
    if (!digest) {
      sendJson(res, 404, { error: 'no_digest_yet' });
      return;
    }
    sendJson(res, 200, { digest, lastRun: getState().lastRun });
  }

  private checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
    const expected = this.options.triggerToken;
    if (!expected) return true;

    const header = req.headers.authorization;
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (provided !== expected) {
      sendJson(res, 401, { error: 'unauthorized' });
      return false;
    }
    return true;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
