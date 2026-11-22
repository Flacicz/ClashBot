import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { type AddressInfo } from 'node:net';

import { createSelfSignedLoopbackCert } from './selfSignedCert.js';

export interface RecordedRequest {
    readonly method: string;
    readonly url: string;
    readonly headers: Readonly<http.IncomingHttpHeaders>;
}

export type LoopbackHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    recorded: RecordedRequest,
) => void | Promise<void>;

export interface LoopbackServer {
    readonly baseUrl: string;
    readonly requests: readonly RecordedRequest[];
    close(): Promise<void>;
}

export async function startLoopbackServer(
    handler: LoopbackHandler,
    options?: { readonly tls?: boolean },
): Promise<LoopbackServer> {
    const requests: RecordedRequest[] = [];
    const listener = (req: IncomingMessage, res: ServerResponse): void => {
        const recorded: RecordedRequest = {
            method: req.method ?? 'GET',
            url: req.url ?? '/',
            headers: { ...req.headers },
        };
        requests.push(recorded);
        void Promise.resolve(handler(req, res, recorded)).catch(() => {
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end('Internal test server error');
            }
        });
    };

    const useTls = options?.tls ?? false;
    const server = useTls
        ? https.createServer(createSelfSignedLoopbackCert(), listener)
        : http.createServer(listener);

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address() as AddressInfo;
    const scheme = useTls ? 'https' : 'http';
    const baseUrl = `${scheme}://127.0.0.1:${String(address.port)}`;

    return {
        baseUrl,
        requests,
        async close(): Promise<void> {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        },
    };
}
