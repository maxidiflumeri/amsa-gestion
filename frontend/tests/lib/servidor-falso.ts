// Backend falso: HTTP de verdad (node:http) + socket.io de verdad en el namespace /rt, en 127.0.0.1:47831.
// El frontend bajo prueba le habla con su axios y su socket.io-client reales.
import http from 'node:http';
import { Server, type Socket } from 'socket.io';

export const PUERTO = 47831;

export interface Pedido { metodo: string; ruta: string; t: number; cuerpo: Buffer; tipo: string; autorizacion: string }
export type Respuesta = {
    status?: number;
    body?: unknown;
    demoraMs?: number;
    /** Un cuerpo que no es JSON (el CSV): se manda tal cual con este `content-type`. */
    crudo?: { tipo: string; contenido: string; cabeceras?: Record<string, string> };
    /**
     * Corta la conexión sin responder: el cliente ve un error de red. jsdom no distingue una respuesta cortada a la mitad
     * (su XHR se queda esperando), así que el corte a mitad de cuerpo se simula en el adaptador de axios (ver `adaptadorQueSeCorta`).
     */
    cortar?: boolean;
};
type Manejador = (m: RegExpMatchArray, p: Pedido) => Respuesta | Promise<Respuesta>;

export class ServidorFalso {
    pedidos: Pedido[] = [];
    private rutas: Array<{ metodo: string; patron: RegExp; manejar: Manejador }> = [];
    private httpServer!: http.Server;
    io!: Server;
    sockets = new Set<Socket>();
    conexionesTotales = 0;
    /** false = el handshake de socket.io se rechaza (tiempo real bloqueado). */
    aceptarSockets = true;

    en(metodo: string, patron: RegExp, manejar: Manejador) { this.rutas.unshift({ metodo, patron, manejar }); return this; }

    async levantar() {
        this.httpServer = http.createServer((req, res) => {
            const trozos: Buffer[] = [];
            req.on('data', (c) => trozos.push(c));
            req.on('end', async () => {
                const ruta = (req.url ?? '').replace(/^\/api/, '');
                if (!(req.url ?? '').startsWith('/api')) { res.writeHead(404).end(); return; }
                const pedido: Pedido = { metodo: req.method ?? 'GET', ruta, t: Date.now(), cuerpo: Buffer.concat(trozos), tipo: String(req.headers['content-type'] ?? ''), autorizacion: String(req.headers.authorization ?? '') };
                this.pedidos.push(pedido);
                const sinQuery = ruta.split('?')[0];
                for (const r of this.rutas) {
                    if (r.metodo !== pedido.metodo) continue;
                    const m = sinQuery.match(r.patron);
                    if (!m) continue;
                    try {
                        const resp = await r.manejar(m, pedido);
                        if (resp.demoraMs) await new Promise((ok) => setTimeout(ok, resp.demoraMs));
                        if (resp.cortar) { res.destroy(); return; }
                        if (resp.crudo) {
                            res.writeHead(resp.status ?? 200, { 'content-type': resp.crudo.tipo, ...(resp.crudo.cabeceras ?? {}) });
                            res.end(resp.crudo.contenido);
                            return;
                        }
                        res.writeHead(resp.status ?? 200, { 'content-type': 'application/json' });
                        res.end(JSON.stringify(resp.body ?? {}));
                    } catch (e) {
                        res.writeHead(500, { 'content-type': 'application/json' });
                        res.end(JSON.stringify({ message: String(e) }));
                    }
                    return;
                }
                res.writeHead(404, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ message: `Ruta no prevista por el arnés: ${pedido.metodo} ${ruta}` }));
            });
        });
        this.io = new Server(this.httpServer, { cors: { origin: true }, transports: ['websocket'] });
        const rt = this.io.of('/rt');
        rt.use((_s, next) => (this.aceptarSockets ? next() : next(new Error('bloqueado por el arnés'))));
        rt.on('connection', (s) => {
            this.conexionesTotales++;
            this.sockets.add(s);
            s.on('disconnect', () => this.sockets.delete(s));
        });
        // Lo que cualquier pantalla pide de fondo.
        this.en('GET', /^\/notificaciones\/contador$/, () => ({ body: { noLeidas: 0 } }));
        await new Promise<void>((ok, mal) => { this.httpServer.once('error', mal); this.httpServer.listen(PUERTO, '127.0.0.1', ok); });
        return this;
    }

    emitir(evento: 'import:iniciada' | 'import:progreso' | 'import:finalizada' | string, dto: unknown) { this.io.of('/rt').emit(evento, dto); }

    /** Pedidos que coinciden, opcionalmente desde un instante. */
    cuantos(metodo: string, patron: RegExp, desde = 0) { return this.pedidos.filter((p) => p.metodo === metodo && patron.test(p.ruta) && p.t >= desde).length; }
    de(metodo: string, patron: RegExp) { return this.pedidos.filter((p) => p.metodo === metodo && patron.test(p.ruta)); }

    async bajar() {
        for (const s of this.sockets) s.disconnect(true);
        await new Promise<void>((ok) => this.io.close(() => ok()));
        await new Promise<void>((ok) => { this.httpServer.closeAllConnections?.(); this.httpServer.close(() => ok()); });
    }
}
