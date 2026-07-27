// utils/multirregistro-parser.ts
import { MappedRow } from '../processors/processor.interface';
import { MultirregistroConfig } from '../mapping-types';

/**
 * Parser de archivos MULTIRREGISTRO (caso Toyota cuenta 87).
 *
 * Convierte un archivo con varios tipos de línea en las filas normalizadas que consume el
 * pipeline de importación, para no tocar el runner ni los processors existentes.
 *
 * Formato de entrada (ver `MultirregistroConfig`):
 *   CLI → ficha del cliente        → un caso (deudor + contactos)
 *   GES → un aviso de un contrato  → una factura del caso
 *   DET → concepto del aviso       → desglose del importe de esa factura
 *   BAJ → baja de un aviso         → fila aparte (el aviso NO viene en el GES del mismo archivo)
 *
 * Emite dos clases de fila, distinguidas por `_tipo`:
 *   - `CASO`: un cliente con sus facturas (`_blocks` FACTURA) y contactos (`_blocks` CONTACTO).
 *   - `BAJA`: un aviso a dar de baja, suelto.
 *
 * Decisiones aplicadas (spec §B.1.3): el importe de cada factura se calcula sumando los DET
 * **con su signo** (hay notas de crédito negativas) en vez de leer el total que trae el GES.
 */

/** Marcador del tipo de fila emitida, para que el processor sepa qué recibió. */
export type TipoFilaMultirregistro = 'CASO' | 'BAJA';

export interface ResultadoParseo {
    filas: MappedRow[];
    /** Problemas que no impiden seguir, para reportar como advertencia del import. */
    advertencias: string[];
    resumen: {
        lineas: number;
        porTipo: Record<string, number>;
        casos: number;
        facturas: number;
        bajas: number;
        /** Líneas cuyo código de tipo no está en la config (padding, encabezados, basura). */
        ignoradas: number;
    };
}

/** Lee una columna 1-based de la línea ya separada, con trim. Devuelve '' si no existe. */
function col(campos: string[], idx1: number | undefined): string {
    if (idx1 == null) return '';
    const v = campos[idx1 - 1];
    return v == null ? '' : String(v).trim();
}

function parseImporte(raw: string): number {
    if (!raw) return 0;
    // El cedente manda punto decimal y sin separador de miles. Se conserva el signo: los
    // "ACR-Remanente Anticipo" vienen en negativo y restan del total del aviso.
    const n = Number(raw.replace(/[^\d.,-]/g, '').replace(/,/g, '.'));
    return Number.isFinite(n) ? n : 0;
}

/**
 * Arma el texto del desglose de una factura a partir de sus conceptos.
 * Los conceptos sin valor (los que el cedente manda siempre en 0 y son ruido del formato) se
 * omiten; los días de mora se agregan al final porque son un dato de gestión, no un cargo.
 */
function armarDesglose(
    dets: Array<{ concepto: string; importe: number; dias: string }>,
    cfg: MultirregistroConfig['det'],
): string {
    const ignorados = cfg.conceptosIgnorados ?? [];
    const esIgnorado = (c: string) => ignorados.some((p) => c.toLowerCase().startsWith(p.toLowerCase()));

    const partes: string[] = [];
    let diasMora = '';

    for (const d of dets) {
        const concepto = d.concepto.replace(/\s+/g, ' ').trim();
        if (cfg.conceptoDiasMora && concepto.toLowerCase().startsWith(cfg.conceptoDiasMora.toLowerCase())) {
            if (d.dias) diasMora = d.dias;
            continue;
        }
        if (esIgnorado(concepto)) continue;
        partes.push(`${concepto}: ${d.importe.toFixed(2)}`);
    }

    if (diasMora) partes.push(`Días de mora: ${diasMora}`);
    return partes.join(' | ');
}

/**
 * Parsea el contenido completo del archivo. Recibe el buffer crudo porque la decodificación es
 * parte del contrato: Toyota manda Latin-1 y leerlo como UTF-8 rompe las Ñ y los acentos de los
 * nombres (y en Node ni siquiera falla: mete caracteres de reemplazo silenciosamente).
 *
 * @param separador Separador de columnas de la plantilla (default `;`).
 */
