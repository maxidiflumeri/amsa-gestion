import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { MAX_MENSAJE_TARJETA, MAX_SUGERENCIAS, MAX_SUGERENCIA_LARGO } from './funcion-reportes';
import { Capacidades, EntradaProbar } from './tipos-reportes';

/**
 * Las 5 herramientas de la función `reportes` (docs/asistente-reportes-spec.md §15.2), en orden fijo: cambiar el orden o
 * los enums invalida la caché. `probar_plantilla` va sin `strict` (D-12) aunque el resto lo lleve.
 */

const NULL_O = (tipo: Record<string, unknown>) => ({ anyOf: [tipo, { type: 'null' }] });

export function esquemaProbar(cap: Capacidades): Record<string, unknown> {
    const tipos = ['texto', 'numero', 'fecha', 'boolean', 'telefono', ...(cap.E2 ? ['dias'] : [])];
    const columna: Record<string, unknown> = {
        label: { type: 'string' },
        path: { type: 'string', description: 'Path del catálogo, o "" para una columna fija.' },
        valorFijo: { type: 'string' },
        tipo: { type: 'string', enum: tipos },
        formato: { type: 'string' },
        ...(cap.E3
            ? {
                  decimales: { type: 'integer' },
                  separadorDecimal: { type: 'string', enum: [',', '.'] },
                  separadorMiles: { type: 'string', enum: ['.', ',', ''] },
              }
            : {}),
        cardinalidad: { type: 'string', enum: ['concatenar', 'primero', 'ultimo', 'expandir'] },
        separadorConcat: { type: 'string' },
        formatoTelefonoId: { type: 'integer' },
    };
    const valor = {
        anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } }],
    };
    const opciones: Record<string, unknown> = {
        separador: { type: 'string' },
        incluirHeader: { type: 'boolean' },
        bom: { type: 'boolean' },
        encoding: { type: 'string', enum: ['utf8', 'latin1'] },
        lineEnding: { type: 'string', enum: ['\r\n', '\n'] },
        anchoFijo: { type: 'array', items: { type: 'integer' } },
        ...(cap.E4
            ? {
                  alineacion: { type: 'array', items: { type: 'string', enum: ['izquierda', 'derecha'] } },
                  relleno: { type: 'array', items: { type: 'string', enum: [' ', '0'] } },
              }
            : {}),
    };
    return {
        type: 'object',
        additionalProperties: false,
        required: ['nombre', 'empresa', 'formatoSalida', 'opciones', 'definicion', 'mapeo'],
        properties: {
            nombre: { type: 'string', description: 'Nombre propuesto para la plantilla.' },
            descripcion: { type: 'string', description: 'Una línea: para qué es (opcional).' },
            empresa: NULL_O({ type: 'string' }),
            formatoSalida: { type: 'string', enum: ['xlsx', 'csv', 'txt', 'pdf'] },
            opciones: { type: 'object', additionalProperties: false, properties: opciones },
            definicion: {
                type: 'object',
                additionalProperties: false,
                required: ['columnas', 'filtros', 'ordenamientos', 'cardinalidadDefault'],
                properties: {
                    columnas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'path'], properties: columna } },
                    filtros: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['path', 'operador'],
                            properties: {
                                path: { type: 'string' },
                                operador: { type: 'string', enum: ['eq', 'neq', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'isNotNull'] },
                                valor,
                                variable: { type: 'boolean' },
                                labelVariable: { type: 'string' },
                                obligatorio: { type: 'boolean' },
                                valorPorDefecto: valor,
                            },
                        },
                    },
                    ordenamientos: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: false, required: ['path', 'direccion'], properties: { path: { type: 'string' }, direccion: { type: 'string', enum: ['asc', 'desc'] } } },
                    },
                    cardinalidadDefault: { type: 'string', enum: ['concatenar', 'primero', 'ultimo', 'expandir'] },
                },
            },
            mapeo: {
                type: 'array',
                description: 'Una entrada por columna del ejemplo, en su orden, más las columnas agregadas a pedido.',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['columnaEjemplo', 'label', 'estado', 'nota'],
                    properties: {
                        columnaEjemplo: { ...NULL_O({ type: 'string' }), description: 'Encabezado de la columna del ejemplo (o «columna N»), o null si se agregó a pedido.' },
                        label: { type: 'string' },
                        estado: { type: 'string', enum: ['exacta', 'aproximada', 'sin_campo', 'agregada'] },
                        nota: { type: 'string', description: 'Vacía si es exacta. En las otras, en qué difiere o qué falta.' },
                    },
                },
            },
        },
    };
}

