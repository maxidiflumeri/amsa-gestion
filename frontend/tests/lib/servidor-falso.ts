// Backend falso: HTTP de verdad (node:http) + socket.io de verdad en el namespace /rt, en 127.0.0.1:47831 (o `FE_TEST_PUERTO`).
// El frontend bajo prueba le habla con su axios y su socket.io-client reales.
import http from 'node:http';
import { Server, type Socket } from 'socket.io';

export const PUERTO = Number(process.env.FE_TEST_PUERTO || 47831);

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
    /**
     * Respuesta en streaming (SSE): cada trozo se escribe tal cual, con `pausaMs` entre uno y otro, para que el cliente los
     * reciba de a uno. Un evento SSE se arma con `evento('texto', { delta: 'Hola' })`; un trozo puede cortar un evento a la mitad.
     * - `cerrar: false`: después del último trozo la conexión queda abierta hasta que el cliente la corte (para probar "Detener").
     * - `destruir: true`: después del último trozo se corta la conexión de golpe, sin cerrar el cuerpo (red caída a mitad).
     */
    stream?: { trozos: string[]; pausaMs?: number; tipo?: string; cerrar?: boolean; destruir?: boolean; status?: number };
};

/** Un evento SSE tal como lo manda el backend del asistente: `event: <nombre>\ndata: <json>\n\n`. */
export const evento = (nombre: string, data: unknown) => `event: ${nombre}\ndata: ${JSON.stringify(data)}\n\n`;
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
    /** Cuántas respuestas en streaming terminaron porque el CLIENTE cortó la conexión (no por fin del guion). */
    streamsCortadosPorElCliente = 0;

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
                        if (resp.stream) {
                            const st = resp.stream;
                            let cerradoPorCliente = false;
                            let destruidoPorMi = false;
                            res.on('close', () => { if (!res.writableFinished && !destruidoPorMi) { cerradoPorCliente = true; this.streamsCortadosPorElCliente++; } });
                            res.writeHead(st.status ?? 200, { 'content-type': st.tipo ?? 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform' });
                            res.flushHeaders();
                            for (const trozo of st.trozos) {
                                if (cerradoPorCliente) return;
                                res.write(trozo);
                                if (st.pausaMs) await new Promise((ok) => setTimeout(ok, st.pausaMs));
                            }
                            if (st.destruir) { destruidoPorMi = true; res.destroy(); return; }
                            if (st.cerrar === false) {
                                // Abierta hasta que el cliente corte (o el servidor se baje).
                                await new Promise<void>((ok) => { if (cerradoPorCliente) ok(); else res.once('close', () => ok()); });
                                return;
                            }
                            if (!cerradoPorCliente) res.end();
                            return;
                        }
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
