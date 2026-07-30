// utils/multiarchivo-parser.ts
import { MappedRow } from '../processors/processor.interface';
import { DomicilioMultiarchivo, MultiarchivoConfig, RolArchivoMultiarchivo } from '../mapping-types';
import { parseFechaCedente } from './fecha-cedente';

/**
 * Parser de la categoría MULTIARCHIVO (caso Toyota TCFA).
 *
 * El cedente manda **un paquete de archivos** en vez de uno solo, cada uno con su header y su
 * layout. Este parser los cruza y emite las **mismas filas normalizadas** que ya consume el
 * processor de MULTIRREGISTRO, para no duplicar la lógica de negocio (bajas por pago vs. retiro,
 * salida de gestión solo si no quedan cuotas vigentes, consolidación, promesas).
 *
 * Archivos y qué es cada uno:
 *   Deudores.txt      snapshot COMPLETO de la cartera vigente → un caso por fila
 *   DetalleDeuda.txt  las cuotas vencidas                     → una factura por fila
 *   Bajas.txt         cuotas que salen de gestión             → fila BAJA suelta
 *   CoDeudores.txt    codeudores del titular                  → contactos + adicionales del caso
 *
 * Emite dos clases de fila, distinguidas por `_tipo`:
 *   - `CASO`: un cliente con sus facturas (`_blocks` FACTURA) y contactos (`_blocks` CONTACTO).
 *   - `BAJA`: una cuota a dar de baja, suelta. La cuota NUNCA viene en el detalle del mismo día
 *     (verificado: 0 de 85 matchean), así que el processor la resuelve contra lo ya cargado.
 *
 * Spec y verificaciones sobre el archivo real: `docs/imports-toyota-tcfa-spec.md`.
 */

/** Marcador del tipo de fila emitida, para que el processor sepa qué recibió. */
export type TipoFilaMultiarchivo = 'CASO' | 'BAJA';

/** Buffers del paquete. `deudores` y `detalle` son obligatorios. */
export type ArchivosMultiarchivo = Partial<Record<RolArchivoMultiarchivo, Buffer>> & {
    deudores: Buffer;
    detalle: Buffer;
};

export interface ResultadoParseoMultiarchivo {
    filas: MappedRow[];
    /** Problemas que no impiden seguir, para reportar como advertencia del import. */
    advertencias: string[];
    resumen: {
        /** Filas útiles leídas de cada archivo (sin contar el header). */
        lineas: Record<string, number>;
        casos: number;
        facturas: number;
        bajas: number;
        codeudores: number;
        /** Cuotas del detalle que pertenecen a asignaciones que ya no están vigentes. */
        cuotasDescartadas: number;
        /** Casos que no traen ninguna cuota en el detalle. */
        casosSinDetalle: number;
    };
}

/** Un archivo del paquete ya decodificado, con el índice de sus columnas por nombre. */
interface ArchivoParseado {
    rol: string;
    /** Nombre de columna en minúsculas → índice. */
    indices: Map<string, number>;
    filas: string[][];
}

/** Marca de `contacto.relacion` para los datos que son del codeudor y no del titular. */
export const RELACION_CODEUDOR = 'CODEUDOR';

/** Cuántos ejemplos se listan en una advertencia agregada antes de cortar. */
const MAX_EJEMPLOS = 5;

/** Quita comillas envolventes y espacios de padding. Los archivos vienen a ancho fijo. */
function limpiar(v: string | undefined): string {
    if (v == null) return '';
    return v.trim().replace(/^"(.*)"$/s, '$1').trim();
}

/**
 * Convierte un importe del cedente a número.
 *
 * TCFA manda punto decimal y sin separador de miles (`161551.43`). Se conserva el signo por si
 * aparecen notas de crédito, como pasa en la cuenta 87 (en el archivo TCFA analizado no hay
 * ninguna, pero el formato no lo prohíbe).
 */
