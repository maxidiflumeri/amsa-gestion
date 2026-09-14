// src/import/import.service.ts
import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { applyTransforms } from './transforms';
import { resolveDelimiter } from './utils/delimitador';
import { FileStorageService } from './file-storage.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fastcsv from 'fast-csv';
import * as xlsx from 'xlsx';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ClonarPlantillaDto, CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';
import { AnchoFijoConfig, FiltroFila, MappingJson } from './mapping-types';
import { getProcessor, getSupportedCategories } from './processors/processor-registry';
import { importeDePago } from './processors/pagos.processor';
import { ProcessContext, MappedRow } from './processors/processor.interface';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { ProgressEmitter } from './utils/progress-emitter';
import { parseMultirregistro } from './utils/multirregistro-parser';
import { ArchivosMultiarchivo, parseMultiarchivo } from './utils/multiarchivo-parser';
import { resolverRolesArchivos } from './utils/roles-multiarchivo';
import { MulticlavesArchivoInvalidoError, motivoPrincipalRechazo, parseMulticlaves } from './utils/multiclaves-parser';
import { conOrigen, ErrorDeParseo, recorrerFilas } from './utils/recorrer-filas';
import {
    anchoTotal, inferirColumnasAnchoFijo, parseLineaAnchoFijo, validarColumnasAnchoFijo,
} from './utils/ancho-fijo';
import { validarArchivosHomogeneos } from './utils/archivos-homogeneos';
import { describirFiltros, pasaFiltro } from './utils/filtro-filas';
import { numeroRemesaMulticlaves, siguienteNumeroRemesa } from './utils/numero-remesa';
import { AcumuladorCortes, columnasDeDivision, divide, numerosSugeridos } from './utils/division-remesa';
import { ContadorColisiones, resolverIdentidad } from './utils/identidad-deudor';
import { RequestContextService } from 'src/common/logger/request-context';
import { ConsolidacionSituacionService } from '../consolidacion/consolidacion.service';
import { PromesasService } from '../promesas/promesas.service';
import { AuditoriaHelper } from '../transacciones/auditoria.helper';
import { normalizarTelefonoArgentino } from '../../common/utils/phone-utils';

/**
 * Filas que el runner acumula antes de procesarlas juntas.
 *
 * Para los processors que implementan `processBatch` (hoy ACTUALIZACIONES) es además el tamaño
 * del `IN (...)` del prefetch y el de la transacción de updates, así que gobierna cuántas idas y
 * vueltas a la base cuesta un archivo: un lote más grande = menos queries. También marca cada
 * cuánto se refresca el progreso en la UI y se persisten `okFilas`/`errFilas`.
 *
 * Configurable con `IMPORTS_BATCH_SIZE` (default 1000). Se acota a [1, 5000]: un valor mal cargado
 * no debe degradar el import ni inflar la transacción hasta retener locks de más.
 */
export const IMPORTS_BATCH_SIZE = (() => {
    const raw = Number(process.env.IMPORTS_BATCH_SIZE);
    if (!Number.isFinite(raw) || raw < 1) return 1000;
    return Math.min(Math.floor(raw), 5000);
})();

@Injectable()
export class ImportService {
    private readonly logger = new Logger(ImportService.name);

    constructor(
        private prisma: PrismaService,
        private files: FileStorageService,
        @InjectQueue('import-queue') private importQueue: Queue,
        private readonly realtimeService: RealtimeService,
        private readonly notificacionesService: NotificacionesService,
        private readonly requestContext: RequestContextService,
        private readonly consolidacion: ConsolidacionSituacionService,
        private readonly promesas: PromesasService,
        private readonly auditoria: AuditoriaHelper,
    ) { }

    // --- PLANTILLAS ---
    /**
     * Valida coherencia del `mappingJson` al guardar/editar una plantilla.
     * Combinación prohibida: `modoActualizacion=SOLO_DATOS` + `accionAusente=PAGO_TODO`
     * (contradictorio: SOLO_DATOS no reconcilia deuda, así que no puede "marcar como pagó todo").
     */
    private validarMappingPlantilla(mappingJson: any): void {
        const mapping = mappingJson as MappingJson | null | undefined;
        if (!mapping) return;
        if (mapping.modoActualizacion === 'SOLO_DATOS' && mapping.accionAusente === 'PAGO_TODO') {
            throw new BadRequestException(
                'Modo "Solo datos" es incompatible con la acción de ausentes "Marcar como pagó todo". ' +
                'Elegí "Desasignar" o "No hacer nada".',
            );
        }
    }

    async createPlantilla(dto: CreatePlantillaDto) {
        this.validarMappingPlantilla(dto.mappingJson);
        return this.prisma.plantillaimport.create({
            data: {
                empresaId: dto.empresaId,
                nombre: dto.nombre,
                categoria: dto.categoria as any,
                version: dto.version ?? 1,
                separador: dto.separador ?? '|',
                tieneHeader: dto.tieneHeader ?? false,
                mappingJson: dto.mappingJson,
                // `|| null` para que un 0/NaN (ej. plantilla ACCIONES sin estado inicial) no viole el FK.
                defaultEstadoSituacionId: dto.defaultEstadoSituacionId || null,
                defaultEstadoGestionId: dto.defaultEstadoGestionId || null,
            },
        });
    }

    async listPlantillas(empresaId: number, categoria?: string) {
        return this.prisma.plantillaimport.findMany({
            where: { empresaId, ...(categoria ? { categoria: categoria as any } : {}) },
            orderBy: [{ nombre: 'asc' }, { version: 'desc' }],
            // _count.remesa: cuántas cargas usaron la plantilla (para habilitar/bloquear "cambiar empresa")
            include: { _count: { select: { remesa: true } } },
        });
    }

    async getPlantilla(id: number) {
        const p = await this.prisma.plantillaimport.findUnique({ where: { id } });
        if (!p) throw new NotFoundException('Plantilla no encontrada');
        return p;
    }

    /** Próxima versión libre para un par (empresa, nombre), para respetar el unique [empresaId, nombre, version]. */
    private async proximaVersionPlantilla(empresaId: number, nombre: string): Promise<number> {
        const ultima = await this.prisma.plantillaimport.findFirst({
            where: { empresaId, nombre },
            orderBy: { version: 'desc' },
            select: { version: true },
        });
        return (ultima?.version ?? 0) + 1;
    }

    /** Clona una plantilla (siempre permitido). Puede ir a otra empresa y/o con otro nombre. */
    async clonarPlantilla(id: number, dto: ClonarPlantillaDto) {
        const original = await this.getPlantilla(id);
        const empresaDestino = dto.empresaId ?? original.empresaId;
        const cambiaEmpresa = empresaDestino !== original.empresaId;

        if (cambiaEmpresa) {
            const emp = await this.prisma.empresa.findUnique({ where: { id: empresaDestino } });
            if (!emp) throw new NotFoundException('Empresa destino no encontrada');
        }

        const nombre = dto.nombre?.trim() || `${original.nombre} (copia)`;
        const version = await this.proximaVersionPlantilla(empresaDestino, nombre);

        return this.prisma.plantillaimport.create({
            data: {
                empresaId: empresaDestino,
                nombre,
                categoria: original.categoria,
                version,
                activo: original.activo,
                separador: original.separador,
                tieneHeader: original.tieneHeader,
                mappingJson: original.mappingJson as any,
                // Los estados por defecto son parámetros por empresa: solo se conservan si no cambia de empresa.
                defaultEstadoSituacionId: cambiaEmpresa ? null : original.defaultEstadoSituacionId,
                defaultEstadoGestionId: cambiaEmpresa ? null : original.defaultEstadoGestionId,
            },
        });
    }

    /** Cambia la plantilla de empresa. Solo si nunca se usó (sin remesas), para no romper cargas existentes. */
    async cambiarEmpresaPlantilla(id: number, empresaId: number) {
        const plantilla = await this.getPlantilla(id);
        if (plantilla.empresaId === empresaId) {
            throw new BadRequestException('La plantilla ya pertenece a esa empresa');
        }

        const emp = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
        if (!emp) throw new NotFoundException('Empresa destino no encontrada');

        const remesaCount = await this.prisma.remesa.count({ where: { plantillaId: id } });
        if (remesaCount > 0) {
            throw new BadRequestException(
                `No se puede cambiar de empresa: la plantilla ya tiene ${remesaCount} carga(s). Cloná la plantilla a la empresa deseada.`,
            );
        }

        // Respetar el unique [empresaId, nombre, version] en el destino.
        const choca = await this.prisma.plantillaimport.findFirst({
            where: { empresaId, nombre: plantilla.nombre, version: plantilla.version },
            select: { id: true },
        });
        const version = choca ? await this.proximaVersionPlantilla(empresaId, plantilla.nombre) : plantilla.version;

        return this.prisma.plantillaimport.update({
            where: { id },
            data: {
                empresaId,
                version,
                // Reseteamos los estados por defecto (son parámetros de la empresa anterior).
                defaultEstadoSituacionId: null,
                defaultEstadoGestionId: null,
            },
        });
    }

    async updatePlantilla(id: number, data: Partial<CreatePlantillaDto>) {
        const existing = await this.prisma.plantillaimport.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Plantilla no encontrada');

        if (data.mappingJson !== undefined) this.validarMappingPlantilla(data.mappingJson);

        return this.prisma.plantillaimport.update({
            where: { id },
            data: {
                ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
                ...(data.categoria !== undefined ? { categoria: data.categoria as any } : {}),
                ...(data.version !== undefined ? { version: data.version } : {}),
                ...(data.separador !== undefined ? { separador: data.separador } : {}),
                ...(data.tieneHeader !== undefined ? { tieneHeader: data.tieneHeader } : {}),
                ...(data.mappingJson !== undefined ? { mappingJson: data.mappingJson } : {}),
                ...('defaultEstadoSituacionId' in data ? { defaultEstadoSituacionId: data.defaultEstadoSituacionId || null } : {}),
                ...('defaultEstadoGestionId' in data ? { defaultEstadoGestionId: data.defaultEstadoGestionId || null } : {}),
            },
        });
    }

    async deletePlantilla(id: number) {
        const existing = await this.prisma.plantillaimport.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Plantilla no encontrada');

        // Check if any remesa uses this plantilla
        const remesaCount = await this.prisma.remesa.count({ where: { plantillaId: id } });
        if (remesaCount > 0) {
            throw new BadRequestException(
                `No se puede eliminar: ${remesaCount} remesa(s) usan esta plantilla`
            );
        }

        return this.prisma.plantillaimport.delete({ where: { id } });
    }

    /**
     * Primeras filas de un archivo, para que el editor de plantillas muestre las columnas.
     *
     * @param anchoFijo Layout de ancho fijo. Si viene, se corta por posición y el separador se
     *   ignora — es el modo en que el operador ve, mientras arma el layout, cómo queda cortado.
     */
    async previewFile(
        file: any,
        separador: string,
        tieneHeader: boolean,
        hoja?: string,
        maxRows = 5,
        anchoFijo?: AnchoFijoConfig,
    ) {
        const rows: any[] = [];
        const isExcel = file.originalname?.match(/\.(xls|xlsx)$/i);

        if (anchoFijo && !isExcel) {
            validarColumnasAnchoFijo(anchoFijo.columnas);
            const texto = (file.buffer as Buffer).toString(anchoFijo.encoding === 'utf8' ? 'utf8' : 'latin1');
            const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
            for (const l of lineas.slice(0, maxRows + (tieneHeader ? 1 : 0))) {
                rows.push(parseLineaAnchoFijo(l, anchoFijo.columnas));
            }
            return {
                totalColumns: anchoFijo.columnas.length,
                columnas: anchoFijo.columnas.map((c) => c.nombre),
                rows: tieneHeader && rows.length > 0 ? rows.slice(1) : rows,
            };
        }

        if (isExcel) {
            const workbook = xlsx.read(file.buffer, { 
                type: 'buffer',
                cellDates: true,
                dateNF: 'yyyy-mm-dd'
            });
            // Usar la hoja especificada o la primera por defecto
            const sheetName = hoja && workbook.SheetNames.includes(hoja) ? hoja : workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Convertir a array de arrays (headers: 1 === array of arrays)
            const excelRows = xlsx.utils.sheet_to_json(worksheet, { 
                header: 1, 
                defval: '',
                raw: false // Para que use el formato de fecha definido en dateNF
            });
            
            // Tomamos los primeros maxRows (si tiene header, tal vez descartarlo luego, pero preview solo muestra maxRows)
            for (let i = 0; i < Math.min(excelRows.length, maxRows + (tieneHeader ? 1 : 0)); i++) {
                // xlsx.utils.sheet_to_json con header:1 devuelve un array sin keys si la fila está vacía
                if ((excelRows[i] as any[]).length > 0) {
                    rows.push(excelRows[i]);
                }
            }
        } else {
            // CSV
            const stream = require('stream');
            const bufferStream = new stream.PassThrough();
            bufferStream.end(file.buffer);

            const parser = fastcsv.parse({
                headers: false,
                delimiter: resolveDelimiter(separador),
                trim: false,
                maxRows: maxRows + (tieneHeader ? 1 : 0),
            });

            await new Promise<void>((resolve, reject) => {
                parser
                    .on('error', reject)
                    .on('data', (row: any) => rows.push(row))
                    .on('end', () => resolve());

                bufferStream.pipe(parser);
            });
        }

        return {
            totalColumns: rows.length > 0 ? Object.values(rows[0]).length : 0,
            rows: tieneHeader && rows.length > 0 ? rows.slice(1) : rows,
        };
    }

    /**
     * Propone un layout de ancho fijo mirando el archivo, para arrancar el editor de la plantilla.
     *
     * Es un punto de partida, no una detección confiable: los campos que vienen pegados tanto en el
     * encabezado como en los datos (en AYSA, `F. Desde` y `F. Hasta`) quedan fusionados y el
     * operador los separa a mano. Por eso la respuesta trae también el encabezado y unas líneas
     * crudas: es lo que le permite ver dónde cae cada corte.
     */
    async inferirAnchoFijo(file: any, tieneHeader: boolean, encoding?: 'latin1' | 'utf8') {
        if (!file?.buffer) throw new BadRequestException('No se subió ningún archivo.');
        if (/\.(xls|xlsx)$/i.test(file.originalname ?? '')) {
            throw new BadRequestException(
                'El ancho fijo aplica a archivos de texto. Una planilla de Excel ya viene con las columnas separadas.',
            );
        }

        const columnas = inferirColumnasAnchoFijo(file.buffer, { encoding, tieneHeader });
        const texto = (file.buffer as Buffer).toString(encoding === 'utf8' ? 'utf8' : 'latin1');
        const lineas = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6);