export function parseMultirregistro(
    buffer: Buffer,
    cfg: MultirregistroConfig,
    separador = ';',
): ResultadoParseo {
    const texto = buffer.toString(cfg.encoding === 'utf8' ? 'utf8' : 'latin1');
    const discrIdx = cfg.discriminadorIndex ?? 0;
    // El separador sale de la plantilla (combo "Formato / Separador"), no está fijo: distintos
    // cedentes usan distintos caracteres aunque el formato multirregistro sea el mismo.
    const sep = separador || ';';

    const advertencias: string[] = [];
    const porTipo: Record<string, number> = {};
    let ignoradas = 0;

    /** Fichas de cliente, por nro de cliente. */
    const clientes = new Map<string, string[]>();
    /** Avisos (GES), por nro de aviso. */
    const avisos = new Map<string, { nroCliente: string; contrato: string; aviso: string }>();
    /** Conceptos (DET) por nro de aviso. */
    const detalles = new Map<string, Array<{ concepto: string; importe: number; dias: string }>>();
    /** Bajas. */
    const bajas: Array<{ aviso: string; fecha: string; motivo: string }> = [];

    const lineas = texto.split(/\r?\n/);
    let lineasUtiles = 0;

    for (const linea of lineas) {
        if (!linea.trim()) continue;
        lineasUtiles++;
        const campos = linea.split(sep);
        const codigo = (campos[discrIdx] ?? '').trim().toUpperCase();
        porTipo[codigo] = (porTipo[codigo] ?? 0) + 1;

        if (codigo === cfg.cli.codigo) {
            const nro = col(campos, cfg.cli.nroCliente);
            if (!nro) { advertencias.push('Línea CLI sin nro de cliente — se omite.'); continue; }
            if (clientes.has(nro)) {
                advertencias.push(`Cliente ${nro} repetido en el archivo — se conserva la primera ficha.`);
                continue;
            }
            clientes.set(nro, campos);

        } else if (codigo === cfg.ges.codigo) {
            const aviso = col(campos, cfg.ges.aviso);
            const nroCliente = col(campos, cfg.ges.nroCliente);
            if (!aviso || !nroCliente) {
                advertencias.push(`Línea GES incompleta (aviso="${aviso}", cliente="${nroCliente}") — se omite.`);
                continue;
            }
            if (avisos.has(aviso)) {
                advertencias.push(`Aviso ${aviso} repetido en GES — se conserva el primero.`);
                continue;
            }
            avisos.set(aviso, { nroCliente, contrato: col(campos, cfg.ges.contrato), aviso });

        } else if (codigo === cfg.det.codigo) {
            const aviso = col(campos, cfg.det.aviso);
            if (!aviso) { advertencias.push('Línea DET sin nro de aviso — se omite.'); continue; }
            const lista = detalles.get(aviso) ?? [];
            lista.push({
                concepto: col(campos, cfg.det.concepto),
                importe: parseImporte(col(campos, cfg.det.importe)),
                dias: col(campos, cfg.det.dias),
            });
            detalles.set(aviso, lista);

        } else if (codigo === cfg.baj.codigo) {
            const aviso = col(campos, cfg.baj.aviso);
            if (!aviso) { advertencias.push('Línea BAJ sin nro de aviso — se omite.'); continue; }
            bajas.push({ aviso, fecha: col(campos, cfg.baj.fecha), motivo: col(campos, cfg.baj.motivo) });

        } else {
            ignoradas++;
        }
    }

    // ── Armado de los casos: un deudor por ficha CLI, con una factura por aviso ──────────
    /** Avisos agrupados por cliente. */
    const avisosPorCliente = new Map<string, Array<{ contrato: string; aviso: string }>>();
    for (const a of avisos.values()) {
        const lista = avisosPorCliente.get(a.nroCliente) ?? [];
        lista.push({ contrato: a.contrato, aviso: a.aviso });
        avisosPorCliente.set(a.nroCliente, lista);
    }

    // Un aviso cuyo cliente no tiene ficha CLI no se puede cargar: el caso no tendría identidad.
    for (const [nroCliente, lista] of avisosPorCliente) {
        if (!clientes.has(nroCliente)) {
            advertencias.push(
                `Cliente ${nroCliente} tiene ${lista.length} aviso(s) en GES pero no vino su ficha CLI — se omite el caso.`,
            );
        }
    }

    const filas: MappedRow[] = [];
    let facturasEmitidas = 0;

    for (const [nroCliente, campos] of clientes) {
        const misAvisos = avisosPorCliente.get(nroCliente) ?? [];
        if (misAvisos.length === 0) {
            advertencias.push(`Cliente ${nroCliente} vino en CLI pero sin ningún aviso en GES — se omite.`);
            continue;
        }

        const blocks: MappedRow['_blocks'] = [];

        for (const { contrato, aviso } of misAvisos) {
            const dets = detalles.get(aviso) ?? [];
            if (dets.length === 0) {
                advertencias.push(`Aviso ${aviso} (cliente ${nroCliente}) sin líneas DET — factura en 0.`);
            }
            const importe = dets.reduce((acc, d) => acc + d.importe, 0);
            blocks.push({
                entity: 'FACTURA',
                data: {
                    nroFactura: aviso,
                    importe,
                    contrato,
                    detalle: armarDesglose(dets, cfg.det),
                },
            });
            facturasEmitidas++;
        }

        // Contactos: el cedente manda el código de área en una columna aparte del número.
        const codArea = col(campos, cfg.cli.codArea);
        for (const idx of cfg.cli.telefonos ?? []) {
            const tel = col(campos, idx);
            if (tel) blocks.push({ entity: 'CONTACTO', data: { tipo: 'telefono', valor: `${codArea}${tel}` } });
        }
        const email = col(campos, cfg.cli.email);
        if (email) blocks.push({ entity: 'CONTACTO', data: { tipo: 'email', valor: email } });

        const domicilio = (cfg.cli.domicilio ?? [])
            .map((i) => col(campos, i))
            .filter(Boolean)
            .join(' ');

        const camposAdicionales: Record<string, string> = {};
        for (const [clave, idx] of Object.entries(cfg.cli.adicionales ?? {})) {
            const v = col(campos, idx);
            if (v) camposAdicionales[clave] = v;
        }
        if (domicilio) camposAdicionales['domicilio'] = domicilio;

        filas.push({
            _tipo: 'CASO' as TipoFilaMultirregistro,
            nroCliente,
            nombre: col(campos, cfg.cli.nombre),
            camposAdicionales,
            _blocks: blocks,
        });
    }

    for (const b of bajas) {
        filas.push({ _tipo: 'BAJA' as TipoFilaMultirregistro, aviso: b.aviso, fecha: b.fecha, motivo: b.motivo });
    }

    return {
        filas,
        advertencias,
        resumen: {
            lineas: lineasUtiles,
            porTipo,
            casos: filas.filter((f) => f._tipo === 'CASO').length,
            facturas: facturasEmitidas,
            bajas: bajas.length,
            ignoradas,
        },
    };
}