function parseImporte(raw: string): number {
    if (!raw) return 0;
    const n = Number(raw.replace(/[^\d.,-]/g, '').replace(/,/g, '.'));
    return Number.isFinite(n) ? n : 0;
}

/**
 * Decodifica un archivo, lee su header y arma el índice de columnas por nombre.
 * Los nombres se normalizan a minúsculas: el cedente escribe `codprovincia` en un archivo y
 * `CodProvincia` en otro para la misma columna.
 */
function parseArchivo(
    rol: string,
    buffer: Buffer,
    cfg: MultiarchivoConfig,
    sep: string,
): ArchivoParseado {
    const texto = buffer.toString(cfg.encoding === 'utf8' ? 'utf8' : 'latin1');
    const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
    const indices = new Map<string, number>();

    if (cfg.tieneHeader === false) {
        return { rol, indices, filas: lineas.map((l) => l.split(sep)) };
    }

    const header = (lineas[0] ?? '').split(sep);
    header.forEach((h, i) => {
        const nombre = limpiar(h).toLowerCase();
        // Si el cedente repite un nombre de columna, gana la primera: la segunda suele ser relleno.
        if (nombre && !indices.has(nombre)) indices.set(nombre, i);
    });

    return { rol, indices, filas: lineas.slice(1).map((l) => l.split(sep)) };
}

/**
 * Resuelve los índices de las columnas declaradas en la plantilla y **falla fuerte si falta alguna
 * obligatoria**, nombrándolas todas de una. Una columna mal escrita en la plantilla, si se
 * ignorara, cargaría cientos de casos con el campo vacío sin que nadie lo note.
 */
function exigirColumnas(archivo: ArchivoParseado, nombres: Array<string | undefined>): void {
    const faltantes = nombres
        .filter((n): n is string => !!n)
        .filter((n) => !archivo.indices.has(n.toLowerCase()));
    if (faltantes.length > 0) {
        throw new Error(
            `El archivo de ${archivo.rol} no tiene la(s) columna(s) ${faltantes.map((f) => `"${f}"`).join(', ')} ` +
            `que declara la plantilla. Columnas presentes: ${[...archivo.indices.keys()].join(', ')}.`,
        );
    }
}

/** Lee una columna por nombre de una fila ya separada. Devuelve '' si no está declarada o no vino. */
function col(archivo: ArchivoParseado, fila: string[], nombre: string | undefined): string {
    if (!nombre) return '';
    const i = archivo.indices.get(nombre.toLowerCase());
    return i == null ? '' : limpiar(fila[i]);
}

/**
 * Rellenos que el cedente usa para "este campo no aplica" y que no son parte del domicilio.
 *
 * En el archivo real conviven `0`, `S/N`, `SN`, `S/C` (sin calle) y `SIN_`. Sin filtrarlos, un caso
 * queda con la dirección "Barrio 7 de mayo mz 10 casa 25 **0 Dpto 0**", que además de leerse mal
 * arruina el matcheo contra Georef. Se comparan **completos**: una calle que se llama
 * "JOSE LUIS DEVOTA S/N" conserva su texto.
 */
const RELLENOS = /^(0+|S\/?N|S\/?C|SIN_?|-+|\.+)$/i;

/** Devuelve '' si el valor es uno de los rellenos del cedente. */
function sinRelleno(v: string): string {
    return RELLENOS.test(v) ? '' : v;
}

/**
 * Arma el bloque de contacto del domicilio.
 *
 * Va como contacto de tipo `direccion` y NO como dato adicional: así aparece en la sección de
 * Direcciones de la ficha, se puede editar, y si la remesa pide validar domicilios el processor lo
 * normaliza contra Georef (que necesita localidad y provincia por separado para filtrar).
 *
 * Piso y departamento se anexan al número porque el contacto no tiene campo para ellos; si Georef
 * no matchea, el texto crudo que se guarda los conserva igual.
 */
