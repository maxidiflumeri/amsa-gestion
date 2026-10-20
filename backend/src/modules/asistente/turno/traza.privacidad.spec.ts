import * as path from 'path';
import { Logger } from '@nestjs/common';
import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages';
import { CatalogoService } from '../../reportes/catalogo/catalogo.service';
import { DetalleRespuesta } from '../dto/asistente.tipos';
import { PRECIOS_DEFAULT } from '../modelo/precios';
import { catalogoCompacto } from '../reportes/prompt/catalogo-compacto';
import { CAPACIDADES_TODAS, Vocabulario } from '../reportes/tipos-reportes';
import { PuertoPrueba, ResultadoPrueba, TurnoReportesRunner } from '../reportes/turno-reportes.runner';
import { WikiIndice } from '../wiki/wiki-indice';
import { ClienteConTiempos, GuionLlamada, RelojFalso, medicionConPrecio, usageCrudo } from './doble-stream-con-tiempos';
import { resumenParaLog } from './detalle';
import { TrazaTurno } from './traza';
import { TurnoRunner } from './turno-runner';

/**
 * Privacidad del detalle (docs/asistente-detalle-spec.md §8.4): el detalle lleva nombres, tiempos, tokens y costo. Ni el
 * razonamiento, ni el texto, ni los argumentos, ni los resultados de las herramientas, ni lo que escribió la persona.
 */

const SENSIBLES = {
    dni: '30111222',
    cuit: '20-30111222-4',
    mail: 'maria.gomez@ejemplo.com',
    nombre: 'Juan Carlos Pérez',
    telefono: '1155551234',
    razonamiento: 'razonamiento-secreto-del-modelo',
    respuesta: 'respuesta-con-datos-de-la-persona',
};
const PRECIO = PRECIOS_DEFAULT['us.anthropic.claude-sonnet-5-5'];
const wiki = WikiIndice.desdeDirectorio(path.join(__dirname, '..', '__fixtures__', 'ayuda'));

const usage = usageCrudo({ entrada: 500, salida: 300, thinking: 200, cacheLectura: 1000 });
const razonamiento = { type: 'thinking', thinking: SENSIBLES.razonamiento, signature: 'firma' } as unknown as ContentBlock;
const textoBloque = (text: string) => ({ type: 'text', text, citations: null }) as ContentBlock;
const uso = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as unknown as ContentBlock;

/** Un guion «display: summarized»: el razonamiento llega con texto, y todo lo demás también. */
function llamada(content: ContentBlock[], stop_reason: GuionLlamada['stop_reason']): GuionLlamada {
    const eventos: GuionLlamada['eventos'] = [{ en: 100, e: { tipo: 'conexion' } }, { en: 200, e: { tipo: 'inicio_mensaje' } }];
    let en = 300;
    content.forEach((b, indice) => {
        const bloque = b.type === 'thinking' ? 'thinking' : b.type === 'tool_use' ? 'tool_use' : 'text';
        eventos.push({ en, e: { tipo: 'inicio_bloque', indice, bloque, ...(b.type === 'tool_use' ? { herramienta: b.name } : {}) } });
        eventos.push({ en: en + 100, e: { tipo: 'fin_bloque', indice } });
        en += 200;
    });
    eventos.push({ en, e: { tipo: 'fin_mensaje' } });
    const textos = content.filter((b) => b.type === 'text').map((b, i) => ({ en: 350 + i, delta: (b as { text: string }).text }));
    return { eventos, textos, duracion: en + 10, content, stop_reason, usage };
}

function sinSensibles(que: string, donde: string) {
    for (const [clave, valor] of Object.entries(SENSIBLES)) {
        // El texto de la respuesta que el test mismo manda al navegador no es del detalle: ver abajo.
        expect({ donde, clave, aparece: que.includes(valor) }).toEqual({ donde, clave, aparece: false });
    }
}