        this.logger.log(
            `Inferencia de ancho fijo sobre "${file.originalname}": ${columnas.length} columna(s), ` +
            `ancho ${anchoTotal(columnas)}.`,
        );

        return {
            columnas,
            ancho: anchoTotal(columnas),
            /** Encabezado y primeras líneas tal cual, para que el editor muestre dónde cae cada corte. */
            lineas,
        };
    }


    // --- CATEGORÍAS SOPORTADAS ---
    getCategories() {
        return getSupportedCategories();
    }

    /**
     * Número de remesa a usar: el que escribió el operador, o el correlativo de la empresa.
     * La lógica vive en `utils/numero-remesa.ts` (pura y testeada aparte).
     */
    private async resolverNumeroRemesa(empresaId: number, propuesto?: string): Promise<string> {
        const previas = await this.prisma.remesa.findMany({
            where: { empresaId },
            select: { numeroRemesa: true },
        });
        return siguienteNumeroRemesa(previas.map((r) => r.numeroRemesa), propuesto);
    }

    /**
     * Lee del disco los archivos del paquete de una remesa MULTIARCHIVO.
     *
     * Las rutas quedan en `remesa.archivos` (rol → path) desde el alta. Se valida acá y no solo en
     * el alta porque entre medio puede pasar cualquier cosa (limpieza de `uploads/`, restore de un
     * backup de la DB sin los archivos) y el mensaje tiene que decir qué falta, no reventar con un
     * ENOENT en el worker.
     */
    private leerPaqueteMultiarchivo(remesa: { archivos: unknown }): ArchivosMultiarchivo {
        const paths = (remesa.archivos ?? {}) as Record<string, string>;
        if (!paths.deudores || !paths.detalle) {
            throw new BadRequestException(
                'La remesa no tiene el paquete de archivos completo (faltan deudores y/o detalle de deuda). ' +
                'Volvé a crearla subiendo los archivos juntos.',
            );
        }
        const leer = (rol: string): Buffer | undefined => {
            const p = paths[rol];
            if (!p) return undefined;
            if (!fs.existsSync(p)) {
                throw new BadRequestException(`No se encuentra en el disco el archivo de ${rol} de la remesa (${p}).`);
            }
            return fs.readFileSync(p);
        };
        return {
            deudores: leer('deudores')!,
            detalle: leer('detalle')!,
            bajas: leer('bajas'),
            codeudores: leer('codeudores'),
        };
    }

    /**
     * Devuelve **todos** los archivos de una remesa de categoría clásica, en el orden en que se
     * subieron.
     *
     * Una remesa puede traer varios archivos del mismo formato, que se recorren como si fueran uno
     * solo: AYSA parte la cartera en 31 TXT (uno por sucursal) en vez de mandar uno grande. La lista
     * queda en `remesa.archivos.lista` desde el alta; las remesas viejas (y las de un solo archivo)
     * no tienen nada ahí y caen a `remesa.archivo`.
     *
     * La forma `{ lista: [...] }` no colisiona con el mapa rol → path (`{ deudores, detalle, … }`)
     * que usa MULTIARCHIVO y lee {@link leerPaqueteMultiarchivo}.
     *
     * `nombres` son los nombres con los que el operador subió cada archivo: en el disco quedan como
     * `<timestamp>_<hash>.txt` y así no sirven para ubicar un registro entre 31 archivos.
     */
    private archivosDeRemesa(
        remesa: { archivo: string | null; archivos?: unknown },
    ): { paths: string[]; nombres: string[] } {
        const guardado = remesa.archivos as { lista?: unknown; nombres?: unknown } | null;
        const lista = Array.isArray(guardado?.lista) && guardado.lista.length
            ? (guardado.lista as string[])
            : remesa.archivo
                ? [remesa.archivo]
                : [];

        const nombres = Array.isArray(guardado?.nombres)
            ? (guardado.nombres as string[])
            : lista.map((p) => path.basename(p));

        // Se valida acá y no solo en el alta porque entre medio puede pasar cualquier cosa (limpieza
        // de `uploads/`, restore de un backup de la DB sin los archivos) y el mensaje tiene que decir
        // cuál falta, no reventar con un ENOENT en el worker.
        //
        // Los nombres que se muestran son los **originales**, no los del disco: en `uploads/` los
        // archivos quedan como `<timestamp>_<hash>.txt` y ese nombre no le dice nada a nadie.
        const faltantes = lista
            .map((p, i) => ({ p, nombre: nombres[i] || path.basename(p) }))
            .filter(({ p }) => !fs.existsSync(p));

        if (faltantes.length > 0) {
            throw new BadRequestException(
                `No se encuentra(n) en el disco ${faltantes.length} de los ${lista.length} archivo(s) ` +
                `de la remesa: ${faltantes.slice(0, 5).map((f) => f.nombre).join(', ')}` +
                `${faltantes.length > 5 ? `, y ${faltantes.length - 5} más` : ''}. ` +
                'Volvé a crear la remesa subiendo los archivos de nuevo.',
            );
        }

        return { paths: lista, nombres };
    }

    /**
     * Layout de ancho fijo de la plantilla, ya validado, o `undefined` si el archivo es delimitado.
     *
     * Se valida en cada lectura (preview y worker) en vez de solo al guardar la plantilla: un layout
     * roto no se detecta mirando el resultado, produce filas con los campos corridos que se importan
     * sin error y quedan con datos de otra columna.
     */
    private layoutAnchoFijo(mapping: MappingJson | null | undefined): AnchoFijoConfig | undefined {
        if (mapping?.formato !== 'ANCHO_FIJO') return undefined;
        if (!mapping.anchoFijo) {
            throw new BadRequestException(
                'La plantilla declara formato de ancho fijo pero no tiene el layout de columnas configurado.',
            );
        }
        validarColumnasAnchoFijo(mapping.anchoFijo.columnas);
        return mapping.anchoFijo;
    }

    /**
     * Condiciones que tiene que cumplir una fila para entrar en ESTA remesa: las de la plantilla
     * (qué subconjunto del archivo sirve) más las de la propia remesa (qué corte del archivo le
     * tocó, cuando la carga se dividió por nómina/gestión). Se combinan con Y, igual que entre sí.
     */
    private filtrosDeRemesa(remesa: { filtroFilas?: any }, mapping: MappingJson | null | undefined): FiltroFila[] {
        const dePlantilla = mapping?.filtroFilas ?? [];
        const deRemesa = Array.isArray(remesa?.filtroFilas) ? (remesa.filtroFilas as FiltroFila[]) : [];
        return [...dePlantilla, ...deRemesa];
    }

    /**
     * Un archivo que no se puede leer es un problema de lo que subió el operador, no una falla del
     * sistema: tiene que volver como 400 con el motivo, no como el 500 opaco que veía antes.
     *
     * El caso real: el archivo de pagos de Personal manda la columna `PAYMENT_METHOD_DES` dos
     * veces y fast-csv cortaba con `Duplicate headers found`. Ya no puede pasar —el parser dejó de
     * interpretar el encabezado— pero cualquier otro error de formato entra por acá.
     */
    private comoErrorDeUsuario(e: any): never {
        if (e instanceof ErrorDeParseo) throw new BadRequestException(e.message);
        throw e;
    }

    /**
     * Cortes que trae un archivo, para la pantalla que decide en cuántas remesas se parte.
     *
     * Lee el archivo entero **sin guardar nada** y cuenta las filas de cada combinación
     * (nómina, gestión). El operador ve la grilla, confirma los números y recién ahí se crean las
     * remesas: es la única forma de que pueda comparar los totales contra lo que le informó el
     * cedente por mail antes de cargar nada.
     *
     * @param numeroBase Número desde el que arrancan las sugerencias. Si no viene, el correlativo
     *   siguiente de la empresa.
     */
    async previewDivision(archivos: any, plantillaId: number, empresaId: number, numeroBase?: string, hoja?: string) {
        const plantilla = await this.prisma.plantillaimport.findUnique({ where: { id: plantillaId } });
        if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

        const mapping = plantilla.mappingJson as unknown as MappingJson;
        const cfg = mapping?.divisionRemesa;
        if (!divide(cfg)) {
            throw new BadRequestException(
                'La plantilla no tiene configurada la división por nómina/gestión.',
            );
        }

        const lista: any[] = Array.isArray(archivos) ? archivos : archivos ? [archivos] : [];
        if (lista.length === 0) throw new BadRequestException('No se subió ningún archivo.');

        // Se escribe a un temporal en vez de guardarlo en uploads: mirar el archivo para decidir el
        // corte no es cargarlo, y una remesa que el operador cancela no debe dejar basura en disco.
        const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amsa-division-'));
        const paths: string[] = [];
        const nombres: string[] = [];

        try {
            for (const [i, f] of lista.entries()) {
                const nombre = f.originalname ?? `archivo_${i}`;
                const destino = path.join(dirTmp, `${i}_${path.basename(nombre)}`);
                fs.writeFileSync(destino, f.buffer);
                paths.push(destino);
                nombres.push(nombre);
            }

            const acumulador = new AcumuladorCortes(cfg!);
            let descartadas = 0;
            let total = 0;

            try {
                await recorrerFilas(
                    {
                        paths,
                        nombres,
                        tieneHeader: !!plantilla.tieneHeader,
                        separador: resolveDelimiter(plantilla.separador ?? '|'),
                        anchoFijo: this.layoutAnchoFijo(mapping),
                        hoja,
                    },
                    ({ valores }) => {
                        // El corte se calcula sobre las filas que la plantilla realmente importa.
                        if (!pasaFiltro(valores, mapping?.filtroFilas)) {
                            descartadas++;
                            return;
                        }
                        total++;
                        acumulador.agregar(valores);
                    },
                );
            } catch (e: any) {
                this.comoErrorDeUsuario(e);
            }

            const cortes = acumulador.cortes();

            // Número base de las sugerencias. El correlativo avanza por cada combinación distinta
            // de las columnas de CORTE; la gestión no avanza nada, solo prefija. Ver
            // `numerosSugeridos`.
            const previas = await this.prisma.remesa.findMany({
                where: { empresaId }, select: { numeroRemesa: true },
            });
            const base = siguienteNumeroRemesa(previas.map((r) => r.numeroRemesa), numeroBase);
            const sugeridos = numerosSugeridos(cortes, base);

            this.logger.log(
                `División (plantilla ${plantillaId}): ${cortes.length} corte(s) en ${total} fila(s) — ` +
                cortes.map((c) => `${Object.values(c.valores).join('/')}=${c.filas}`).join(', '),
            );

            return {
                columnas: columnasDeDivision(cfg).map((c) => c.etiqueta),
                total,
                descartadas: descartadas || undefined,
                cortes: cortes.map((c, i) => ({
                    valores: c.valores,
                    filas: c.filas,
                    numeroSugerido: sugeridos[i],
                    // El filtro viaja al cliente y vuelve en `divisiones`: un corte que agrupó dos
                    // variantes de la misma gestión (`3G` y `3GH`) no se puede reconstruir desde
                    // `valores`, que ahí muestra las dos juntas.
                    filtros: c.filtros,
                })),
            };
        } finally {
            fs.rmSync(dirTmp, { recursive: true, force: true });
        }
    }

    // --- REMESA / ARCHIVO ---
    /**
     * Alta de remesa.
     *
     * @param archivos Archivos subidos. MULTIARCHIVO manda un paquete de roles distintos que se
     *   resuelven por nombre (ver `roles-multiarchivo.ts`); el resto de las categorías acepta uno o
     *   varios archivos **del mismo formato**, que después se recorren como si fueran uno solo.
     */
    async createRemesa(dto: CreateRemesaDto, archivos: any, usuarioCreadorId?: number) {

        const plantilla = await this.prisma.plantillaimport.findUnique({ where: { id: dto.plantillaId } });
        if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

        // El controller manda siempre un array; se acepta un archivo suelto por compatibilidad con
        // los llamadores internos (seeds, scripts) que todavía pasan el objeto de multer.
        const lista: any[] = Array.isArray(archivos) ? archivos : archivos ? [archivos] : [];
        if (lista.length === 0) throw new BadRequestException('No se subió ningún archivo.');

        // MULTICLAVES: el número de remesa NO es el correlativo de la empresa (D5 del spec). Si lo
        // fuera, la carga de claves consumiría el próximo número y correría la numeración de las
        // asignaciones de Telecom que el operador ya viene corrigiendo a mano.
        if (dto.categoria === 'MULTICLAVES' && dto.divisiones?.length) {
            throw new BadRequestException('No se puede dividir una carga de claves de pago.');
        }
        let numeroRemesa: string;
        // Si el número lo generamos nosotros (MC-…), un choque con la unique (empresaId,numeroRemesa)
        // se resuelve solo, agregando un sufijo — el operador no tipeó nada que "cuidar". Si lo
        // escribió a mano, un choque tiene que ser un 400 claro, no cambiarle el número en silencio.
        let numeroAutoGenerado = false;
        if (dto.categoria === 'MULTICLAVES') {
            const propuesto = (dto.numeroRemesa ?? '').trim();
            if (!propuesto) {
                numeroRemesa = numeroRemesaMulticlaves(new Date());
                numeroAutoGenerado = true;
            } else if (/^\d+$/.test(propuesto)) {
                throw new BadRequestException(
                    'Las cargas de claves de pago no usan el número correlativo de remesas. ' +
                    'Dejá el número vacío o usá uno con letras.',
                );
            } else {
                numeroRemesa = propuesto;
            }
        } else {
            numeroRemesa = await this.resolverNumeroRemesa(dto.empresaId, dto.numeroRemesa);
        }

        let archivoPrincipal: string;
        let archivoHash: string;
        let paths: Record<string, string> | null = null;

        if (dto.categoria === 'MULTIARCHIVO') {
            const cfg = (plantilla.mappingJson as unknown as MappingJson)?.multiarchivo;
            if (!cfg) {
                throw new BadRequestException(
                    'La plantilla es de categoría MULTIARCHIVO pero no tiene el layout del paquete configurado.',
                );
            }

            let roles: ReturnType<typeof resolverRolesArchivos>;
            try {
                roles = resolverRolesArchivos(lista, cfg);
            } catch (e: any) {
                // Son errores de lo que subió el operador, no fallas del sistema: van como 400 con
                // el mensaje tal cual, que ya explica qué archivo falta o sobra.
                throw new BadRequestException(e.message);
            }

            paths = {};
            const hashes: string[] = [];
            for (const [rol, idx] of Object.entries(roles)) {
                const saved = await this.files.saveBuffer(lista[idx as number], dto.empresaId, dto.categoria);
                paths[rol] = saved.path;
                hashes.push(`${rol}:${saved.hash}`);
            }
            archivoPrincipal = paths.deudores;
            // Hash del paquete entero: determinístico para el mismo conjunto de archivos.
            archivoHash = crypto.createHash('sha256').update(hashes.sort().join('|')).digest('hex');

            this.logger.log(
                `Remesa MULTIARCHIVO ${numeroRemesa}: ${Object.keys(roles).length} archivo(s) — ` +
                Object.entries(roles).map(([rol, i]) => `${rol}=${lista[i as number].originalname}`).join(', '),
            );
        } else if (lista.length === 1) {
            const saved = await this.files.saveBuffer(lista[0], dto.empresaId, dto.categoria);
            archivoPrincipal = saved.path;
            archivoHash = saved.hash;
        } else {
            // Varios archivos del mismo formato: se recorren como si fueran uno solo.
            try {
                validarArchivosHomogeneos(lista, { tieneHeader: plantilla.tieneHeader ?? undefined });
            } catch (e: any) {
                // Es un error de lo que subió el operador, no una falla del sistema: va como 400 con
                // el mensaje tal cual, que ya explica qué archivo está de más o no corresponde.
                throw new BadRequestException(e.message);
            }

            const guardados: string[] = [];
            const hashes: string[] = [];
            for (const f of lista) {
                const saved = await this.files.saveBuffer(f, dto.empresaId, dto.categoria);
                guardados.push(saved.path);
                hashes.push(saved.hash);
            }
            paths = {
                lista: guardados,
                nombres: lista.map((f) => f.originalname ?? ''),
            } as any;
            // `archivo` sigue apuntando al primero: lo asumen el borrado, el chequeo de duplicados y
            // todo el código que precede al multi-archivo.
            archivoPrincipal = guardados[0];
            // Hash del conjunto: determinístico para los mismos archivos, sin depender del orden en
            // que el operador los arrastró.
            archivoHash = crypto.createHash('sha256').update([...hashes].sort().join('|')).digest('hex');

            this.logger.log(
                `Remesa ${numeroRemesa} (${dto.categoria}): ${lista.length} archivos — ` +
                lista.map((f) => f.originalname).join(', '),
            );
        }

        const comun = {
            empresaId: dto.empresaId,
            categoria: dto.categoria as any,
            plantillaId: dto.plantillaId,
            archivo: archivoPrincipal,
            archivos: paths ?? Prisma.JsonNull,
            archivoHash,
            hoja: dto.hoja,
            fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
            validarDomicilios: dto.validarDomicilios ?? false,
            estadoProceso: 'PENDIENTE' as const,
            usuarioCreadorId: usuarioCreadorId ?? null,
        };

        // ── Carga dividida: N remesas sobre el MISMO archivo ────────────────────────────────
        // Cada una se queda con su corte gracias a `remesa.filtroFilas`, que el runner suma a los
        // filtros de la plantilla. El archivo se guardó una sola vez y las N lo comparten.
        if (dto.divisiones?.length) {
            const mapping = plantilla.mappingJson as unknown as MappingJson;
            const cfg = mapping?.divisionRemesa;
            if (!divide(cfg)) {
                throw new BadRequestException(
                    'Se pidió dividir la carga pero la plantilla no tiene configurada la división ' +
                    'por nómina/gestión.',
                );
            }
            const porEtiqueta = new Map(columnasDeDivision(cfg).map((c) => [c.etiqueta, c]));

            const numeros = dto.divisiones.map((d) => String(d.numeroRemesa ?? '').trim());
            if (numeros.some((n) => !n)) {
                throw new BadRequestException('Todas las remesas de la división necesitan un número.');
            }
            const repetidos = numeros.filter((n, i) => numeros.indexOf(n) !== i);
            if (repetidos.length) {
                throw new BadRequestException(
                    `El número de remesa ${[...new Set(repetidos)].join(', ')} está repetido entre los cortes.`,
                );
            }
            const yaUsados = await this.prisma.remesa.findMany({
                where: { empresaId: dto.empresaId, numeroRemesa: { in: numeros } },
                select: { numeroRemesa: true },
            });
            if (yaUsados.length) {
                throw new BadRequestException(
                    `La empresa ya tiene la(s) remesa(s) ${yaUsados.map((r) => r.numeroRemesa).join(', ')}. ` +
                    'Elegí otros números.',
                );
            }

            const columnasValidas = new Set(columnasDeDivision(cfg).map((c) => c.fromIndex));

            const creadas: number[] = [];
            for (const [i, division] of dto.divisiones.entries()) {
                // El filtro lo calculó `division-preview` y vuelve tal cual: es el único que sabe
                // qué variantes de la gestión agrupó el corte. Se valida antes de guardarlo —el
                // cliente no puede filtrar por una columna que la plantilla no declara.
                const filtros: FiltroFila[] = Array.isArray(division.filtros) && division.filtros.length
                    ? division.filtros.map((f) => {
                        if (!columnasValidas.has(f?.fromIndex)) {
                            throw new BadRequestException(
                                `El corte filtra por la columna ${f?.fromIndex}, que no es una columna ` +
                                'de división de esta plantilla.',
                            );
                        }
                        if (f.operador !== 'IGUAL' && f.operador !== 'EN') {
                            throw new BadRequestException(
                                `El corte usa el operador ${f.operador}, que no se admite en una división.`,
                            );
                        }
                        return f;
                    })
                    : Object.entries(division.valores ?? {}).map(([etiqueta, valor]) => {
                        const columna = porEtiqueta.get(etiqueta);
                        if (!columna) {
                            throw new BadRequestException(
                                `El corte "${etiqueta}" no es una columna de división de esta plantilla.`,
                            );
                        }
                        return { fromIndex: columna.fromIndex, operador: 'IGUAL' as const, valor: String(valor) };
                    });
                if (!filtros.length) {
                    throw new BadRequestException('Un corte de la división llegó sin valores.');
                }

                const detalle = Object.entries(division.valores)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' / ');

                const creada = await this.prisma.remesa.create({
                    data: {
                        ...comun,
                        numeroRemesa: numeros[i],
                        nombre: `${dto.nombre} — ${detalle}`,
                        filtroFilas: filtros as unknown as Prisma.InputJsonValue,
                        divisionValores: division.valores as unknown as Prisma.InputJsonValue,
                    },
                    select: { id: true },
                });
                creadas.push(creada.id);
            }

            this.logger.log(
                `Carga dividida en ${creadas.length} remesa(s) para empresa ${dto.empresaId}: ` +
                `${numeros.join(', ')} (archivo compartido).`,
            );

            // `remesaId` se sigue devolviendo para no romper a los llamadores de siempre.
            return { remesaId: creadas[0], remesaIds: creadas };
        }

        if (dto.categoria === 'MULTICLAVES') {
            const remesa = await this.crearRemesaConNumeroSeguro(
                { ...comun, nombre: dto.nombre }, numeroRemesa, numeroAutoGenerado,
            );
            return { remesaId: remesa.id, remesaIds: [remesa.id] };
        }

        const remesa = await this.prisma.remesa.create({
            data: { ...comun, numeroRemesa, nombre: dto.nombre },
        });
        return { remesaId: remesa.id, remesaIds: [remesa.id] };
    }

    /**
     * Crea la remesa protegiendo la unique `(empresaId, numeroRemesa)` de un 500. Pensado para
     * MULTICLAVES: el número `MC-AAAAMMDD-HHmmss` puede chocar si dos cargas arrancan en el mismo
     * segundo (típico: el wizard crea la remesa antes de validar, y un 400 posterior + reintento, o
     * "Atrás" y volver a confirmar, disparan el alta de nuevo).
     *
     * - Número **generado por el sistema**: un choque se resuelve solo, agregando `-2`, `-3`… hasta
     *   5 intentos.
     * - Número **tipeado por el operador**: un choque es un 400 claro — no se le cambia el nombre
     *   que eligió a propósito.
     */
    private async crearRemesaConNumeroSeguro(
        data: Omit<Prisma.remesaUncheckedCreateInput, 'numeroRemesa'>,
        numeroBase: string,
        autoGenerado: boolean,
    ) {
        const MAX_INTENTOS = 5;
        let numero = numeroBase;
        for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
            try {
                return await this.prisma.remesa.create({ data: { ...data, numeroRemesa: numero } });
            } catch (e: any) {
                const esDuplicado = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
                if (!esDuplicado) throw e;
                if (!autoGenerado) {
                    throw new BadRequestException(
                        `Ya existe una remesa con el número "${numero}" en esta empresa. Probá con otro.`,
                    );
                }
                this.logger.warn(`Multiclaves: número de remesa "${numero}" ya existe, reintentando con sufijo (intento ${intento})`);
                numero = `${numeroBase}-${intento + 1}`;
            }
        }
        throw new ConflictException(
            'No se pudo generar un número de remesa único para esta carga después de varios intentos. Reintentá.',
        );
    }

    // --- PARSEAR FILAS (shared entre validate y execute) ---
    private mapRow(row: any, mapping: MappingJson): MappedRow {
        const obj: MappedRow = {};

        // Si fast-csv devuelve un objeto (tieneHeader=true), convertir a array
        const rowArr = Array.isArray(row) ? row : Object.values(row);
        obj._raw = rowArr; // fila cruda por índice (la usa la categoría ACCIONES)

        // Mapeo principal por índice
        for (const [dest, cfg] of Object.entries(mapping.columns)) {
            const raw = cfg.fromIndex === -1 ? cfg.staticValue : rowArr[cfg.fromIndex];
            obj[dest] = applyTransforms(raw, cfg.transforms);
        }

        // Mapeo de extras → camposAdicionales (JSON)
        if (mapping.extras) {
            const extrasObj: Record<string, any> = {};
            for (const [name, cfg] of Object.entries(mapping.extras)) {
                const raw = cfg.fromIndex === -1 ? cfg.staticValue : rowArr[cfg.fromIndex];
                extrasObj[name] = applyTransforms(raw, cfg.transforms);
            }
            obj.camposAdicionales = extrasObj;
        }

        // Mapeo de bloques dinámicos (N-1 repetitivos)
        if (mapping.blocks) {
            obj._blocks = [];
            for (const b of mapping.blocks) {
                const blockData: Record<string, any> = {};
                let hasData = false;
                for (const [dest, cfg] of Object.entries(b.columns)) {
                    const raw = cfg.fromIndex === -1 ? cfg.staticValue : rowArr[cfg.fromIndex];
                    const transformed = applyTransforms(raw, cfg.transforms);
                    blockData[dest] = transformed;
                    // Consideramos que el bloque tiene datos válidos si tiene al menos un valor no vacío
                    // Excepto si es un valor estático, en cuyo caso no debe marcar la fila como "hasData" por si sola
                    if (transformed !== null && transformed !== undefined && transformed !== '' && cfg.fromIndex !== -1) {
                        hasData = true;
                    }
                }
                if (hasData) {
                    obj._blocks.push({ entity: b.entity, data: blockData });
                }
            }
        }

        // Defaults
        Object.assign(obj, mapping.defaults ?? {});

        return obj;
    }

    private validateMappedRow(obj: MappedRow, mapping: MappingJson): void {
        for (const v of (mapping.validations ?? [])) {
            if (v.rule === 'required' &&
                (obj[v.field] == null || obj[v.field] === '')) {
                throw new Error(`Campo requerido faltante: ${v.field}`);
            }
        }
    }

    // --- VALIDAR (preview) ---
    async validateRemesa(remesaId: number, sampleRows = 50, hoja?: string) {
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: { plantilla: true }
        });

        if (!remesa || !remesa.archivo || !remesa.plantilla) {
            throw new NotFoundException('Remesa/archivo/plantilla no existe');
        }

        const mapping = remesa.plantilla.mappingJson as unknown as MappingJson;
        const sep = resolveDelimiter(remesa.plantilla.separador ?? '|');
        const hasHeader = !!remesa.plantilla.tieneHeader;

        let totalRows = 0;
        let ok = 0;
        let err = 0;
        const preview: any[] = [];

        // MULTIRREGISTRO: el preview no puede ser "las primeras N filas del CSV" porque una fila
        // suelta no significa nada — hay que agrupar el archivo entero primero. Se muestran los
        // primeros casos ya armados, que es lo que el operador necesita ver para confirmar.
        if (remesa.categoria === 'MULTIRREGISTRO') {
            const cfgMulti = mapping?.multirregistro;
            if (!cfgMulti) {
                throw new BadRequestException(
                    'La plantilla es de categoría MULTIRREGISTRO pero no tiene el layout del archivo configurado.',
                );
            }
            const { filas, advertencias, resumen } = parseMultirregistro(
                fs.readFileSync(remesa.archivo),
                cfgMulti,
                sep,
            );

            for (const fila of filas.slice(0, sampleRows)) {
                if (fila._tipo === 'BAJA') {
                    preview.push({ row: preview.length, data: { tipo: 'BAJA', aviso: fila.aviso, motivo: fila.motivo }, error: null });
                    continue;
                }
                const facturas = (fila._blocks ?? []).filter((b) => b.entity === 'FACTURA');
                const contactos = (fila._blocks ?? []).filter((b) => b.entity === 'CONTACTO');
                preview.push({
                    row: preview.length,
                    data: {
                        tipo: 'CASO',
                        nroCliente: fila.nroCliente,
                        nombre: fila.nombre,
                        avisos: facturas.length,
                        importeTotal: facturas.reduce((a, f) => a + (Number(f.data.importe) || 0), 0),
                        contratos: [...new Set(facturas.map((f) => f.data.contrato).filter(Boolean))].join(', '),
                        contactos: contactos.length,
                    },
                    error: null,
                });
            }

            totalRows = filas.length;
            ok = filas.length;
            err = 0;

            return {
                total: totalRows,
                ok,
                err,
                sample: preview,
                multirregistro: { ...resumen, advertencias: advertencias.slice(0, 20) },
            };
        }

        // MULTIARCHIVO: mismo criterio que MULTIRREGISTRO — una fila suelta no significa nada, hay
        // que cruzar los archivos del paquete primero y mostrar los casos ya armados.
        if (remesa.categoria === 'MULTIARCHIVO') {
            const cfgMulti = mapping?.multiarchivo;
            if (!cfgMulti) {
                throw new BadRequestException(
                    'La plantilla es de categoría MULTIARCHIVO pero no tiene el layout del paquete configurado.',
                );
            }
            const { filas, advertencias, resumen } = parseMultiarchivo(
                this.leerPaqueteMultiarchivo(remesa),
                cfgMulti,
                sep,
            );

            for (const fila of filas.slice(0, sampleRows)) {
                if (fila._tipo === 'BAJA') {
                    preview.push({
                        row: preview.length,
                        data: {
                            tipo: 'BAJA', nroCliente: fila.nroCliente,
                            factura: fila.nroFactura, motivo: fila.motivo,
                        },
                        error: null,
                    });
                    continue;
                }
                const facturas = (fila._blocks ?? []).filter((b) => b.entity === 'FACTURA');
                const contactos = (fila._blocks ?? []).filter((b) => b.entity === 'CONTACTO');
                preview.push({
                    row: preview.length,
                    data: {
                        tipo: 'CASO',
                        nroCliente: fila.nroCliente,
                        documento: fila.documento,
                        nombre: fila.nombre,
                        cuotas: facturas.length,
                        // Si el caso no trae cuotas, el único dato de deuda es el del cedente.
                        importeTotal: facturas.length > 0
                            ? facturas.reduce((a, f) => a + (Number(f.data.importe) || 0), 0)
                            : (fila.montoTotalDeclarado ?? 0),
                        contratos: [...new Set(facturas.map((f) => f.data.contrato).filter(Boolean))].join(', '),
                        contactos: contactos.length,
                    },
                    error: null,
                });
            }

            totalRows = filas.length;
            ok = filas.length;

            // A diferencia de MULTIRREGISTRO, se persiste el total: es lo que usa el runner para
            // calcular el % de progreso (sin esto la barra queda clavada en 0).
            await this.prisma.remesa.update({
                where: { id: remesaId },
                data: { estadoProceso: 'VALIDANDO', totalFilas: totalRows, okFilas: ok, errFilas: 0 },
            });

            return {
                total: totalRows,
                ok,
                err: 0,
                sample: preview,
                multiarchivo: { ...resumen, advertencias: advertencias.slice(0, 20) },
            };
        }

        // MULTICLAVES: el archivo es chico (2 MB, 15 mil líneas) — se parsea entero, no una
        // muestra. El operador tiene que ver, antes de confirmar, con qué empresa está cruzando
        // (con caso / sin caso / en otra empresa) y qué se va a rechazar.
        if (remesa.categoria === 'MULTICLAVES') {
            const cfgMulti = mapping?.multiclaves;
            if (!cfgMulti) {
                throw new BadRequestException(
                    'La plantilla es de categoría MULTICLAVES pero no tiene `mappingJson.multiclaves` configurado.',
                );
            }
            const { paths: pathsMc, nombres: nombresMc } = this.archivosDeRemesa(remesa);
            const archivosLeidos = pathsMc.map((p, i) => ({ buffer: fs.readFileSync(p), nombre: nombresMc[i] || path.basename(p) }));

            const t0 = Date.now();
            let parseado: ReturnType<typeof parseMulticlaves>;
            try {
                parseado = parseMulticlaves(archivosLeidos, cfgMulti, new Date());
            } catch (e: any) {
                if (e instanceof MulticlavesArchivoInvalidoError) throw new BadRequestException(e.message);
                throw e;
            }
            const { tramites, avisos, resumen } = parseado;
            const validos = tramites.filter((t) => !t.rechazo);
            const rechazadosTramites = tramites.filter((t) => t.rechazo);
            // Fase 1.1: trámites que llegaron con una única clave (aviso SOLO_TOTAL, siempre
            // clasificada TOTAL). Se cuentan aparte para que el operador los vea antes de confirmar
            // — son válidos, no van en `rechazados`, pero no tienen quita para ofrecer.
            const soloTotal = validos.filter((t) => t.claves!.length === 1).length;

            // Breakdown por motivo "principal" (cita la línea culpable cuando hay una sola).
            const porMotivo: Record<string, number> = {};
            for (const t of rechazadosTramites) {
                const m = motivoPrincipalRechazo(t);
                porMotivo[m] = (porMotivo[m] ?? 0) + 1;
            }

            // ── Cruces contra deudor, en chunks de 1000 ──────────────────────────────
            const nroTramitesValidos = validos.map((t) => t.nroTramite);
            const conCasoSet = new Set<string>();
            const enOtraEmpresaMap = new Map<number, { empresaId: number; empresa: string; tramites: number }>();

            for (let i = 0; i < nroTramitesValidos.length; i += 1000) {
                const chunk = nroTramitesValidos.slice(i, i + 1000);
                const conCaso = await this.prisma.deudor.findMany({
                    where: { empresaId: remesa.empresaId, nroCliente: { in: chunk } },
                    select: { nroCliente: true },
                    distinct: ['nroCliente'],
                });
                for (const c of conCaso) if (c.nroCliente) conCasoSet.add(c.nroCliente);

                const sinCasoChunk = chunk.filter((n) => !conCasoSet.has(n));
                if (sinCasoChunk.length === 0) continue;
                const otras = await this.prisma.deudor.findMany({
                    where: { nroCliente: { in: sinCasoChunk }, empresaId: { not: remesa.empresaId } },
                    select: { empresaId: true, nroCliente: true },
                    distinct: ['empresaId', 'nroCliente'],
                });
                for (const o of otras) {
                    const entry = enOtraEmpresaMap.get(o.empresaId) ?? { empresaId: o.empresaId, empresa: '', tramites: 0 };
                    entry.tramites++;
                    enOtraEmpresaMap.set(o.empresaId, entry);
                }
            }
            if (enOtraEmpresaMap.size > 0) {
                const empresasInfo = await this.prisma.empresa.findMany({
                    where: { id: { in: [...enOtraEmpresaMap.keys()] } },
                    select: { id: true, nombre: true },
                });
                for (const e of empresasInfo) {
                    const entry = enOtraEmpresaMap.get(e.id);
                    if (entry) entry.empresa = e.nombre;
                }
            }

            // ── yaCargadas / conflictos / reemisiones, en chunks de 1000 convenios ───
            const conveniosValidos = [...new Set(validos.flatMap((t) => t.claves!.map((c) => c.nroConvenio)))];
            const existentesPorConvenio = new Map<string, { empresaId: number; nroTramite: string }>();
            for (let i = 0; i < conveniosValidos.length; i += 1000) {
                const chunk = conveniosValidos.slice(i, i + 1000);
                const existentes = await this.prisma.clave_pago.findMany({
                    where: { nroConvenio: { in: chunk } },
                    select: { nroConvenio: true, empresaId: true, nroTramite: true },
                });
                for (const e of existentes) existentesPorConvenio.set(e.nroConvenio, e);
            }

            let yaCargadas = 0;
            let conflictos = 0;
            const candidatosReemision: string[] = [];
            for (const t of validos) {
                const ex = t.claves!.map((c) => existentesPorConvenio.get(c.nroConvenio)).filter((e): e is NonNullable<typeof e> => !!e);
                const conflicto = ex.find((e) => e.empresaId !== remesa.empresaId || e.nroTramite !== t.nroTramite);
                if (conflicto) { conflictos++; continue; }
                // Fase 1.1: un trámite SOLO_TOTAL trae 1 sola clave, no 2 — comparar contra un `2`
                // fijo lo dejaba afuera de "ya cargadas" en una recarga (hallazgo del auditor).
                if (ex.length === t.claves!.length) { yaCargadas++; continue; }
                if (ex.length === 0) candidatosReemision.push(t.nroTramite);
            }
            // Reemisión (la tanda nueva gana, vto ≥ vigente) vs. tanda anterior (R2: vto < vigente,
            // entra igual pero REEMPLAZADA) son cosas distintas para el operador — antes se contaban
            // las dos como "reemisión" y el texto decía "las anteriores quedan reemplazadas", que es
            // al revés para una tanda anterior (la que queda reemplazada es la que se está por cargar).
            let reemisiones = 0;
            let tandasAnteriores = 0;
            if (candidatosReemision.length > 0) {
                const vigentesExistentes = await this.prisma.clave_pago.findMany({
                    where: { empresaId: remesa.empresaId, nroTramite: { in: candidatosReemision }, estado: 'VIGENTE' },
                    select: { nroTramite: true, fechaVencimiento: true },
                });
                const vigMaxPorTramite = new Map<string, string>();
                for (const v of vigentesExistentes) {
                    const iso = v.fechaVencimiento.toISOString().slice(0, 10);
                    const actual = vigMaxPorTramite.get(v.nroTramite);
                    if (!actual || iso > actual) vigMaxPorTramite.set(v.nroTramite, iso);
                }
                const porNroTramite = new Map(validos.map((t) => [t.nroTramite, t]));
                for (const [nroTramite, vigMax] of vigMaxPorTramite) {
                    const t = porNroTramite.get(nroTramite);
                    if (!t) continue;
                    const nuevoMax = t.claves!.reduce((m, c) => (c.fechaVencimiento > m ? c.fechaVencimiento : m), t.claves![0].fechaVencimiento);
                    if (nuevoMax >= vigMax) reemisiones++; else tandasAnteriores++;
                }
            }

            // ── Vencimientos, para que el operador coteje contra lo que informó el cedente ──
            const vencimientosMap = new Map<string, number>();
            for (const t of validos) for (const c of t.claves!) {
                vencimientosMap.set(c.fechaVencimiento, (vencimientosMap.get(c.fechaVencimiento) ?? 0) + 1);
            }
            const vencimientos = [...vencimientosMap.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([fecha, claves]) => ({ fecha, claves }));

            const conCaso = conCasoSet.size;
            const sinCaso = nroTramitesValidos.length - conCaso;
            const enOtraEmpresa = [...enOtraEmpresaMap.values()];

            const advertencias: string[] = [];
            if (sinCaso > 0) {
                advertencias.push(
                    `${sinCaso.toLocaleString('es-AR')} de los ${nroTramitesValidos.length.toLocaleString('es-AR')} ` +
                    'trámites no tienen caso en esta empresa. Las claves se cargan igual: van a quedar ' +
                    'guardadas y listas para usarse desde la ficha cuando se habilite el cupón.',
                );
            }
            if (conCaso === 0 && enOtraEmpresa.length > 0) {
                const detalle = enOtraEmpresa.map((e) => `${e.tramites.toLocaleString('es-AR')} en ${e.empresa}`).join(', ');
                advertencias.push(
                    `Ninguno de los ${nroTramitesValidos.length.toLocaleString('es-AR')} trámites tiene caso en ` +
                    `esta empresa, pero ${detalle}. ¿Elegiste la empresa correcta?`,
                );
            }
            if (rechazadosTramites.length > 0) {
                const detalle = Object.entries(porMotivo).map(([m, c]) => `${c} por ${m}`).join(', ');
                advertencias.push(
                    `${rechazadosTramites.length.toLocaleString('es-AR')} trámite(s) se van a rechazar: ${detalle}. ` +
                    'Sus claves no se cargan.',
                );
            }
            if (reemisiones > 0) {
                advertencias.push(
                    `${reemisiones.toLocaleString('es-AR')} trámite(s) ya tenían claves vigentes: las anteriores ` +
                    'van a quedar reemplazadas.',
                );
            }
            if (tandasAnteriores > 0) {
                advertencias.push(
                    `${tandasAnteriores.toLocaleString('es-AR')} trámite(s) traen una tanda con vencimiento ` +
                    'ANTERIOR a la que ya está vigente: se cargan igual, pero quedan reemplazadas — la que ' +
                    'sigue vigente es la que ya estaba.',
                );
            }
            if (conflictos > 0) {
                advertencias.push(
                    `${conflictos.toLocaleString('es-AR')} convenio(s) ya están cargados en otra empresa u otro ` +
                    'trámite y se van a rechazar.',
                );
            }
            if (soloTotal > 0) {
                advertencias.push(
                    `${soloTotal.toLocaleString('es-AR')} trámite(s) llegaron con una sola clave (sin la de ` +
                    'quita): se cargan igual, clasificada como TOTAL.',
                );
            }
            for (const a of avisos) {
                // SOLO_TOTAL ya tiene su propio mensaje (más claro) arriba; no se repite acá.
                if (a.codigo === 'SOLO_TOTAL') continue;
                if (a.cantidad > 0) advertencias.push(`[${a.codigo}] ${a.cantidad} caso(s).`);
            }

            this.logger.log(
                `Preview multiclaves remesa=${remesaId} empresa=${remesa.empresaId}: ` +
                `tramites=${resumen.tramites} conCaso=${conCaso} enOtraEmpresa=${enOtraEmpresa.length} ` +
                `en ${Date.now() - t0}ms`,
            );

            await this.prisma.remesa.update({
                where: { id: remesaId },
                data: {
                    estadoProceso: 'VALIDANDO',
                    totalFilas: resumen.tramites,
                    okFilas: resumen.tramites - resumen.rechazados,
                    errFilas: resumen.rechazados,
                },
            });

            return {
                total: resumen.tramites,
                ok: resumen.tramites - resumen.rechazados,
                err: resumen.rechazados,
                sample: [],
                multiclaves: {
                    lineas: resumen.lineas,
                    claves: resumen.claves,
                    clavesRechazadas: resumen.clavesRechazadas,
                    tramites: resumen.tramites,
                    validos: validos.length,
                    rechazados: rechazadosTramites.length,
                    soloTotal,
                    porMotivo,
                    conCaso,
                    sinCaso,
                    enOtraEmpresa,
                    yaCargadas,
                    reemisiones,
                    tandasAnteriores,
                    conflictos,
                    vencimientos,
                    avisos,
                },
                advertencias: advertencias.length ? advertencias : undefined,
            };
        }

        const { paths, nombres } = this.archivosDeRemesa(remesa);
        // Las filas que el filtro descarta no son parte del import: no se cuentan en el total ni se
        // procesan. Se informan aparte para que el operador confirme el criterio antes de ejecutar
        // (ver `filtro-filas.ts`). Incluye el corte propio de la remesa si la carga se dividió.
        let descartadas = 0;
        const filtros = this.filtrosDeRemesa(remesa, mapping);
        // Importes negativos en un archivo de PAGOS: no bajan la deuda, la suben (el saldo es
        // `montoTotal - Σpagos`). Es lo que pasa con las notas de crédito de Personal, que vienen
        // todas en negativo. Se cuenta acá para poder avisarlo ANTES de ejecutar.
        let importesNegativos = 0;

        // Archivos de casos cargados con identidad por DOCUMENTO: cuántas cuentas se perderían por
        // colapsar en una sola. Se lee directo de la fila cruda (dos índices del mapeo) para no
        // pagar el mapeo completo del archivo solo para contar.
        const identidad = resolverIdentidad(mapping?.identidadDeudor);
        const esCategoriaDeCasos =
            remesa.categoria === 'DEUDORES' || remesa.categoria === 'DEUDORES_Y_FACTURAS';
        const idxDocumento = mapping?.columns?.documento?.fromIndex;
        const idxNroCliente = mapping?.columns?.nro_cliente?.fromIndex;
        const mideColisiones =
            esCategoriaDeCasos && identidad === 'DOCUMENTO' &&
            typeof idxDocumento === 'number' && idxDocumento >= 0 &&
            typeof idxNroCliente === 'number' && idxNroCliente >= 0;
        const colisiones = new ContadorColisiones();

        try {
            await recorrerFilas(
                {
                    paths,
                    nombres,
                    tieneHeader: hasHeader,
                    separador: sep,
                    anchoFijo: this.layoutAnchoFijo(mapping),
                    hoja,
                },
                ({ valores, origen }) => {
                    if (!pasaFiltro(valores, filtros)) {
                        descartadas++;
                        return;
                    }
                    if (mideColisiones) {
                        colisiones.agregar(
                            String(valores[idxDocumento!] ?? '').trim(),
                            String(valores[idxNroCliente!] ?? '').trim() || null,
                        );
                    }
                    const indice = totalRows++;
                    // El preview son las primeras N filas; el resto solo se cuenta.
                    if (indice >= sampleRows) return;
                    try {
                        const obj = this.mapRow(valores, mapping);
                        this.validateMappedRow(obj, mapping);
                        if (remesa.categoria === 'PAGOS') {
                            const imp = importeDePago(obj.importe ?? obj.monto);
                            if (imp != null && imp < 0) importesNegativos++;
                        }
                        preview.push({ row: indice, data: obj, error: null, origen });
                        ok++;
                    } catch (e: any) {
                        preview.push({ row: indice, data: null, error: conOrigen(e.message, origen), origen });
                        err++;
                    }
                },
            );
        } catch (e: any) {
            this.comoErrorDeUsuario(e);
        }

        // Avisos que no invalidan la carga pero que el operador tiene que ver antes de ejecutar.
        const advertencias: string[] = [];
        if (colisiones.colisiones > 0) {
            advertencias.push(
                `El archivo trae ${colisiones.cuentasDistintas.toLocaleString('es-AR')} cuentas de ` +
                `${colisiones.personas.toLocaleString('es-AR')} personas distintas, pero la plantilla ` +
                'identifica los casos por DOCUMENTO: ' +
                `${colisiones.colisiones.toLocaleString('es-AR')} cuenta(s) van a quedar sin cargar ` +
                '(la última del archivo pisa a las anteriores) y sus facturas y pagos después no ' +
                'van a encontrar su caso. Si en esta cartera cada cuenta es un caso, cambiá la ' +
                'plantilla a identificar por NÚMERO DE CLIENTE.',
            );
        }
        if (importesNegativos > 0) {
            advertencias.push(
                `${importesNegativos} de las primeras ${Math.min(totalRows, sampleRows)} filas traen el ` +
                'importe en NEGATIVO. Un pago negativo AUMENTA la deuda en vez de reducirla. Si son ' +
                'notas de crédito o ajustes a favor, agregá el transform `removeDashes` al importe ' +
                'en la plantilla.',
            );
        }

        await this.prisma.remesa.update({
            where: { id: remesaId },
            data: {
                estadoProceso: 'VALIDANDO',
                totalFilas: totalRows,
                okFilas: ok,
                errFilas: err
            }
        });

        return {
            total: totalRows,
            ok,
            err,
            sample: preview,
            archivos: paths.length > 1 ? nombres : undefined,
            descartadas: descartadas || undefined,
            filtro: descartadas ? describirFiltros(filtros) : undefined,
            advertencias: advertencias.length ? advertencias : undefined,
        };
    }

    // --- PREVIEW DE IMPACTO (categoría ACCIONES) ---
    /**
     * Cuenta cuántos deudores serían afectados por una plantilla de ACCIONES (modo DEUDOR),
     * leyendo las claves de match del archivo completo y contando en una sola query. No escribe.
     */
    async previewAccionesImpacto(remesaId: number, remesaOrigenId?: number, hoja?: string) {
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId }, include: { plantilla: true },
        });
        if (!remesa || !remesa.archivo || !remesa.plantilla) {
            throw new NotFoundException('Remesa/archivo/plantilla no existe');
        }
        const mapping = remesa.plantilla.mappingJson as unknown as MappingJson;
        const cfg = mapping.acciones;
        if (!cfg) throw new BadRequestException('La plantilla no es de acciones masivas');

        const esContacto = cfg.matchMode === 'CONTACTO';
        const idx = esContacto ? cfg.contactoValor?.fromIndex : cfg.matchColumn?.fromIndex;
        if (idx === undefined || idx === null) {
            throw new BadRequestException('La plantilla de acciones no tiene columna de match configurada');
        }
        const sep = resolveDelimiter(remesa.plantilla.separador ?? '|');
        const hasHeader = !!remesa.plantilla.tieneHeader;
        const valores = new Set<string>();
        let totalFilas = 0;

        const { paths, nombres } = this.archivosDeRemesa(remesa);

        await recorrerFilas(
            {
                paths,
                nombres,
                tieneHeader: hasHeader,
                separador: sep,
                anchoFijo: this.layoutAnchoFijo(mapping),
                hoja,
            },
            ({ valores: fila }) => {
                // Mismo criterio que el import: lo que el filtro descarta no impacta a nadie, así
                // que tampoco tiene que aparecer en el conteo que el operador confirma. Incluye el
                // corte propio de la remesa, si la carga se dividió.
                if (!pasaFiltro(fila, this.filtrosDeRemesa(remesa, mapping))) return;
                totalFilas++;
                const v = String(fila?.[idx] ?? '').trim();
                if (v) valores.add(v);
            },
        );

        const scopeDeudor: any = { empresaId: remesa.empresaId, ...(remesaOrigenId ? { remesaId: remesaOrigenId } : {}) };

        // ── Modo CONTACTO: contar contactos a eliminar ──
        if (esContacto) {
            const cv = cfg.contactoValor!;
            const candidatos = new Set<string>();
            for (const v of valores) {
                candidatos.add(v);
                if (cv.tipo === 'telefono') { const n = normalizarTelefonoArgentino(v); if (n.valido && n.e164) candidatos.add(n.e164); }
                if (cv.tipo === 'email') candidatos.add(v.toLowerCase());
            }
            const lista = [...candidatos];
            let contactosAEliminar = 0;
            for (let i = 0; i < lista.length; i += 1000) {
                contactosAEliminar += await this.prisma.contacto.count({
                    where: { tipo: cv.tipo, valor: { in: lista.slice(i, i + 1000) }, deudor: scopeDeudor },
                });
            }
            return {
                matchMode: 'CONTACTO', totalFilas, valoresDistintos: valores.size,
                deudoresAfectados: 0, contactosAEliminar,
                operaciones: cfg.operaciones.map(o => o.tipo),
            };
        }

        // ── Modo DEUDOR: contar deudores afectados en chunks (IN acotado) ──
        const field = cfg.matchColumn!.field;
        const campo = field === 'documento' ? 'documento' : field === 'id' ? 'id' : 'nroCliente';
        const lista: any[] = field === 'id'
            ? [...valores].map(Number).filter(Number.isInteger)
            : [...valores];
        const ids = new Set<number>();
        for (let i = 0; i < lista.length; i += 1000) {
            const rows = await this.prisma.deudor.findMany({
                where: { ...scopeDeudor, [campo]: { in: lista.slice(i, i + 1000) } },
                select: { id: true },
            });
            for (const r of rows) ids.add(r.id);
        }

        return {
            matchMode: 'DEUDOR',
            totalFilas,
            valoresDistintos: valores.size,
            deudoresAfectados: ids.size,
            operaciones: cfg.operaciones.map(o => o.tipo),
        };
    }

    // --- REVERTIR ACCIONES MASIVAS (undo por snapshot) ---
    async revertirAcciones(remesaId: number, usuarioId?: number) {
        const remesa = await this.prisma.remesa.findUnique({ where: { id: remesaId } });
        if (!remesa) throw new NotFoundException('Remesa no existe');
        if (remesa.categoria !== 'ACCIONES') throw new BadRequestException('La remesa no es de acciones masivas');
        if (remesa.accionRevertidaEn) {
            return { yaRevertida: true, deudoresRevertidos: 0, contactosRestaurados: 0, comentariosBorrados: 0 };
        }

        const snaps = await this.prisma.accion_masiva_snapshot.findMany({
            where: { remesaId }, orderBy: { id: 'desc' },
        });

        let deudoresRevertidos = 0;
        const contactosACrear: any[] = [];
        const comentariosABorrar: number[] = [];

        for (const s of snaps) {
            const dp = (s.datosPrevios ?? {}) as Record<string, any>;
            if (s.entidad === 'deudor' && s.accion === 'UPDATE') {
                const data: any = {};
                for (const [k, v] of Object.entries(dp)) {
                    if (k === 'fechaVencimiento') data[k] = v ? new Date(v) : null;
                    else if (k === 'camposAdicionales') data[k] = v == null ? Prisma.JsonNull : v;
                    else data[k] = v;
                }
                await this.prisma.deudor.update({ where: { id: s.entidadId }, data }).catch(() => { });
                deudoresRevertidos++;
            } else if (s.entidad === 'contacto' && s.accion === 'DELETE') {
                contactosACrear.push({
                    deudorId: dp.deudorId, tipo: dp.tipo, valor: dp.valor,
                    subtipo: dp.subtipo ?? null, prioridad: dp.prioridad ?? 0,
                    validado: dp.validado ?? false, whatsapp: dp.whatsapp ?? null,
                });
            } else if (s.entidad === 'comentario' && s.accion === 'INSERT') {
                comentariosABorrar.push(s.entidadId);
            }
        }

        let contactosRestaurados = 0;
        for (let i = 0; i < contactosACrear.length; i += 500) {
            const r = await this.prisma.contacto.createMany({ data: contactosACrear.slice(i, i + 500), skipDuplicates: true });
            contactosRestaurados += r.count;
        }
        let comentariosBorrados = 0;
        if (comentariosABorrar.length) {
            const r = await this.prisma.comentario.deleteMany({ where: { id: { in: comentariosABorrar } } });
            comentariosBorrados = r.count;
        }

        await this.prisma.remesa.update({
            where: { id: remesaId },
            data: { accionRevertidaEn: new Date(), accionRevertidaPorId: usuarioId ?? null },
        });

        await this.auditoria.log({
            modulo: 'IMPORT', entidad: 'acciones_masivas', tipo: 'DELETE',
            usuarioId: usuarioId ?? null, empresaId: remesa.empresaId, entidadId: remesaId,
            resumen: `Revirtió acción masiva (remesa ${remesaId})`,
            data: { deudoresRevertidos, contactosRestaurados, comentariosBorrados },
        });

        return { yaRevertida: false, deudoresRevertidos, contactosRestaurados, comentariosBorrados };
    }

    // --- EJECUTAR (Encuela el trabajo en BullMQ) ---
    async executeRemesa(remesaId: number, usuarioId?: number, remesaOrigenId?: number, remesaOrigenIds?: number[]) {

        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
        });

        if (!remesa) {
            throw new NotFoundException('Remesa no existe');
        }

        if (!remesa.categoria) {
            throw new BadRequestException('La remesa no tiene categoría definida');
        }

        // Validación "una importación activa por usuario" con SELECT FOR UPDATE
        if (usuarioId) {
            await this.prisma.$transaction(async (tx) => {
                const enCurso = await tx.$queryRaw<{ id: number }[]>`
                    SELECT id FROM remesa
                    WHERE usuarioCreadorId = ${usuarioId}
                    AND estadoProceso IN ('PENDIENTE', 'VALIDANDO', 'PROCESANDO')
                    FOR UPDATE
                `;
                if (enCurso.length > 0) {
                    throw new ConflictException(
                        'Ya tenés una importación en curso. Esperá a que termine antes de iniciar otra.',
                    );
                }

                // Marcar como PENDIENTE dentro de la transacción para evitar race condition
                await tx.remesa.update({
                    where: { id: remesaId },
                    data: {
                        estadoProceso: 'PENDIENTE',
                        usuarioCreadorId: usuarioId,
                    },
                });
            });
        } else {
            await this.prisma.remesa.update({
                where: { id: remesaId },
                data: { estadoProceso: 'PENDIENTE' },
            });
        }

        const ctx = this.requestContext.get();
        await this.importQueue.add('process-import', {
            remesaId,
            remesaOrigenId,
            remesaOrigenIds,
            usuarioId,
            _ctx: ctx ? { requestId: ctx.requestId, usuarioId: ctx.usuarioId } : undefined,
        });

        return { message: 'Importación encolada correctamente', remesaId };
    }

    // --- EN CURSO ---
    async listarEnCurso(user: { sub: number; permisos: string[] }) {
        const estadosActivos = ['PENDIENTE', 'VALIDANDO', 'PROCESANDO'] as const;

        const where = user.permisos.includes('importacion.ver_progreso_otros')
            ? { estadoProceso: { in: estadosActivos as any } }
            : {
                  estadoProceso: { in: estadosActivos as any },
                  usuarioCreadorId: user.sub,
              };

        const remesas = await this.prisma.remesa.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                empresa: { select: { nombre: true } },
                usuarioCreador: { select: { id: true, nombre: true, email: true } },
                jobimport: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { progreso: true, estado: true, createdAt: true },
                },
            },
        });

        // Aplanamos al shape que consume el frontend (ImportEnCursoDto).
        return remesas.map((r) => ({
            remesaId: r.id,
            tipo: r.categoria,
            totalFilas: r.totalFilas,
            progreso: r.jobimport?.[0]?.progreso ?? 0,
            okFilas: r.okFilas,
            errFilas: r.errFilas,
            estadoProceso: r.estadoProceso,
            usuarioId: r.usuarioCreador?.id ?? null,
            usuarioNombre: r.usuarioCreador?.nombre ?? 'Sistema',
            startedAt: r.createdAt,
        }));
    }

    // --- WORKER DE IMPORTACIÓN LÓGICA PESADA ---
    async processImportJob(job: Job, remesaId: number, remesaOrigenId?: number, remesaOrigenIds?: number[]) {
        const usuarioId: number | undefined = job.data?.usuarioId;
        const startedAt = new Date();

        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: {
                plantilla: true,
                usuarioCreador: { select: { id: true, nombre: true } },
            },
        });

        if (!remesa || !remesa.archivo || !remesa.plantilla) {
            throw new Error('Remesa/archivo/plantilla no existe');
        }

        if (!remesa.categoria) {
            throw new Error('La remesa no tiene categoría definida');
        }

        const usuarioNombre = remesa.usuarioCreador?.nombre ?? 'Sistema';
        const ownerId = remesa.usuarioCreadorId ?? usuarioId;

        let ok = 0;
        let err = 0;
        let total = 0;

        try {
        // Obtener procesador para la categoría
        const processor = getProcessor(remesa.categoria);

        // Usar los defaults configurados en la plantilla.
        // ACCIONES no crea deudores → no necesita estado inicial de situación/gestión.
        // MULTICLAVES tampoco: la clave no se ata a un deudor al cargarla (docs/multiclaves-spec.md §5.1).
        const { defaultEstadoSituacionId, defaultEstadoGestionId } = remesa.plantilla;
        const esAcciones = remesa.categoria === 'ACCIONES';
        const esMulticlaves = remesa.categoria === 'MULTICLAVES';
        if (!esAcciones && !esMulticlaves && (!defaultEstadoSituacionId || !defaultEstadoGestionId)) {
            throw new BadRequestException(
                'La plantilla no tiene configurado el estado inicial de situación/gestión. ' +
                'Edita la plantilla y completá los campos.',
            );
        }

        const mapping = remesa.plantilla.mappingJson as unknown as MappingJson;

        // Modo de cálculo de montoTotal desde facturas (default seguro: SI_VACIO)
        const modoMonto = mapping?.montoDeudorDesdeFacturas;
        const montoDeudorDesdeFacturas =
            modoMonto === 'NO' || modoMonto === 'SIEMPRE' ? modoMonto : 'SI_VACIO';

        // Modo del import de ACTUALIZACIONES (default seguro: RECONCILIAR = comportamiento clásico)
        const modoActualizacion =
            mapping?.modoActualizacion === 'SOLO_DATOS' ? 'SOLO_DATOS' : 'RECONCILIAR';

        // Comportamiento ante deuda mayor (default seguro: FACTURA_NUEVA = comportamiento clásico)
        const comportamientoDeudaMayor =
            mapping?.comportamientoDeudaMayor === 'ACTUALIZAR_SALDO' ? 'ACTUALIZAR_SALDO' : 'FACTURA_NUEVA';

        // ACTUALIZACIONES: crear casos nuevos si no matchean la remesa origen
        // (default seguro: true = comportamiento clásico). Solo se desactiva con el flag explícito.
        const crearNuevosCasos = mapping?.crearNuevosCasos !== false;

        // ACTUALIZACIONES: acción para deudores ausentes del archivo (default seguro: PAGO_TODO
        // = comportamiento clásico, retrocompatible). DESASIGNAR = archivo diario de gestión.
        const accionAusente =
            mapping?.accionAusente === 'DESASIGNAR' ? 'DESASIGNAR' :
            mapping?.accionAusente === 'IGNORAR' ? 'IGNORAR' :
            'PAGO_TODO';

        const ctx: ProcessContext = {
            prisma: this.prisma,
            remesaId: remesa.id,
            empresaId: remesa.empresaId,
            usuarioId: ownerId ?? undefined,
            plantillaId: remesa.plantillaId ?? undefined,
            remesaOrigenId,
            remesaOrigenIds: remesaOrigenIds?.length ? remesaOrigenIds : undefined,
            validarDomicilios: remesa.validarDomicilios ?? false,
            defaults: {
                estadoSituacionId: defaultEstadoSituacionId ?? 0,
                estadoGestionId: defaultEstadoGestionId ?? 0,
            },
            consolidacion: this.consolidacion,
            promesas: this.promesas,
            auditoria: this.auditoria,
            // Qué identifica a un caso dentro de la remesa (default seguro: DOCUMENTO, que es el
            // comportamiento histórico). Ver `utils/identidad-deudor.ts`.
            identidadDeudor: resolverIdentidad(mapping?.identidadDeudor),
            montoDeudorDesdeFacturas,
            modoActualizacion,
            comportamientoDeudaMayor,
            crearNuevosCasos,
            accionAusente,
            accionesConfig: mapping?.acciones,
            multirregistroConfig: mapping?.multirregistro,
            multiarchivoConfig: mapping?.multiarchivo,
            multiclavesConfig: mapping?.multiclaves,
        };

        const sep = resolveDelimiter(remesa.plantilla.separador ?? '|');
        const hasHeader = !!remesa.plantilla.tieneHeader;

        const BATCH_SIZE = IMPORTS_BATCH_SIZE;
        // `origen` (`archivo.txt:1234`) solo viene cuando la remesa tiene más de un archivo; se
        // antepone al mensaje de error para poder ubicar la fila entre los 31 TXT de una bajada.
        const batch: Array<{ row: any; idx: number; origen?: string | null }> = [];

        // MULTIRREGISTRO, MULTIARCHIVO y MULTICLAVES no son "una fila = un registro": hay que
        // agrupar o cruzar los archivos antes de procesar. El parser devuelve filas (o, en
        // MULTICLAVES, trámites) ya normalizados, así que estos NO pasan por `mapRow` (que asume un
        // array de columnas).
        const esMultirregistro = remesa.categoria === 'MULTIRREGISTRO';
        const esMultiarchivo = remesa.categoria === 'MULTIARCHIVO';
        const esPreparsado = esMultirregistro || esMultiarchivo || esMulticlaves;

        this.logger.log(
            `Procesando remesa=${remesaId} categoria=${remesa.categoria} ` +
            `lote=${BATCH_SIZE} porLote=${processor.processBatch ? 'si' : 'no'}`,
        );

        await this.prisma.remesa.update({
            where: { id: remesaId },
            data: { estadoProceso: 'PROCESANDO' }
        });

        // Emitir evento de inicio
        if (ownerId) {
            try {
                this.realtimeService.emitImportIniciada({
                    remesaId,
                    tipo: remesa.categoria as string,
                    totalFilas: remesa.totalFilas,
                    usuarioId: ownerId,
                    usuarioNombre,
                    startedAt,
                });
            } catch (emitErr: any) {
                this.logger.warn(`Error emitiendo import:iniciada: ${emitErr?.message}`);
            }
        }

        // ProgressEmitter para throttle de progreso
        const progressEmitter = new ProgressEmitter(
            (progreso, okFilas, errFilas) => {
                if (!ownerId) return;
                try {
                    this.realtimeService.emitImportProgreso({
                        remesaId,
                        progreso,
                        okFilas,
                        errFilas,
                        totalFilas: remesa.totalFilas ?? total,
                        estadoProceso: 'PROCESANDO',
                        usuarioId: ownerId,
                        usuarioNombre,
                    });
                } catch (emitErr: any) {
                    this.logger.warn(`Error emitiendo import:progreso: ${emitErr?.message}`);
                }
            },
            2000,
            5,
        );

        // Limpiar errores previos de esta remesa
        await this.prisma.importerror.deleteMany({
            where: { remesaId }
        });

        const processBatch = async () => {
            const group = batch.splice(0, batch.length);
            const errorBatch: Array<{ remesaId: number; rowNumber: number; rawRow: any; errorMsg: string }> = [];

            // Filas que pasaron mapeo + validación, para el camino por lote.
            const validas: Array<{ row: any; idx: number; mapped: any; origen?: string | null }> = [];

            for (const { row, idx, origen } of group) {
                try {
                    const obj = esPreparsado ? (row as MappedRow) : this.mapRow(row, mapping);
                    this.validateMappedRow(obj, mapping);

                    if (processor.validateRow) {
                        const result = processor.validateRow(obj, ctx);
                        if (!result.valid) {
                            throw new Error(result.error ?? 'Validación de fila fallida');
                        }
                    }

                    if (processor.processBatch) {
                        // El processor resuelve el lote entero de una vez (lecturas y escrituras
                        // agrupadas). El conteo ok/err se hace después, con lo que devuelva.
                        validas.push({ row, idx, mapped: obj, origen });
                        continue;
                    }

                    await processor.processRow(obj, ctx);
                    ok++;
                } catch (e: any) {
                    err++;
                    errorBatch.push({
                        remesaId,
                        rowNumber: idx,
                        rawRow: Array.isArray(row) ? row : Object.values(row),
                        errorMsg: conOrigen(e.message ?? 'Error desconocido', origen ?? null),
                    });
                }
            }

            if (processor.processBatch && validas.length > 0) {
                const porIdx = new Map(validas.map((v) => [v.idx, v]));
                let fallos: Array<{ idx: number; error: string }> = [];
                try {
                    fallos = await processor.processBatch(
                        validas.map((v) => ({ row: v.mapped, idx: v.idx })),
                        ctx,
                    );
                } catch (e: any) {
                    // Un throw del hook hace fallar el lote entero: se reportan todas sus filas.
                    const msg = e?.message ?? 'Error desconocido en el lote';
                    this.logger.error(`processBatch falló en remesa ${remesaId}: ${msg}`, e?.stack);
                    fallos = validas.map((v) => ({ idx: v.idx, error: msg }));
                }

                for (const f of fallos) {
                    const v = porIdx.get(f.idx);
                    errorBatch.push({
                        remesaId,
                        rowNumber: f.idx,
                        rawRow: v ? (Array.isArray(v.row) ? v.row : Object.values(v.row)) : [],
                        errorMsg: conOrigen(f.error, v?.origen ?? null),
                    });
                }
                err += fallos.length;
                ok += validas.length - fallos.length;
            }

            if (errorBatch.length > 0) {
                await this.prisma.importerror.createMany({ data: errorBatch });
            }

            await this.prisma.remesa.update({
                where: { id: remesaId },
                data: { totalFilas: total, okFilas: ok, errFilas: err }
            });

            await job.updateProgress({ total, ok, err });

            const totalEsperado = remesa.totalFilas ?? 0;
            const progreso = totalEsperado > 0
                ? Math.min(100, Math.floor((ok + err) / totalEsperado * 100))
                : 0;
            progressEmitter.tick(progreso, ok, err);
        };

        if (esMultirregistro) {
            // ── Archivo con varios tipos de línea (Toyota cuenta 87) ────────────────────
            const cfgMulti = mapping?.multirregistro;
            if (!cfgMulti) {
                throw new Error(
                    'La plantilla es de categoría MULTIRREGISTRO pero no tiene `mappingJson.multirregistro` configurado.',
                );
            }

            const t0 = Date.now();
            const { filas, advertencias, resumen } = parseMultirregistro(
                fs.readFileSync(remesa.archivo),
                cfgMulti,
                sep,
            );
            this.logger.log(
                `Multirregistro remesa=${remesaId}: ${resumen.lineas} líneas ` +
                `(${JSON.stringify(resumen.porTipo)}) → ${resumen.casos} casos, ` +
                `${resumen.facturas} facturas, ${resumen.bajas} bajas, ${resumen.ignoradas} ignoradas ` +
                `en ${Date.now() - t0}ms`,
            );

            // Las advertencias del parseo (clientes sin ficha, avisos repetidos) se registran como
            // errores de la remesa para que queden visibles en el detalle del import.
            if (advertencias.length > 0) {
                this.logger.warn(`Multirregistro remesa=${remesaId}: ${advertencias.length} advertencia(s) de parseo.`);
                await this.prisma.importerror.createMany({
                    data: advertencias.slice(0, 500).map((a) => ({
                        remesaId,
                        rowNumber: 0,
                        rawRow: [] as any,
                        errorMsg: `[parseo] ${a}`,
                    })),
                });
            }

            for (const fila of filas) {
                batch.push({ row: fila, idx: total++ });
                if (batch.length >= BATCH_SIZE) await processBatch();
            }
            if (batch.length > 0) await processBatch();

        } else if (esMultiarchivo) {
            // ── Paquete de varios archivos que se cruzan entre sí (Toyota TCFA) ─────────
            const cfgMulti = mapping?.multiarchivo;
            if (!cfgMulti) {
                throw new Error(
                    'La plantilla es de categoría MULTIARCHIVO pero no tiene `mappingJson.multiarchivo` configurado.',
                );
            }

            const t0 = Date.now();
            const { filas, advertencias, resumen } = parseMultiarchivo(
                this.leerPaqueteMultiarchivo(remesa),
                cfgMulti,
                sep,
            );
            this.logger.log(
                `Multiarchivo remesa=${remesaId}: ${JSON.stringify(resumen.lineas)} → ${resumen.casos} casos, ` +
                `${resumen.facturas} cuotas, ${resumen.bajas} bajas, ${resumen.codeudores} codeudores ` +
                `(${resumen.cuotasDescartadas} cuotas de asignaciones no vigentes descartadas, ` +
                `${resumen.casosSinDetalle} casos sin detalle) en ${Date.now() - t0}ms`,
            );

            // Las advertencias del cruce (cuotas huérfanas, casos sin detalle, codeudores sin
            // titular) se registran como errores de la remesa para que queden visibles en el
            // detalle del import: son el dato que el operador necesita para reclamarle al cedente.
            if (advertencias.length > 0) {
                this.logger.warn(`Multiarchivo remesa=${remesaId}: ${advertencias.length} advertencia(s) de parseo.`);
                await this.prisma.importerror.createMany({
                    data: advertencias.slice(0, 500).map((a) => ({
                        remesaId,
                        rowNumber: 0,
                        rawRow: [] as any,
                        errorMsg: `[parseo] ${a}`,
                    })),
                });
            }

            for (const fila of filas) {
                batch.push({ row: fila, idx: total++ });
                if (batch.length >= BATCH_SIZE) await processBatch();
            }
            if (batch.length > 0) await processBatch();

        } else if (esMulticlaves) {
            // ── Claves de pago de Telecom/Personal (layout fijo en código, D2) ──────────
            const cfgMulti = mapping?.multiclaves;
            if (!cfgMulti) {
                throw new Error(
                    'La plantilla es de categoría MULTICLAVES pero no tiene `mappingJson.multiclaves` configurado.',
                );
            }

            const { paths, nombres } = this.archivosDeRemesa(remesa);
            const archivosLeidos = paths.map((p, i) => ({ buffer: fs.readFileSync(p), nombre: nombres[i] || path.basename(p) }));

            const t0 = Date.now();
            let parseado: ReturnType<typeof parseMulticlaves>;
            try {
                parseado = parseMulticlaves(archivosLeidos, cfgMulti, new Date());
            } catch (e: any) {
                throw e instanceof MulticlavesArchivoInvalidoError ? e : new Error(e.message ?? 'Error al leer el archivo de claves');
            }
            const { tramites: tramitesMulticlaves, avisos, resumen } = parseado;
            this.logger.log(
                `Multiclaves remesa=${remesaId}: ${resumen.lineas} líneas → ${resumen.tramites} trámites ` +
                `(${resumen.tramites - resumen.rechazados} válidos, ${resumen.rechazados} rechazados, ` +
                `avisos=${JSON.stringify(resumen.porAviso)}) en ${Date.now() - t0}ms`,
            );

            // Los avisos del parseo (no bloquean la carga) quedan visibles en el detalle de la
            // importación, con prefijo [aviso] y rowNumber 0 para no contarlos como error.
            if (avisos.length > 0) {
                await this.prisma.importerror.createMany({
                    data: avisos.map((a) => ({
                        remesaId,
                        rowNumber: 0,
                        rawRow: a.ejemplos as any,
                        errorMsg: `[aviso] ${a.codigo}: ${a.cantidad} caso(s) (ej: ${a.ejemplos.slice(0, 5).join(', ')})`,
                    })),
                });
            }

            for (const t of tramitesMulticlaves) {
                batch.push({ row: t as unknown as MappedRow, idx: total++ });
                if (batch.length >= BATCH_SIZE) await processBatch();
            }
            if (batch.length > 0) await processBatch();

        } else {
            // Una fila = un registro. La remesa puede traer varios archivos del mismo formato, que
            // se recorren como si fueran uno solo (AYSA parte la cartera en 31 TXT por sucursal).
            const { paths, nombres } = this.archivosDeRemesa(remesa);
            if (paths.length > 1) {
                this.logger.log(`Remesa ${remesaId}: ${paths.length} archivos — ${nombres.join(', ')}`);
            }
            let descartadas = 0;
            const filtros = this.filtrosDeRemesa(remesa, mapping);

            await recorrerFilas(
                {
                    paths,
                    nombres,
                    tieneHeader: hasHeader,
                    separador: sep,
                    anchoFijo: this.layoutAnchoFijo(mapping),
                    hoja: remesa.hoja ?? undefined,
                },
                ({ valores, origen }) => {
                    // Las filas que el filtro descarta no son errores: no se procesan, no van a
                    // `importerror` y no cuentan en el total. Son las de la plantilla más el corte
                    // propio de la remesa cuando la carga se dividió por nómina/gestión.
                    if (!pasaFiltro(valores, filtros)) {
                        descartadas++;
                        return;
                    }
                    batch.push({ row: valores, idx: total++, origen });
                    // Devolver la promesa hace que el recorrido se pause hasta que el lote termine.
                    if (batch.length >= BATCH_SIZE) return processBatch();
                },
            );
            if (batch.length > 0) await processBatch();

            if (descartadas > 0) {
                this.logger.log(
                    `Remesa ${remesaId}: ${descartadas} fila(s) descartadas por el filtro ` +
                    `(${describirFiltros(filtros)}).`,
                );
            }
        }

        // Hook post-batch: lógica que corre después de todas las filas
        if (processor.afterAll) {
            try {
                await processor.afterAll(ctx);
            } catch (e: any) {
                this.logger.error(`afterAll error en remesa ${remesaId}: ${e.message}`);
            }
        }

        await this.prisma.remesa.update({
            where: { id: remesaId },
            data: {
                estadoProceso: 'FINALIZADA',
                totalFilas: total,
                okFilas: ok,
                errFilas: err
            }
        });

        await job.updateProgress({ total, ok, err });

        const durationMs = Date.now() - startedAt.getTime();

        // Emitir finalización via socket (forzado)
        if (ownerId) {
            progressEmitter.tick(100, ok, err, true);

            try {
                this.realtimeService.emitImportFinalizada({
                    remesaId,
                    okFilas: ok,
                    errFilas: err,
                    totalFilas: total,
                    durationMs,
                    estadoProceso: 'FINALIZADA',
                    usuarioId: ownerId,
                    usuarioNombre,
                });
            } catch (emitErr: any) {
                this.logger.warn(`Error emitiendo import:finalizada: ${emitErr?.message}`);
            }

            // Notificación persistente (sin lanzar si falla)
            try {
                await this.notificacionesService.crear({
                    tipo: err > 0 && ok === 0 ? 'IMPORTACION_ERROR' : 'IMPORTACION_FINALIZADA',
                    entidadTipo: 'REMESA',
                    entidadId: remesaId,
                    titulo: err > 0 && ok === 0
                        ? 'Importación fallida'
                        : `Importación finalizada`,
                    mensaje: err > 0 && ok === 0
                        ? `La importación de ${total} filas falló completamente (${err} errores).`
                        : `Se procesaron ${ok} filas correctamente${err > 0 ? ` con ${err} errores` : ''}.`,
                    payload: {
                        okFilas: ok,
                        errFilas: err,
                        totalFilas: total,
                        durationMs,
                        tipoImport: remesa.categoria,
                    },
                    rutaAccion: `/historial-importaciones/${remesaId}`,
                    destinatarioPrincipalId: ownerId,
                    incluirUsuariosConPermiso: 'importacion.ver_progreso_otros',
                });
            } catch (notifErr: any) {
                this.logger.warn(`Error creando notificacion de importacion: ${notifErr?.message}`);
            }
        }

        return { total, ok, err };

        } catch (error: any) {
            const durationMs = Date.now() - startedAt.getTime();

            try {
                await this.prisma.remesa.update({
                    where: { id: remesaId },
                    data: { estadoProceso: 'FALLIDA' },
                });
            } catch (updateErr: any) {
                this.logger.error(`Error marcando remesa ${remesaId} como FALLIDA: ${updateErr?.message}`);
            }

            if (ownerId) {
                try {
                    this.realtimeService.emitImportFinalizada({
                        remesaId,
                        okFilas: ok,
                        errFilas: err,
                        totalFilas: total,
                        durationMs,
                        estadoProceso: 'FALLIDA',
                        usuarioId: ownerId,
                        usuarioNombre,
                    });
                } catch (emitErr: any) {
                    this.logger.warn(`Error emitiendo import:finalizada (FALLIDA): ${emitErr?.message}`);
                }

                try {
                    await this.notificacionesService.crear({
                        tipo: 'IMPORTACION_ERROR',
                        entidadTipo: 'REMESA',
                        entidadId: remesaId,
                        titulo: 'Importación fallida',
                        mensaje: error.message ?? 'Error desconocido',
                        payload: { okFilas: ok, errFilas: err, totalFilas: total, durationMs },
                        rutaAccion: `/historial-importaciones/${remesaId}`,
                        destinatarioPrincipalId: ownerId,
                        incluirUsuariosConPermiso: 'importacion.ver_progreso_otros',
                    });
                } catch (notifErr: any) {
                    this.logger.warn(`Error creando notificacion de importacion fallida: ${notifErr?.message}`);
                }
            }

            throw error;
        }
    }

    // --- ESTADO ---
    async status(remesaId: number) {
        const r = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: {
                empresa: { select: { id: true, nombre: true } },
                plantilla: { select: { id: true, nombre: true, categoria: true } },
                usuarioCreador: { select: { id: true, nombre: true, email: true } },
                politica: { select: { id: true, nombre: true } },
                jobimport: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { id: true, estado: true, progreso: true, createdAt: true, finishedAt: true },
                },
            },
        });

        if (!r) throw new NotFoundException();

        const job = r.jobimport[0] ?? null;

        const terminada = r.estadoProceso === 'FINALIZADA' || r.estadoProceso === 'FALLIDA';
        let duracionMs: number | null = null;
        if (terminada && job) {
            const fin = job.finishedAt ?? r.updatedAt;
            duracionMs = fin.getTime() - job.createdAt.getTime();
        }

        const tasaExitoPct = r.totalFilas > 0
            ? Math.round((r.okFilas / r.totalFilas) * 100)
            : null;

        return {
            id: r.id,
            numeroRemesa: r.numeroRemesa,
            nombre: r.nombre,
            categoria: r.categoria,
            estadoProceso: r.estadoProceso,
            totalFilas: r.totalFilas,
            okFilas: r.okFilas,
            errFilas: r.errFilas,
            fechaVencimiento: r.fechaVencimiento,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            empresa: r.empresa,
            plantilla: r.plantilla,
            usuarioCreador: r.usuarioCreador,
            politica: r.politica,
            jobimport: job,
            duracionMs,
            tasaExitoPct,
        };
    }

    // --- ERRORES POR REMESA ---
    async getErrors(remesaId: number, page = 1, pageSize = 50) {
        const [errors, count] = await Promise.all([
            this.prisma.importerror.findMany({
                where: { remesaId },
                orderBy: { rowNumber: 'asc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.importerror.count({ where: { remesaId } }),
        ]);

        return {
            data: errors,
            total: count,
            page,
            pageSize,
            totalPages: Math.ceil(count / pageSize),
        };
    }

    // --- EMPRESAS ---
    async listEmpresas() {
        return this.prisma.empresa.findMany({
            orderBy: { nombre: 'asc' },
        });
    }

    // --- LISTAR REMESAS ---
    /**
     * Remesas de una empresa.
     *
     * `soloConDeudores` deja solo las que **tienen cartera cargada** — en la práctica, las de
     * DEUDORES y MULTIRREGISTRO. Lo usa el filtro del tablero: una remesa de PAGOS o ACTUALIZACIONES
     * no tiene deudores propios, así que filtrar por ella devuelve 0 casos y solo ensucia el combo
     * (además son las que arrastran los `numeroRemesa` con timestamp del wizard viejo).
     */
    /**
     * Remesas de una empresa, para el combo de "vincular a remesa de deudores".
     *
     * @param soloConDeudores Solo las que efectivamente cargaron casos. El combo pedía la lista
     *   pelada y mostraba también las remesas de facturas, de pagos y de acciones masivas, que no
     *   sirven como origen de nada: elegir ahí es imposible cuando la empresa tiene 100 remesas.
     * @param soloEnGestion Además, solo las que todavía tienen al menos un caso **vivo**: ni
     *   cancelado (categoría CANCELADO, que es donde cae SIT-050) ni desasignado (GES-094). Es lo
     *   que separa "las 10 que estoy gestionando" de "las 90 que ya cerré", que es la pregunta
     *   real cuando hay que aplicar un archivo de pagos.
     */
    async listRemesas(
        empresaId: number,
        categoria?: string,
        soloConDeudores = false,
        soloEnGestion = false,
    ) {
        // El filtro de "vivo" se arma con los ids de los parámetros de cierre y no con sus claves
        // porque `deudor` guarda ids. Si el catálogo no está seedeado, no se filtra nada: es
        // preferible mostrar de más a esconder la remesa que el operador necesita.
        let idsCerrados: number[] = [];
        if (soloEnGestion) {
            const cierres = await this.prisma.parametro.findMany({
                where: { clave: { in: ['SIT-050', 'GES-094', 'GES-090'] } },
                select: { id: true, clave: true },
            });
            idsCerrados = cierres.map((c) => c.id);
        }

        const cerradoSituacion = idsCerrados.length
            ? { estadoSituacionId: { notIn: idsCerrados } }
            : {};
        const cerradoGestion = idsCerrados.length
            ? { estadoGestionId: { notIn: idsCerrados } }
            : {};

        return this.prisma.remesa.findMany({
            where: {
                empresaId,
                ...(categoria ? { categoria: categoria as any } : {}),
                ...(soloEnGestion && idsCerrados.length
                    ? { deudor: { some: { ...cerradoSituacion, ...cerradoGestion } } }
                    : soloConDeudores || soloEnGestion
                        ? { deudor: { some: {} } }
                        : {}),
            },
            orderBy: { createdAt: 'desc' },
            include: { plantilla: { select: { nombre: true } } },
        });
    }

    // --- POLÍTICA ---
    /**
     * Asocia una política a una remesa.
     *
     * Antes escribía el id sin verificar nada: se podía dejar una remesa apuntando a una política
     * **de otra empresa**, a una inactiva o a una que no existe, y el gestor terminaba leyendo
     * condiciones que no son las de esa cartera.
     */
    async updatePolitica(remesaId: number, politicaId: number | null) {
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            select: { id: true, empresaId: true },
        });
        if (!remesa) throw new NotFoundException(`Remesa ${remesaId} no encontrada`);

        if (politicaId != null) {
            const politica = await this.prisma.politica.findUnique({
                where: { id: politicaId },
                select: { id: true, empresaId: true, activa: true, nombre: true },
            });
            if (!politica) throw new NotFoundException(`Política ${politicaId} no encontrada`);
            if (politica.empresaId !== remesa.empresaId) {
                throw new BadRequestException(
                    `La política "${politica.nombre}" es de otra empresa: no se puede asociar a esta remesa.`,
                );
            }
            if (!politica.activa) {
                throw new BadRequestException(
                    `La política "${politica.nombre}" está inactiva. Activala antes de asociarla.`,
                );
            }
        }

        return this.prisma.remesa.update({
            where: { id: remesaId },
            data: { politicaId: politicaId ?? null },
        });
    }

    // --- ELIMINAR REMESA ---
    async deleteRemesa(remesaId: number, user: { sub: number; permisos: string[] }) {
        const remesa = await this.prisma.remesa.findUnique({ where: { id: remesaId } });
        if (!remesa) throw new NotFoundException(`Remesa ${remesaId} no encontrada`);

        if (remesa.estadoProceso === 'PROCESANDO') {
            throw new BadRequestException('No se puede eliminar una importación en curso');
        }

        const puedeVerOtros = user.permisos.includes('importacion.ver_progreso_otros');
        if (!puedeVerOtros && remesa.usuarioCreadorId !== user.sub) {
            throw new ForbiddenException('No tenés permiso para eliminar esta importación');
        }

        // MULTICLAVES no crea deudores: tiene su propia rama, sin el chequeo de gestión de abajo
        // (que mira comentarios/convenios/pagos/llamadas/emails de LOS DEUDORES de la remesa).
        if (remesa.categoria === 'MULTICLAVES') {
            return this.deleteRemesaMulticlaves(remesaId, user);
        }

        // Casos ("deudores") de la remesa.
        const deudores = await this.prisma.deudor.findMany({
            where: { remesaId },
            select: { id: true },
        });
        const deudorIds = deudores.map((d) => d.id);

        // Si la remesa generó casos, solo permitimos borrarla si NINGUNO tiene gestión encima.
        // Borrar gestión (comentarios, convenios, pagos, llamadas, emails) sería irreversible.
        if (deudorIds.length > 0) {
            const [comentarios, convenios, pagos, llamadas, emails] = await Promise.all([
                this.prisma.comentario.count({ where: { deudorId: { in: deudorIds } } }),
                this.prisma.convenio.count({ where: { deudorId: { in: deudorIds } } }),
                this.prisma.pago.count({ where: { deudorId: { in: deudorIds } } }),
                this.prisma.llamada_neotel.count({ where: { deudorId: { in: deudorIds } } }),
                this.prisma.envio_email.count({ where: { deudorId: { in: deudorIds } } }),
            ]);
            const gestion = [
                comentarios && `${comentarios} comentario(s)`,
                convenios && `${convenios} convenio(s)`,
                pagos && `${pagos} pago(s)`,
                llamadas && `${llamadas} llamada(s)`,
                emails && `${emails} email(s) enviado(s)`,
            ].filter(Boolean);
            if (gestion.length > 0) {
                throw new BadRequestException(
                    `No se puede eliminar: la remesa ya tiene gestión (${gestion.join(', ')}). ` +
                    'Eliminarla borraría ese trabajo de forma irreversible.',
                );
            }
        }

        // Borrado transaccional: datos del deudor (RESTRICT) → deudores → artefactos de import → remesa.
        // envio_email es CASCADE y transaccion es SET NULL a nivel DB; comentarios/convenios/pagos/llamadas
        // son 0 por la validación anterior, así que el borrado de deudores no choca con foreign keys.
        await this.prisma.$transaction(async (tx) => {
            if (deudorIds.length > 0) {
                await tx.contacto.deleteMany({ where: { deudorId: { in: deudorIds } } });
                await tx.campoextra.deleteMany({ where: { deudorId: { in: deudorIds } } });
                await tx.factura.deleteMany({ where: { deudorId: { in: deudorIds } } });
                await tx.deudor.deleteMany({ where: { id: { in: deudorIds } } });
            }
            await tx.jobimport.deleteMany({ where: { remesaId } });
            await tx.importerror.deleteMany({ where: { remesaId } });
            await tx.remesa.delete({ where: { id: remesaId } });
        });

        this.logger.log(`Remesa ${remesaId} eliminada por usuario ${user.sub} (casos=${deudorIds.length})`);
        return { deleted: true, casosEliminados: deudorIds.length };
    }

    /**
     * Borrado de una remesa MULTICLAVES (spec §5.8). Una clave nunca se borra si tiene un convenio
     * asociado (R3, de cualquier estado — incluido ANULADO).
     *
     * Para las tandas relacionadas con esta remesa, **no se restaura mecánicamente** la que esta
     * remesa había reemplazado: se recalcula desde cero, entre TODAS las tandas que le quedan al
     * trámite, cuál es la que gana (mayor vencimiento; en empate, la cargada más tarde) y se
     * corrigen los punteros de todas las demás para que apunten a esa. Es necesario para no
     * confundir dos casos bien distintos que antes se trataban igual:
     *
     *  - Una tanda "reemisión" (esta remesa venció a otra, que quedó `reemplazadaPorRemesaId` =
     *    esta) — si se borra, la reemplazada puede volver a ganar.
     *  - Una tanda "anterior" que ENTRÓ ya `REEMPLAZADA` apuntando a la vigente de ese momento (R2:
     *    vencimiento anterior al vigente) — si se borra, no cambia nada para nadie más.
     *
     * **Todo en lote, nunca una query por trámite.** La primera versión hacía 1 `findMany` + hasta 2
     * `updateMany` POR trámite afectado, dentro de una única transacción interactiva: con miles de
     * trámites (una reemisión de archivo completo), esa transacción se corta contra el timeout de
     * Prisma antes de terminar — medido contra MySQL local, "Transaction not found" en el trámite
     * 7.136 de 7.478, a los 5 segundos. Acá se trae en pocas queries (tandas de 1.000 vía `IN`) todo
     * lo que hace falta, se calcula la ganadora de cada trámite en memoria, y se aplica con
     * `updateMany` agrupados — el total de queries crece con la cantidad de TANDAS de 1.000, no con
     * la cantidad de trámites.
     */
    private async deleteRemesaMulticlaves(remesaId: number, user: { sub: number; permisos: string[] }) {
        const t0 = Date.now();
        const CHUNK = 1000;
        this.logger.log(`Multiclaves remesa=${remesaId}: intent de borrado por usuario ${user.sub}`);

        const conConvenio = await this.prisma.convenio.count({ where: { clavePago: { remesaId } } });
        if (conConvenio > 0) {
            this.logger.warn(`Multiclaves remesa=${remesaId}: borrado rechazado, ${conConvenio} clave(s) con convenio (R3)`);
            throw new BadRequestException(
                `No se puede eliminar: ${conConvenio} clave(s) de esta carga ya tienen convenio o cupón emitido.`,
            );
        }

        let borradas = 0;
        let restauradas = 0;
        let repuntadas = 0;

        await this.prisma.$transaction(async (tx) => {
            // Trámites que dependían de esta remesa: alguna clave (de otra remesa) quedó apuntando
            // acá como su reemplazo. Si no hay ninguno, borrar esta remesa no cambia nada para el
            // resto — es el camino común (una carga sin historial de reemisión) y son 2 queries en
            // total, sin importar cuántas claves tenga la carga.
            const afectados = await tx.clave_pago.findMany({
                where: { reemplazadaPorRemesaId: remesaId },
                select: { empresaId: true, nroTramite: true },
                distinct: ['empresaId', 'nroTramite'],
            });

            const del = await tx.clave_pago.deleteMany({ where: { remesaId } });
            borradas = del.count;

            if (afectados.length > 0) {
                // Se pide todo lo que le queda a esos trámites en tandas de 1.000 por `IN`, agrupado
                // por empresa (en la práctica una sola: todos los trámites de una remesa son de la
                // misma empresa). Nada de esto depende de cuántos trámites haya: son ceil(N/1.000)
                // queries, no N.
                const porEmpresa = new Map<number, string[]>();
                for (const a of afectados) {
                    const lista = porEmpresa.get(a.empresaId) ?? [];
                    lista.push(a.nroTramite);
                    porEmpresa.set(a.empresaId, lista);
                }

                type FilaRestante = {
                    id: number; remesaId: number; estado: string; reemplazadaPorRemesaId: number | null;
                    fechaVencimiento: Date; createdAt: Date;
                };
                const restantesPorTramite = new Map<string, FilaRestante[]>();
                for (const [empresaId, tramitesDeEmpresa] of porEmpresa) {
                    for (let i = 0; i < tramitesDeEmpresa.length; i += CHUNK) {
                        const chunk = tramitesDeEmpresa.slice(i, i + CHUNK);
                        const filas = await tx.clave_pago.findMany({
                            where: { empresaId, nroTramite: { in: chunk } },
                            select: {
                                id: true, remesaId: true, nroTramite: true, estado: true,
                                reemplazadaPorRemesaId: true, fechaVencimiento: true, createdAt: true,
                            },
                        });
                        for (const f of filas) {
                            const key = `${empresaId}|${f.nroTramite}`;
                            const lista = restantesPorTramite.get(key) ?? [];
                            lista.push(f);
                            restantesPorTramite.set(key, lista);
                        }
                    }
                }

                // Ganadora por trámite, toda en memoria (mismo criterio que el processor al cargar:
                // mayor vencimiento y, en empate, la cargada más tarde).
                const idsAVigente: number[] = [];
                const idsPerdedorasPorGanadora = new Map<number, number[]>();

                for (const filas of restantesPorTramite.values()) {
                    if (filas.length === 0) continue;
                    const porRemesa = new Map<number, FilaRestante[]>();
                    for (const f of filas) {
                        const lista = porRemesa.get(f.remesaId) ?? [];
                        lista.push(f);
                        porRemesa.set(f.remesaId, lista);
                    }
                    let ganadoraId = -1;
                    let mejorVto = '';
                    let mejorCreatedAt = -1;
                    for (const [rid, fs] of porRemesa) {
                        const vtoMax = fs.reduce((m, f) => (f.fechaVencimiento > m ? f.fechaVencimiento : m), fs[0].fechaVencimiento).toISOString();
                        const createdMax = Math.max(...fs.map((f) => f.createdAt?.getTime() ?? 0));
                        if (vtoMax > mejorVto || (vtoMax === mejorVto && createdMax > mejorCreatedAt)) {
                            ganadoraId = rid;
                            mejorVto = vtoMax;
                            mejorCreatedAt = createdMax;
                        }
                    }

                    for (const f of porRemesa.get(ganadoraId) ?? []) {
                        if (f.estado !== 'VIGENTE' || f.reemplazadaPorRemesaId !== null) idsAVigente.push(f.id);
                    }
                    for (const f of filas) {
                        if (f.remesaId !== ganadoraId && (f.estado !== 'REEMPLAZADA' || f.reemplazadaPorRemesaId !== ganadoraId)) {
                            const lista = idsPerdedorasPorGanadora.get(ganadoraId) ?? [];
                            lista.push(f.id);
                            idsPerdedorasPorGanadora.set(ganadoraId, lista);
                        }
                    }
                }

                // Aplicar: el `data` de "pasar a VIGENTE" es igual para todos, así que se manda en
                // tandas de 1.000 ids sin importar a cuántos trámites/remesas pertenecen. Los
                // "perdedores" sí llevan un `reemplazadaPorRemesaId` propio, pero como una remesa
                // suele ganar para MUCHOS trámites a la vez, la cantidad de grupos distintos es
                // chica en la práctica (no crece con la cantidad de trámites).
                for (let i = 0; i < idsAVigente.length; i += CHUNK) {
                    const chunk = idsAVigente.slice(i, i + CHUNK);
                    await tx.clave_pago.updateMany({
                        where: { id: { in: chunk } },
                        data: { estado: 'VIGENTE', reemplazadaEn: null, reemplazadaPorRemesaId: null },
                    });
                    restauradas += chunk.length;
                }
                for (const [ganadoraId, ids] of idsPerdedorasPorGanadora) {
                    for (let i = 0; i < ids.length; i += CHUNK) {
                        const chunk = ids.slice(i, i + CHUNK);
                        await tx.clave_pago.updateMany({
                            where: { id: { in: chunk } },
                            data: { estado: 'REEMPLAZADA', reemplazadaEn: new Date(), reemplazadaPorRemesaId: ganadoraId },
                        });
                        repuntadas += chunk.length;
                    }
                }
            }

            await tx.jobimport.deleteMany({ where: { remesaId } });
            await tx.importerror.deleteMany({ where: { remesaId } });
            await tx.remesa.delete({ where: { id: remesaId } });
        }, { timeout: 30_000, maxWait: 10_000 });

        this.logger.log(
            `Multiclaves remesa=${remesaId} eliminada por usuario ${user.sub}: ${borradas} clave(s) borradas, ` +
            `${restauradas} restaurada(s) a VIGENTE, ${repuntadas} repuntada(s) a la tanda ganadora ` +
            `en ${Date.now() - t0}ms`,
        );
        return { deleted: true, clavesEliminadas: borradas, clavesRestauradas: restauradas };
    }
}