function armarDireccion(
    archivo: ArchivoParseado,
    fila: string[],
    cfg: DomicilioMultiarchivo | string[] | undefined,
): Record<string, string> | null {
    if (!cfg) return null;

    // Forma vieja (array de columnas a concatenar): se conserva para las plantillas ya guardadas.
    // Da un texto suelto, sin CP/localidad/provincia por separado, así que Georef no puede filtrar
    // — conviene regrabar la plantilla con el preset nuevo. Al menos se le sacan los rellenos.
    if (Array.isArray(cfg)) {
        const valor = cfg.map((c) => sinRelleno(col(archivo, fila, c))).filter(Boolean).join(' ');
        return valor ? { tipo: 'direccion', valor } : null;
    }

    const calle = sinRelleno(col(archivo, fila, cfg.calle));
    const numero = sinRelleno(col(archivo, fila, cfg.numero));
    if (!calle && !numero) return null;

    const piso = sinRelleno(col(archivo, fila, cfg.piso));
    const depto = sinRelleno(col(archivo, fila, cfg.departamento));
    const numeroCompleto = [numero, piso ? `Piso ${piso}` : '', depto ? `Dpto ${depto}` : '']
        .filter(Boolean)
        .join(' ');

    const out: Record<string, string> = { tipo: 'direccion', direccion_calle: calle };
    if (numeroCompleto) out.direccion_numero = numeroCompleto;
    const cp = col(archivo, fila, cfg.cp);
    const localidad = col(archivo, fila, cfg.localidad);
    const provincia = col(archivo, fila, cfg.provincia);
    if (cp) out.direccion_cp = cp;
    if (localidad) out.direccion_localidad = localidad;
    if (provincia) out.direccion_provincia = provincia;
    return out;
}

/** Lee las columnas declaradas como adicionales, salteando las vacías. */
function armarAdicionales(
    archivo: ArchivoParseado,
    fila: string[],
    mapa: Record<string, string> | undefined,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [clave, columna] of Object.entries(mapa ?? {})) {
        const v = col(archivo, fila, columna);
        if (v) out[clave] = v;
    }
    return out;
}

/** Agrega una advertencia resumida con hasta {@link MAX_EJEMPLOS} ejemplos, para no inundar. */
function advertirAgrupado(advertencias: string[], items: string[], texto: (n: number, ej: string) => string): void {
    if (items.length === 0) return;
    const ejemplos = items.slice(0, MAX_EJEMPLOS).join(', ') + (items.length > MAX_EJEMPLOS ? ', …' : '');
    advertencias.push(texto(items.length, ejemplos));
}

/**
 * El número de factura de una cuota. El archivo no trae un identificador único de cuota, así que se
 * compone: `contrato-cuota` es único por deudor (y de hecho único a nivel archivo — el contrato no
 * se comparte entre clientes).
 */
function nroFacturaDeCuota(contrato: string, cuota: string): string {
    return `${contrato}-${cuota}`;
}

/**
 * Cruza los archivos del paquete y devuelve las filas normalizadas para el pipeline de import.
 *
 * @param archivos Buffers crudos por rol. La decodificación es parte del contrato: TCFA manda
 *   Latin-1 y leerlo como UTF-8 rompe las Ñ y los acentos sin que Node se queje.
 * @param separador Separador de columnas de la plantilla (default `;`).
 */