describe('privacidad del detalle', () => {
    const logs: string[] = [];
    beforeEach(() => {
        logs.length = 0;
        for (const nivel of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
            jest.spyOn(Logger.prototype, nivel).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
        }
    });
    afterEach(() => jest.restoreAllMocks());

    function verificar(d: DetalleRespuesta) {
        // El detalle entero, con lo que lleva el armado, no tiene ningún valor sensible.
        sinSensibles(JSON.stringify(d), 'detalle');
        sinSensibles(resumenParaLog(d), 'resumen del log');
        sinSensibles(logs.join('\n'), 'logs del turno');
        // Y los únicos textos libres del tipo son las descripciones que arma el backend, de 160 caracteres como mucho.
        const textos: string[] = [];
        const recorrer = (ns: DetalleRespuesta['nodos']) => ns.forEach((n) => (n.descripcion && textos.push(n.descripcion), recorrer(n.hijos ?? [])));
        recorrer(d.nodos);
        for (const t of textos) expect(Array.from(t).length).toBeLessThanOrEqual(160);
    }

    it('un turno de la ayuda', async () => {
        const reloj = new RelojFalso();
        const traza = new TrazaTurno({ funcion: 'ayuda', modelo: 'us.anthropic.claude-sonnet-5-5', precio: PRECIO, reloj: reloj.ahora });
        const cliente = new ClienteConTiempos(reloj, [
            llamada(
                [
                    razonamiento,
                    uso('b1', 'buscar_en_wiki', { texto: `${SENSIBLES.dni} ${SENSIBLES.mail}` }),
                    uso('o1', 'ofrecer_ir_a', { ruta: '/reportes/nuevo', motivo: `para ${SENSIBLES.nombre} ${SENSIBLES.cuit}` }),
                ],
                'tool_use',
            ),
            llamada([razonamiento, textoBloque(`Fuente: [Armar un reporte](/ayuda/reportes/armar-un-reporte) ${SENSIBLES.respuesta}`)], 'end_turn'),
        ]);
        const runner = new TurnoRunner({
            cliente,
            wiki,
            topes: { verificarIteracion: async () => undefined },
            medicion: medicionConPrecio(PRECIO),
            modelo: 'us.anthropic.claude-sonnet-5-5',
            strict: true,
            maxTokensContexto: 60000,
        });
        const r = await runner.correr({
            funcion: 'ayuda',
            pregunta: `¿Qué hago con el DNI ${SENSIBLES.dni}?`,
            ruta: '/gestion',
            persona: { nombre: SENSIBLES.nombre, rol: 'ADMIN', permisos: ['reportes.ver', 'reportes.crear'] },
            ahora: new Date('2026-10-16T17:05:00Z'),
            historial: [],
            ultimoPromptTokens: 0,
            ids: { usuarioId: 7, conversacionId: 3, mensajeId: 11 },
            signal: new AbortController().signal,
            emitir: () => undefined,
            traza,
        });
        const d = traza.armar({ estado: r.estado });
        // Hubo de todo para filtrar: el turno usó herramientas y la respuesta lleva el dato.
        expect(d.nodos.filter((n) => n.tipo === 'herramienta')).toHaveLength(2);
        expect(r.texto).toContain(SENSIBLES.respuesta);
        verificar(d);
    });

    it('un turno de reportes', async () => {
        const catalogo = await new CatalogoService(null as never).getCatalogo('deudor', 3);
        const reloj = new RelojFalso();
        const traza = new TrazaTurno({ funcion: 'reportes', modelo: 'us.anthropic.claude-sonnet-5-5', precio: PRECIO, reloj: reloj.ahora });
        const propuesta = {
            nombre: `Cartera de ${SENSIBLES.nombre}`,
            empresa: 'TOYOTA',
            formatoSalida: 'xlsx',
            opciones: {},
            definicion: {
                columnas: [{ label: 'DNI', path: 'documento' }],
                filtros: [{ path: 'documento', operador: 'eq', valor: SENSIBLES.dni }],
                ordenamientos: [],
                cardinalidadDefault: 'concatenar',
            },
            mapeo: [{ columnaEjemplo: null, label: 'DNI', estado: 'agregada', nota: SENSIBLES.mail }],
        };
        const cliente = new ClienteConTiempos(reloj, [
            llamada([razonamiento, uso('v1', 'valores_de_campo', { campo: 'empresa.nombre', buscar: SENSIBLES.cuit }), uso('t1', 'probar_plantilla', propuesta)], 'tool_use'),
            llamada([razonamiento, textoBloque(`Listo. ${SENSIBLES.respuesta}`)], 'end_turn'),
        ]);
        const vocab: Record<string, Vocabulario> = { 'empresa.nombre': { valores: ['TOYOTA'], cerrado: true } };
        const prueba: PuertoPrueba = {
            probar: async (a) =>
                ({
                    tipo: 'ok',
                    id: 'p1',
                    propuestaId: 1,
                    casos: 10,
                    aproximado: false,
                    columnasVacias: [],
                    avisos: a.avisosValidador,
                    textoParaModelo: `Muestra: ${SENSIBLES.nombre}, tel ${SENSIBLES.telefono}`,
                }) as ResultadoPrueba,
        };
        const runner = new TurnoReportesRunner({
            cliente,
            topes: { verificarIteracion: async () => undefined },
            medicion: medicionConPrecio(PRECIO),
            modelo: 'us.anthropic.claude-sonnet-5-5',
            strict: true,
            timeoutMs: 120_000,
            catalogo,
            catalogoTexto: catalogoCompacto(catalogo),
            capacidades: CAPACIDADES_TODAS,
            vocabularios: {
                preparar: async () => undefined,
                valores: async () => ({ ok: true, texto: `TOYOTA\n${SENSIBLES.nombre} ${SENSIBLES.telefono}` }),
                vocabulario: (p) => vocab[p] ?? null,
                empresas: () => [{ id: 1, nombre: 'TOYOTA', casos: 10 }],
                formatosTelefono: () => new Map([[1, '549{numero}']]),
                nombresPlantillas: () => new Set<string>(),
            },
            datosAdicionales: { claves: async () => ({ ok: true, claves: [] }) },
            prueba,
            propuestas: { mostrar: async () => null },
        });
        const r = await runner.correr({
            pregunta: `Armame el reporte del DNI ${SENSIBLES.dni}, mail ${SENSIBLES.mail}`,
            ruta: '/reportes',
            persona: { nombre: SENSIBLES.nombre, rol: 'ADMIN' },
            ahora: new Date('2026-10-19T17:05:00Z'),
            previos: [],
            esPrimerTurno: true,
            adjuntosNuevos: [],
            ejemplos: [],
            principalId: null,
            ultimaPropuesta: null,
            ids: { usuarioId: 7, conversacionId: 3, mensajeId: 11 },
            signal: new AbortController().signal,
            emitir: () => undefined,
            traza,
        });
        const d = traza.armar({ estado: r.estado });
        expect(d.nodos.filter((n) => n.tipo === 'herramienta').map((n) => n.nombre)).toEqual(['valores_de_campo', 'probar_plantilla']);
        verificar(d);
    });
});