export function armarToolsReportes(cap: Capacidades, strict: boolean, strictProbar = false): Tool[] {
    const s = strict ? { strict: true } : {};
    return [
        {
            name: 'valores_de_campo',
            description:
                'Devuelve los valores posibles de un campo con vocabulario cerrado (empresas, códigos de situación, gestión y motivo, tipos de contacto, estados) o la lista de formatos de teléfono ("formatos_telefono"). Usala antes de filtrar por un valor o de poner un filtro dentro de un path.',
            ...s,
            input_schema: {
                type: 'object',
                additionalProperties: false,
                required: ['campo'],
                properties: {
                    campo: { type: 'string', description: 'Path del catálogo (ej. "estadoSituacion.clave", "contactos.tipo") o "formatos_telefono".' },
                    buscar: { type: 'string', description: 'Texto para acotar la lista (opcional).' },
                },
            },
        },
        {
            name: 'datos_adicionales',
            description: 'Devuelve las claves de los datos adicionales (camposAdicionales) que mandó una empresa.',
            ...s,
            input_schema: {
                type: 'object',
                additionalProperties: false,
                required: ['empresa'],
                properties: { empresa: { type: 'string', description: 'Nombre exacto de la empresa.' } },
            },
        },
        {
            name: 'ver_otra_hoja',
            description: 'Devuelve el perfil de otra hoja de un archivo de ejemplo de Excel, cuando la que se usó no es la que la persona quiere.',
            ...s,
            input_schema: {
                type: 'object',
                additionalProperties: false,
                required: ['ejemplo', 'hoja'],
                properties: { ejemplo: { type: 'integer', description: 'El id del <ejemplo>.' }, hoja: { type: 'string' } },
            },
        },
        {
            name: 'probar_plantilla',
            description:
                'Valida la plantilla contra el catálogo y las reglas del motor y, si es válida, la corre sobre la base: devuelve cantidades (filas de muestra, casos totales, columnas vacías en la muestra), nunca valores, y el id de la prueba. No guarda nada. Mandá siempre la plantilla completa.',
            // Sin `strict` de arranque (D-12): la primera llamada con un esquema nuevo tardó 24 a 35 s y trajo columnas vacías.
            ...(strict && strictProbar ? { strict: true } : {}),
            input_schema: esquemaProbar(cap) as Tool['input_schema'],
        },
        {
            name: 'mostrar_propuesta',
            description:
                'Muestra a la persona la tarjeta de la propuesta probada, con «Abrir en el editor» y «Ajustar algo antes». No guarda nada. Una vez por respuesta, solo con el id de una prueba sin errores.',
            ...s,
            input_schema: {
                type: 'object',
                additionalProperties: false,
                required: ['prueba', 'mensaje', 'sugerencias'],
                properties: {
                    prueba: { type: 'string', description: 'El id que devolvió probar_plantilla.' },
                    mensaje: { type: 'string', description: 'Lo que la persona tiene que saber, en 2 a 5 líneas: lo que no encontraste, lo que aproximaste y lo que supusiste. Sin repetir el mapeo.' },
                    sugerencias: { type: 'array', items: { type: 'string' }, description: 'Hasta 3 ajustes probables, cortos, como los diría la persona (ej. "Agregá el teléfono alternativo"). Puede ir vacía.' },
                },
            },
        },
    ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Forma de lo que manda el modelo (el backend la verifica aunque la herramienta no lleve `strict`)
// ---------------------------------------------------------------------------------------------------------------------

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Verifica la forma de `probar_plantilla`. El mensaje le llega al modelo como `is_error`. */
export function verificarFormaProbar(input: unknown): { ok: true; entrada: EntradaProbar } | { ok: false; error: string } {
    const mal = (campo: string, esperado: string) => ({ ok: false as const, error: `La entrada no tiene la forma esperada: ${campo} ${esperado}.` });
    if (!esObjeto(input)) return mal('la entrada', 'tiene que ser un objeto');
    const { nombre, descripcion, empresa, formatoSalida, opciones, definicion, mapeo } = input;
    if (typeof nombre !== 'string') return mal('nombre', 'es un texto');
    if (descripcion !== undefined && typeof descripcion !== 'string') return mal('descripcion', 'es un texto');
    if (empresa !== null && typeof empresa !== 'string') return mal('empresa', 'es un texto o null');
    if (typeof formatoSalida !== 'string') return mal('formatoSalida', 'es un texto (xlsx, csv, txt o pdf)');
    if (!esObjeto(opciones)) return mal('opciones', 'es un objeto (puede ir vacío)');
    if (!esObjeto(definicion)) return mal('definicion', 'es un objeto con columnas, filtros, ordenamientos y cardinalidadDefault');
    if (!Array.isArray(definicion.columnas)) return mal('definicion.columnas', 'es una lista');
    for (const [i, c] of definicion.columnas.entries()) {
        if (!esObjeto(c) || typeof c.label !== 'string' || typeof c.path !== 'string') return mal(`definicion.columnas[${i}]`, 'necesita label y path (texto; path "" para una columna fija)');
    }
    if (!Array.isArray(definicion.filtros)) return mal('definicion.filtros', 'es una lista (puede ir vacía)');
    for (const [i, f] of definicion.filtros.entries()) {
        if (!esObjeto(f) || typeof f.path !== 'string' || typeof f.operador !== 'string') return mal(`definicion.filtros[${i}]`, 'necesita path y operador');
    }
    if (definicion.ordenamientos !== undefined && !Array.isArray(definicion.ordenamientos)) return mal('definicion.ordenamientos', 'es una lista');
    if (!Array.isArray(mapeo)) return mal('mapeo', 'es una lista');
    for (const [i, m] of mapeo.entries()) {
        if (!esObjeto(m) || typeof m.label !== 'string' || typeof m.estado !== 'string' || (m.columnaEjemplo !== null && typeof m.columnaEjemplo !== 'string')) {
            return mal(`mapeo[${i}]`, 'necesita columnaEjemplo (texto o null), label y estado');
        }
        if (!['exacta', 'aproximada', 'sin_campo', 'agregada'].includes(m.estado)) return mal(`mapeo[${i}].estado`, 'es exacta, aproximada, sin_campo o agregada');
    }
    const entrada = {
        ...input,
        definicion: { ...definicion, ordenamientos: definicion.ordenamientos ?? [], cardinalidadDefault: definicion.cardinalidadDefault ?? 'concatenar' },
        mapeo: mapeo.map((m) => ({ ...m, nota: typeof (m as { nota?: unknown }).nota === 'string' ? (m as { nota: string }).nota : '' })),
    } as unknown as EntradaProbar;
    return { ok: true, entrada };
}

/** Los escapes `\uXXXX` que llegaron como texto literal (el modelo los escribió doble escapados). */
function decodificarUnicode(t: string): string {
    return t.replace(/\\+u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Saneo del texto que escribe el modelo para la persona: decodifica los `\uXXXX` literales y saca los caracteres de
 * control (en 2 de 3 turnos reales llegaron «Agreg\telefono», «Us\\u00e1», «Sum\ná tambi\ntambién»). Con `multilinea`
 * (el `mensaje`) se conservan los saltos de línea; los demás se vuelven espacio.
 */
export function sanearTexto(t: string, multilinea: boolean): string {
    const decodificado = decodificarUnicode(t);
    return decodificado
        .replace(/\r\n?/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ')
        .replace(multilinea ? /[ \t]+\n/g : /\n/g, multilinea ? '\n' : ' ')
        .replace(multilinea ? /[ ]{2,}/g : /\s{2,}/g, ' ')
        .trim();
}

/** ¿Una sugerencia sigue rota? Barras, caracteres de control en el medio de una palabra o letras partidas. */
function sugerenciaRota(original: string, saneada: string): boolean {
    if (saneada.includes('\\')) return true;
    // Un control (tab, salto de línea) en el medio de una palabra: «Agreg\telefono», «tambi\ntambién».
    if (/[\p{L}][\u0000-\u001f][\p{L}]/u.test(decodificarUnicode(original))) return true;
    return saneada.length === 0;
}

/** `mensaje` a 800 caracteres y hasta 3 sugerencias de 60 cada una, sin escapes rotos. */
export function recortarMostrar(input: Record<string, unknown>): { prueba: string; mensaje: string; sugerencias: string[] } {
    const prueba = typeof input.prueba === 'string' ? input.prueba.trim() : '';
    const mensaje = Array.from(sanearTexto(typeof input.mensaje === 'string' ? input.mensaje : '', true)).slice(0, MAX_MENSAJE_TARJETA).join('');
    const sugerencias = (Array.isArray(input.sugerencias) ? input.sugerencias : [])
        .filter((x): x is string => typeof x === 'string')
        .map((x) => ({ original: x, saneada: sanearTexto(x, false) }))
        .filter((x) => !sugerenciaRota(x.original, x.saneada))
        .slice(0, MAX_SUGERENCIAS)
        .map((x) => Array.from(x.saneada).slice(0, MAX_SUGERENCIA_LARGO).join(''));
    return { prueba, mensaje, sugerencias };
}