export function parseMultiarchivo(
    archivos: ArchivosMultiarchivo,
    cfg: MultiarchivoConfig,
    separador = ';',
): ResultadoParseoMultiarchivo {
    const sep = separador || ';';
    const advertencias: string[] = [];
    const lineas: Record<string, number> = {};

    const fDeudores = parseArchivo('deudores', archivos.deudores, cfg, sep);
    const fDetalle = parseArchivo('detalle', archivos.detalle, cfg, sep);
    const fBajas = archivos.bajas ? parseArchivo('bajas', archivos.bajas, cfg, sep) : null;
    const fCodeu = archivos.codeudores ? parseArchivo('codeudores', archivos.codeudores, cfg, sep) : null;

    lineas.deudores = fDeudores.filas.length;
    lineas.detalle = fDetalle.filas.length;
    if (fBajas) lineas.bajas = fBajas.filas.length;
    if (fCodeu) lineas.codeudores = fCodeu.filas.length;

    exigirColumnas(fDeudores, [cfg.deudores.claveAsignacion, cfg.deudores.nroCliente, cfg.deudores.nombre]);
    exigirColumnas(fDetalle, [
        cfg.detalle.claveAsignacion,
        cfg.detalle.contrato,
        cfg.detalle.cuota,
        ...Object.values(cfg.detalle.conceptosImporte ?? {}),
    ]);
    if (fBajas && cfg.bajas) {
        exigirColumnas(fBajas, [cfg.bajas.nroCliente, cfg.bajas.contrato, cfg.bajas.cuota]);
    }
    if (fCodeu && cfg.codeudores) {
        exigirColumnas(fCodeu, [cfg.codeudores.titular, cfg.codeudores.nombre]);
    }

    // ── 1. Índice del detalle por asignación ────────────────────────────────────────────────
    // El join es por IdAsignacion y NO por cliente: el cedente sigue mandando cuotas de
    // asignaciones viejas, y un cliente reasignado tiene sus cuotas anteriores en el mismo
    // archivo bajo otro IdAsignacion. Pegarlas al caso vigente le inventa deuda.
    const detallePorAsignacion = new Map<string, string[][]>();
    for (const fila of fDetalle.filas) {
        const clave = col(fDetalle, fila, cfg.detalle.claveAsignacion);
        if (!clave) continue;
        const lista = detallePorAsignacion.get(clave) ?? [];
        lista.push(fila);
        detallePorAsignacion.set(clave, lista);
    }

    // ── 2. Índice de codeudores por titular ─────────────────────────────────────────────────
    const codeudoresPorTitular = new Map<string, string[][]>();
    if (fCodeu && cfg.codeudores) {
        for (const fila of fCodeu.filas) {
            const titular = col(fCodeu, fila, cfg.codeudores.titular);
            if (!titular) continue;
            const lista = codeudoresPorTitular.get(titular) ?? [];
            lista.push(fila);
            codeudoresPorTitular.set(titular, lista);
        }
    }

    // ── 3. Un CASO por fila de Deudores ─────────────────────────────────────────────────────
    const filas: MappedRow[] = [];
    const asignacionesVigentes = new Set<string>();
    const clientesVistos = new Set<string>();
    const titularesUsados = new Set<string>();
    const sinDetalle: string[] = [];
    let facturasEmitidas = 0;
    let codeudoresEmitidos = 0;

    for (const fila of fDeudores.filas) {
        const nroCliente = col(fDeudores, fila, cfg.deudores.nroCliente);
        const asignacion = col(fDeudores, fila, cfg.deudores.claveAsignacion);

        if (!nroCliente) {
            advertencias.push('Fila de Deudores sin número de cliente — se omite.');
            continue;
        }
        if (clientesVistos.has(nroCliente)) {
            advertencias.push(`Cliente ${nroCliente} repetido en Deudores — se conserva la primera ficha.`);
            continue;
        }
        clientesVistos.add(nroCliente);
        if (asignacion) asignacionesVigentes.add(asignacion);

        const blocks: MappedRow['_blocks'] = [];

        // Facturas: una por cuota vencida de esta asignación.
        const cuotas = asignacion ? (detallePorAsignacion.get(asignacion) ?? []) : [];
        if (cuotas.length === 0) sinDetalle.push(nroCliente);

        for (const cuotaFila of cuotas) {
            const contrato = col(fDetalle, cuotaFila, cfg.detalle.contrato);
            const cuota = col(fDetalle, cuotaFila, cfg.detalle.cuota);
            if (!contrato || !cuota) {
                advertencias.push(
                    `Cuota del cliente ${nroCliente} sin contrato o sin número de cuota — se omite.`,
                );
                continue;
            }

            let importe = 0;
            const partes: string[] = [];
            for (const [etiqueta, columna] of Object.entries(cfg.detalle.conceptosImporte)) {
                const v = parseImporte(col(fDetalle, cuotaFila, columna));
                importe += v;
                // Los conceptos en cero son la mayoría y no aportan nada al desglose.
                if (v !== 0) partes.push(`${etiqueta}: ${v.toFixed(2)}`);
            }
            for (const [etiqueta, valor] of Object.entries(armarAdicionales(fDetalle, cuotaFila, cfg.detalle.adicionales))) {
                partes.push(`${etiqueta}: ${valor}`);
            }

            blocks.push({
                entity: 'FACTURA',
                data: {
                    nroFactura: nroFacturaDeCuota(contrato, cuota),
                    importe,
                    contrato,
                    cuota,
                    vencimiento: parseFechaCedente(col(fDetalle, cuotaFila, cfg.detalle.vencimiento)),
                    detalle: partes.join(' | '),
                },
            });
            facturasEmitidas++;
        }

        // Contactos del titular. El cedente manda el código de área en una columna aparte.
        const codArea = col(fDeudores, fila, cfg.deudores.codArea);
        for (const columna of cfg.deudores.telefonos ?? []) {
            const tel = col(fDeudores, fila, columna);
            if (tel) blocks.push({ entity: 'CONTACTO', data: { tipo: 'telefono', valor: `${codArea}${tel}` } });
        }
        const email = col(fDeudores, fila, cfg.deudores.email);
        if (email) blocks.push({ entity: 'CONTACTO', data: { tipo: 'email', valor: email } });

        const direccion = armarDireccion(fDeudores, fila, cfg.deudores.domicilio);
        if (direccion) blocks.push({ entity: 'CONTACTO', data: direccion });

        const camposAdicionales: Record<string, any> = armarAdicionales(fDeudores, fila, cfg.deudores.adicionales);

        // Codeudores: sus teléfonos y mail van como contacto del titular marcados con `relacion`
        // —para que el gestor sepa a quién está llamando— y su identidad queda en los adicionales.
        //
        // Van DESPUÉS de los del titular a propósito: el unique de contacto es (deudorId, tipo,
        // valor) y titular y codeudor comparten teléfono más de una vez en el archivo real (p. ej.
        // el cliente 254056 y su codeudor 254057). Al insertarse con `skipDuplicates`, gana el
        // primero, que es el del titular — que es lo correcto.
        if (cfg.codeudores) {
            const mios = codeudoresPorTitular.get(nroCliente) ?? [];
            if (mios.length > 0) titularesUsados.add(nroCliente);
            const fichas: Array<Record<string, string>> = [];

            for (const cfila of mios) {
                const cCodArea = col(fCodeu!, cfila, cfg.codeudores.codArea);
                for (const columna of cfg.codeudores.telefonos ?? []) {
                    const tel = col(fCodeu!, cfila, columna);
                    if (tel) {
                        blocks.push({
                            entity: 'CONTACTO',
                            data: { tipo: 'telefono', valor: `${cCodArea}${tel}`, relacion: RELACION_CODEUDOR },
                        });
                    }
                }
                const cEmail = col(fCodeu!, cfila, cfg.codeudores.email);
                if (cEmail) {
                    blocks.push({ entity: 'CONTACTO', data: { tipo: 'email', valor: cEmail, relacion: RELACION_CODEUDOR } });
                }

                const dir = armarDireccion(fCodeu!, cfila, cfg.codeudores.domicilio);
                if (dir) {
                    blocks.push({ entity: 'CONTACTO', data: { ...dir, relacion: RELACION_CODEUDOR } });
                }

                const ficha: Record<string, string> = {
                    nro_cliente: col(fCodeu!, cfila, cfg.codeudores.nroCodeudor),
                    nombre: col(fCodeu!, cfila, cfg.codeudores.nombre),
                    ...armarAdicionales(fCodeu!, cfila, cfg.codeudores.adicionales),
                };
                const doc = col(fCodeu!, cfila, cfg.codeudores.documento);
                if (doc) ficha.documento = doc;
                fichas.push(ficha);
                codeudoresEmitidos++;
            }

            if (fichas.length > 0) camposAdicionales.codeudores = fichas;
        }

        const montoDeclarado = cfg.deudores.montoTotal
            ? parseImporte(col(fDeudores, fila, cfg.deudores.montoTotal))
            : undefined;

        filas.push({
            _tipo: 'CASO' as TipoFilaMultiarchivo,
            nroCliente,
            documento: col(fDeudores, fila, cfg.deudores.documento),
            nombre: col(fDeudores, fila, cfg.deudores.nombre),
            // Deuda vigente según el cedente. El processor la usa solo si el caso no trae cuotas;
            // si las trae, el `montoTotal` sale de la suma de las facturas.
            montoTotalDeclarado: montoDeclarado,
            camposAdicionales,
            _blocks: blocks,
        });
    }

    // ── 4. Advertencias de cruce ────────────────────────────────────────────────────────────
    const huerfanas = new Map<string, number>();
    for (const [asignacion, cuotas] of detallePorAsignacion) {
        if (!asignacionesVigentes.has(asignacion)) huerfanas.set(asignacion, cuotas.length);
    }
    const cuotasDescartadas = [...huerfanas.values()].reduce((a, b) => a + b, 0);
    advertirAgrupado(advertencias, [...huerfanas.keys()], (n, ej) =>
        `${cuotasDescartadas} cuota(s) del detalle pertenecen a ${n} asignación(es) que ya no están ` +
        `vigentes (${ej}) — se descartan: son deuda de asignaciones anteriores del cedente.`,
    );

    advertirAgrupado(advertencias, sinDetalle, (n, ej) =>
        `${n} caso(s) no traen ninguna cuota en el detalle (${ej}) — se cargan con el total ` +
        `declarado por el cedente y sin facturas.`,
    );

    const titularesHuerfanos = [...codeudoresPorTitular.keys()].filter((t) => !titularesUsados.has(t));
    advertirAgrupado(advertencias, titularesHuerfanos, (n, ej) =>
        `${n} codeudor(es) refieren a un titular que no vino en Deudores (${ej}) — se omiten.`,
    );

    // ── 5. Una fila BAJA por cuota dada de baja ─────────────────────────────────────────────
    let bajasEmitidas = 0;
    if (fBajas && cfg.bajas) {
        for (const fila of fBajas.filas) {
            const nroCliente = col(fBajas, fila, cfg.bajas.nroCliente);
            const contrato = col(fBajas, fila, cfg.bajas.contrato);
            const cuota = col(fBajas, fila, cfg.bajas.cuota);
            if (!nroCliente || !contrato || !cuota) {
                advertencias.push(
                    `Baja incompleta (cliente="${nroCliente}", contrato="${contrato}", cuota="${cuota}") — se omite.`,
                );
                continue;
            }
            filas.push({
                _tipo: 'BAJA' as TipoFilaMultiarchivo,
                nroCliente,
                nroFactura: nroFacturaDeCuota(contrato, cuota),
                contrato,
                cuota,
                fecha: parseFechaCedente(col(fBajas, fila, cfg.bajas.fecha)),
                motivo: col(fBajas, fila, cfg.bajas.motivo),
                motivoId: col(fBajas, fila, cfg.bajas.motivoId),
            });
            bajasEmitidas++;
        }
    }

    return {
        filas,
        advertencias,
        resumen: {
            lineas,
            casos: filas.filter((f) => f._tipo === 'CASO').length,
            facturas: facturasEmitidas,
            bajas: bajasEmitidas,
            codeudores: codeudoresEmitidos,
            cuotasDescartadas,
            casosSinDetalle: sinDetalle.length,
        },
    };
}
