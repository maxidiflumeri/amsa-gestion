// src/import/import.service.ts
import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';
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
import { canonizarTiposContactoPlantilla } from './utils/contacto-import';
import { getProcessor, getSupportedCategories } from './processors/processor-registry';
import { importeDePago } from './processors/pagos.processor';
import { ProcessContext, MappedRow } from './processors/processor.interface';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { CargaCanceladaError, CargaCerradaPorFueraError, ProgresoTracker } from './progreso/progreso-tracker';
import {
    armarEstadoCarga, esRetomable, leerResumen, motivoLegible, MotivoInterrupcion, RESULTADO_CANCELADA, textoCancelacion, textoInterrupcion,
    textoNotificacion,
} from './progreso/estado-carga';
import type { EstadoCargaDto } from './progreso/estado-carga.types';
import { parseMultirregistro } from './utils/multirregistro-parser';
import { ArchivosMultiarchivo, parseMultiarchivo } from './utils/multiarchivo-parser';
import { resolverRolesArchivos } from './utils/roles-multiarchivo';
import { MulticlavesArchivoInvalidoError, motivoPrincipalRechazo, parseMulticlaves } from './utils/multiclaves-parser';
import { conOrigen, ErrorDeParseo, esExcel, recorrerFilas } from './utils/recorrer-filas';
import {
    anchoTotal, inferirColumnasAnchoFijo, parseLineaAnchoFijo, validarColumnasAnchoFijo,
} from './utils/ancho-fijo';
import { validarArchivosHomogeneos } from './utils/archivos-homogeneos';
import { describirFiltros, pasaFiltro } from './utils/filtro-filas';
import { numeroRemesaMulticlaves, siguienteNumeroRemesa } from './utils/numero-remesa';
import { AcumuladorCortes, claveDeCorte, columnasDeDivision, divide, numerosSugeridos } from './utils/division-remesa';
import { combinarHashes, hashDeArchivos } from './utils/hash-archivos';
import { ContadorColisiones, resolverIdentidad } from './utils/identidad-deudor';
import { RequestContextService } from 'src/common/logger/request-context';
import { ConsolidacionSituacionService } from '../consolidacion/consolidacion.service';
import { PromesasService } from '../promesas/promesas.service';
import { AuditoriaHelper } from '../transacciones/auditoria.helper';
import { AuditEstado, AuditModulo, AuditSeveridad, AuditTipo } from '../transacciones/audit.enums';
import { normalizarTelefonoArgentino } from '../../common/utils/phone-utils';
import { idsSituacionCancelada } from './utils/situaciones-cerradas';
import { refClaveDeFila } from './processors/pagos.processor';

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

/** Lo que dice BullMQ del job de una carga (`ImportService.estadoDelJobDeCarga`). */
export type EstadoJobDeCarga =
    | 'ACTIVO_CON_LOCK'
    | 'ACTIVO_SIN_LOCK'
    | 'EN_ESPERA'
    | 'TERMINADO'
    | 'NO_EXISTE'
    | 'DESCONOCIDO';

/**
 * Transacción del borrado de una remesa. El `timeout` de una transacción interactiva de Prisma NO corta la sentencia en
 * curso (medido: con 8 s, el borrado respondió a los 18 s, lo que tardó la sentencia, y recién ahí dio P2028), y una
 * transacción que vence con la sentencia en vuelo contamina la operación siguiente de ese cliente (P1017, P1001 y hasta
 * resultados vacíos sin error sobre filas que existen). Vencer hace más daño que bien: el tope va holgado y las
 * sentencias las acota `innodb_lock_wait_timeout` (50 s). Si el pedido pasa de los 60 s del balanceador el operador ve un
 * error de red, pero el borrado termina igual.
 */
const TX_BORRADO = { timeout: 120_000, maxWait: 5_000 };

/**
 * Transacciones de la Fase C (encolar un lote, cancelar, retomar): pocas sentencias, ninguna larga. Todas llevan `maxWait` y
 * `timeout` explícitos: el `timeout` de Prisma no corta la sentencia en curso (ver `TX_BORRADO`) y vencer contamina la
 * operación siguiente, así que el tope va holgado y no se decide nada con un solo resultado vacío.
 */
const TX_C1 = { maxWait: 10_000, timeout: 30_000 };

/** Usuario que pide cancelar o retomar (lo que trae el JWT). */
export interface UsuarioDeCarga {
    sub: number;
    permisos: string[];
}

/** Una remesa y su fila de progreso, leídas con `SELECT … FOR UPDATE` (`bloquearCargas`). */
interface FilaBloqueada {
    id: number;
    numeroRemesa: string;
    estadoProceso: string;
    totalFilas: number;
    categoria: string | null;
    empresaId: number;
    plantillaId: number | null;
    archivoHash: string | null;
    filtroFilas: unknown;
    usuarioCreadorId: number | null;
    progresoId: number | null;
    fase: string | null;
    encoladaAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    resumen: unknown;
    cancelSolicitadaAt: Date | null;
    jobId: string | null;
    resultado: string | null;
    rev: number | null;
    createdAt: Date | null;
}

export type SituacionCorte = 'CARGADA' | 'EN_CURSO' | 'A_MEDIAS' | 'SIN_CARGAR';

/** Un corte de un archivo dividido que ya tiene remesa (`yaCargado` de la vista de cortes). */
export interface CorteYaCargado {
    remesaId: number;
    numeroRemesa: string;
    situacion: SituacionCorte;
    casos: number;
    retomable: boolean;
}

const TEXTO_SITUACION_CORTE: Record<SituacionCorte, string> = {
    EN_CURSO: 'se está cargando',
    CARGADA: 'ya cargada',
    A_MEDIAS: 'quedó a medias',
    SIN_CARGAR: 'no llegó a cargarse',
};

/**
 * Después de una lectura que bloquea el event loop (un Excel, o el parseo de las categorías pre-parseadas) el runner cede un
 * momento antes de entregar la primera fila: el pedido de cancelar que llegó durante la lectura estaba esperando en la cola de
 * eventos y recién se atiende ahora. Sin esta espera corría en paralelo con las primeras filas (hallazgo 3 de la auditoría).
 * Un CSV no tiene esa fase y no espera.
 */
const PAUSA_TRAS_LECTURA_BLOQUEANTE_MS = 300;

const MSG_CANCELAR_NO_EN_CURSO = 'Esta importación no está en curso: no hay nada que cancelar. Si es una vista previa que no querés, eliminala.';
const MSG_CANCELAR_YA_TERMINO = 'Esta importación ya terminó: no hay nada que cancelar.';
const MSG_CANCELAR_POST_PROCESO = 'La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar. Esperá a que termine.';
const MSG_CANCELAR_ACCIONES =
    'Una acción masiva que ya empezó no se cancela: los datos para deshacerla se guardan recién al terminar. Esperá a que termine y usá Revertir, que la deshace completa.';
const MSG_RETOMAR_NO_TERMINO = 'Esta importación no terminó, o terminó bien: no hay nada que retomar.';
const MSG_RETOMAR_ANTERIOR = 'Esta importación es anterior a la función de retomar. Volvé a subir el archivo.';
const MSG_RETOMAR_PROCESO_FILAS =
    'Esta importación ya procesó filas: no se puede retomar. Mirá el motivo de la falla para saber qué hacer.';

/** Mensaje al operador cuando la remesa no se puede borrar desde la pantalla por su tamaño. */
const MSG_REMESA_GRANDE = 'No se pudo eliminar: la remesa es demasiado grande para borrarla desde la pantalla. Avisá a soporte.';
/** Mensaje cuando la causa es de tiempo o de conexión (P2028, P1017 o un lock wait timeout de MySQL, 1205). */
const MSG_BASE_LENTA = 'No se pudo eliminar: la base de datos no respondió a tiempo. Probá de nuevo en unos minutos; si se repite, avisá a soporte.';

/**
 * Casos máximos de una remesa que `deleteRemesa` borra desde la pantalla (`IMPORTS_BORRADO_MAX_CASOS`, default 60.000,
 * acotado a [1.000, 65.000]). La cota superior sale de un límite real de MySQL: con 65.536 casos o más,
 * `comentario.count` con `deudorId IN (…)` tira "too many placeholders" (1390) sin borrar nada. Medido: 60.020 casos con
 * 3 contactos cada uno se borran en 10 s.
 */
function borradoMaxCasos(): number {
    const raw = process.env.IMPORTS_BORRADO_MAX_CASOS;
    if (raw === undefined || raw.trim() === '') return 60_000;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 60_000;
    return Math.min(65_000, Math.max(1_000, Math.floor(n)));
}

/** Minutos sin latido para cerrar una carga, si quien llama no pasa el umbral (el reaper lo pasa siempre). */
const UMBRAL_LATIDO_DEFAULT_MS = 5 * 60_000;

@Injectable()
export class ImportService {
    private readonly logger = new Logger(ImportService.name);

    /**
     * Cargas que ESTE proceso está procesando ahora (docs/imports-progreso-realtime-spec.md §9.5.3).
     * Es la primera barrera del reaper: "esta carga la estoy procesando yo". Se llena al empezar el
     * job y se vacía en el `finally` del runner, pase lo que pase: una entrada que quedara acá haría
     * inmortal a esa carga para el reaper.
     */
    private readonly cargasVivas = new Map<number, ProgresoTracker>();

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
    private validarMappingPlantilla(mappingJson: any, categoria?: string): void {
        const mapping = mappingJson as MappingJson | null | undefined;
        if (!mapping) return;
        const tiposInvalidos = canonizarTiposContactoPlantilla(mapping, categoria);
        if (tiposInvalidos.length) {
            throw new BadRequestException(
                `Tipo de contacto no reconocido: ${tiposInvalidos.map((t) => `"${t}"`).join(', ')}. ` +
                'Elegilo del desplegable (Teléfono, Email, Dirección, Red social u Otro).',
            );
        }
        if (mapping.modoActualizacion === 'SOLO_DATOS' && mapping.accionAusente === 'PAGO_TODO') {
            throw new BadRequestException(
                'Modo "Solo datos" es incompatible con la acción de ausentes "Marcar como pagó todo". ' +
                'Elegí "Desasignar" o "No hacer nada".',
            );
        }
    }

    async createPlantilla(dto: CreatePlantillaDto) {
        this.validarMappingPlantilla(dto.mappingJson, dto.categoria);
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

        if (data.mappingJson !== undefined) {
            this.validarMappingPlantilla(data.mappingJson, data.categoria ?? existing.categoria);
        }

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
    private leerPaqueteMultiarchivo(remesa: { archivos: unknown }, soloExistencia = false): ArchivosMultiarchivo {
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
            if (soloExistencia) return Buffer.alloc(0);
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

    /** ¿La remesa es un corte de un archivo dividido? `filtroFilas` puede venir como JSON ya parseado o como texto. */
    private tieneCortePropio(filtroFilas: unknown): boolean {
        let valor = filtroFilas;
        if (typeof valor === 'string') {
            try {
                valor = JSON.parse(valor);
            } catch {
                return false;
            }
        }
        return Array.isArray(valor) && valor.length > 0;
    }

    /**
     * Lo mismo que `filtrosDeRemesa`, pero por separado: el de la plantilla y el del corte de la
     * remesa. El worker los evalúa en ese orden para contar por separado las filas que descarta cada
     * uno (§9.5.3). La vista previa y el preview de acciones siguen usando `filtrosDeRemesa`.
     */
    private filtrosSeparados(
        remesa: { filtroFilas?: any },
        mapping: MappingJson | null | undefined,
    ): { dePlantilla: FiltroFila[]; deCorte: FiltroFila[] } {
        return {
            dePlantilla: mapping?.filtroFilas ?? [],
            deCorte: Array.isArray(remesa?.filtroFilas) ? (remesa.filtroFilas as FiltroFila[]) : [],
        };
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

            // Cortes de este archivo que ya están cargados (§10.5.6): el hash sale de la MISMA función que usa el alta.
            // Mejor esfuerzo: si la consulta falla la vista sale como siempre y el alta rechaza igual el corte repetido.
            let yaCargados = new Map<string, CorteYaCargado>();
            try {
                yaCargados = await this.cortesYaCargados(empresaId, plantillaId, hashDeArchivos(lista.map((f) => f.buffer as Buffer)));
            } catch (e: any) {
                this.logger.warn(`División (plantilla ${plantillaId}): no se pudo mirar qué cortes ya están cargados: ${motivoLegible(e)}`);
            }

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
                    ...(yaCargados.has(claveDeCorte(c.filtros)) ? { yaCargado: yaCargados.get(claveDeCorte(c.filtros)) } : {}),
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
            archivoHash = combinarHashes([saved.hash]);
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
            archivoHash = combinarHashes(hashes);

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
            // La fila de progreso nace con la remesa, en la misma escritura atómica (§8.5.2).
            progreso: { create: { fase: 'BORRADOR' } },
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

            // Primero se validan y arman todos los cortes, después se mira cuáles ya están cargados y recién ahí se crea.
            const plan = dto.divisiones.map((division) => {
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
                return { division, filtros, detalle };
            });

            // Cortes ya cargados (§10.5.6): protege también a una pestaña que no conoce `yaCargado`. Sin salida no hay
            // regla que dure, así que `repetir: true` (que el asistente manda solo tras una confirmación) la saltea.
            const yaCargados = await this.cortesYaCargados(dto.empresaId, dto.plantillaId, archivoHash);
            const repetidos409: string[] = [];
            for (const { division, filtros, detalle } of plan) {
                const ya = yaCargados.get(claveDeCorte(filtros));
                if (ya && ya.situacion !== 'SIN_CARGAR' && division.repetir !== true) {
                    repetidos409.push(`${detalle} en la remesa ${ya.numeroRemesa} (${TEXTO_SITUACION_CORTE[ya.situacion]})`);
                }
            }
            if (repetidos409.length > 0) {
                this.logger.warn(`Alta rechazada: cortes ya cargados — ${repetidos409.join('; ')}`);
                throw new ConflictException(
                    `Este archivo ya tiene cortes cargados: ${repetidos409.join('; ')}. ` +
                    'Destildalos, o confirmá que querés cargarlos de nuevo: sus casos van a quedar duplicados.',
                );
            }
            const conRepeticion = plan.filter((x) => x.division.repetir === true && yaCargados.has(claveDeCorte(x.filtros)));
            if (conRepeticion.length > 0) {
                this.logger.warn(`Se cargan de nuevo cortes que ya estaban cargados (repetir=true): ${conRepeticion.map((x) => x.detalle).join('; ')}`);
            }

            const creadas: number[] = [];
            for (const [i, { filtros, detalle, division }] of plan.entries()) {
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
     * Los cortes de este archivo que ya tienen una remesa (§10.5.6), por clave de corte. Se buscan las remesas de la empresa
     * con el mismo `archivoHash` y la misma plantilla que tengan corte propio; un borrador sin confirmar no cuenta. Si hay
     * más de una para el mismo corte, queda la de mayor gravedad: EN_CURSO, CARGADA, A_MEDIAS, SIN_CARGAR.
     */
    private async cortesYaCargados(empresaId: number, plantillaId: number, archivoHash: string): Promise<Map<string, CorteYaCargado>> {
        const remesas = await this.prisma.remesa.findMany({
            where: { empresaId, plantillaId, archivoHash },
            select: {
                id: true, numeroRemesa: true, estadoProceso: true, filtroFilas: true,
                progreso: { select: { fase: true, encoladaAt: true, startedAt: true, finishedAt: true, resumen: true } },
                _count: { select: { deudor: true } },
            },
        });
        const gravedad: SituacionCorte[] = ['EN_CURSO', 'CARGADA', 'A_MEDIAS', 'SIN_CARGAR'];
        const porCorte = new Map<string, CorteYaCargado>();
        for (const r of remesas ?? []) {
            if (!this.tieneCortePropio(r.filtroFilas)) continue;
            const casos = r._count?.deudor ?? 0;
            const situacion = this.situacionDeCorte(r.estadoProceso, r.progreso, casos);
            if (!situacion) continue;
            const clave = claveDeCorte(r.filtroFilas);
            const previo = porCorte.get(clave);
            if (previo && gravedad.indexOf(previo.situacion) <= gravedad.indexOf(situacion)) continue;
            porCorte.set(clave, {
                remesaId: r.id,
                numeroRemesa: r.numeroRemesa,
                situacion,
                casos,
                retomable: esRetomable(r.estadoProceso, r.progreso),
            });
        }
        return porCorte;
    }

    /** Qué pasó con un corte ya creado. `null` = un borrador sin confirmar: no cuenta. */
    private situacionDeCorte(
        estadoProceso: string,
        progreso: { encoladaAt?: Date | null; startedAt?: Date | null; finishedAt?: Date | null; resumen?: unknown } | null,
        casos: number,
    ): SituacionCorte | null {
        if (estadoProceso === 'FINALIZADA') return 'CARGADA';
        if (estadoProceso === 'FALLIDA') {
            // Una FALLIDA que arrancó sin el marcador de "no entregó filas" (o que tiene casos) cae en A_MEDIAS: ante la duda, no se vuelve a cargar.
            const sinFilas = leerResumen(progreso?.resumen)?.sinFilasEntregadas === true;
            const proceso = progreso?.startedAt != null && !sinFilas;
            return casos > 0 || proceso ? 'A_MEDIAS' : 'SIN_CARGAR';
        }
        if (estadoProceso === 'PROCESANDO') return 'EN_CURSO';
        if (progreso?.encoladaAt != null && progreso.finishedAt == null) return 'EN_CURSO';
        return null;
    }

    /**
     * Otras remesas del mismo archivo, plantilla y corte que ya figuran cargadas, en curso o a medias y que se confirmaron DESPUÉS
     * de que esta se creó (§10.5.6, hallazgos 2 y 7 de la auditoría). Se mira al confirmar y al retomar, con la fila ya bloqueada: la
     * guarda del alta no alcanza si dos altas del mismo archivo se arman antes de confirmar ninguna. La comparación de fechas es lo
     * que respeta el `repetir` que el operador confirmó a propósito: lo que ya estaba cargado cuando se creó la remesa ya lo vio la
     * guarda del alta. Devuelve los números de esas remesas.
     */
    private async remesasQueChocanConElCorte(
        tx: Prisma.TransactionClient,
        f: { id: number; empresaId: number; plantillaId: number | null; archivoHash: string | null; filtroFilas: unknown; createdAt?: Date | null },
    ): Promise<string[]> {
        if (!this.tieneCortePropio(f.filtroFilas) || !f.archivoHash || f.plantillaId == null || !f.createdAt) return [];
        const otras = await tx.remesa.findMany({
            where: { empresaId: f.empresaId, plantillaId: f.plantillaId, archivoHash: f.archivoHash, id: { not: f.id } },
            select: {
                id: true, numeroRemesa: true, estadoProceso: true, filtroFilas: true,
                progreso: { select: { fase: true, encoladaAt: true, startedAt: true, finishedAt: true, resumen: true } },
                _count: { select: { deudor: true } },
            },
        });
        const clave = claveDeCorte(f.filtroFilas);
        const desde = new Date(f.createdAt).getTime();
        const choques: string[] = [];
        for (const o of otras ?? []) {
            if (!this.tieneCortePropio(o.filtroFilas) || claveDeCorte(o.filtroFilas) !== clave) continue;
            const confirmada = o.progreso?.encoladaAt ? new Date(o.progreso.encoladaAt).getTime() : null;
            if (confirmada == null || confirmada <= desde) continue;
            const situacion = this.situacionDeCorte(o.estadoProceso, o.progreso, o._count?.deudor ?? 0);
            if (situacion && situacion !== 'SIN_CARGAR') choques.push(o.numeroRemesa);
        }
        return choques;
    }

    private textoChoqueAlConfirmar(choques: Array<{ numero: string; otras: string[] }>): string {
        if (choques.length === 1) {
            return (
                `El corte de la remesa ${choques[0].numero} ya figura en la remesa ${choques[0].otras.join(', ')}, que se confirmó ` +
                'después de armar esta vista previa: no se puede confirmar. Eliminá esta vista previa.'
            );
        }
        return (
            `El corte de ${choques.map((c) => `la remesa ${c.numero} ya figura en la remesa ${c.otras.join(', ')}`).join('; el de ')}. ` +
            'Esas remesas se confirmaron después de armar estas vistas previas: no se puede confirmar ninguna. Eliminá estas vistas previas.'
        );
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
                // Un P2002 también puede venir de la PK de una fila de progreso huérfana (wipe con
                // TRUNCATE): reintentar con otro número no lo arregla. Si `meta.target` viene informado
                // y no nombra a `numeroRemesa`, no es un choque de número: se relanza. MySQL informa el
                // nombre del índice (`Remesa_empresaId_numeroRemesa_key`) o `PRIMARY`.
                const target = e.meta?.target;
                const targetTxt = Array.isArray(target) ? target.join(',') : typeof target === 'string' ? target : '';
                if (targetTxt && !targetTxt.includes('numeroRemesa')) throw e;
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

    /** Escritura anidada que deja el total de la vista previa en la fila de progreso del borrador.
     *  No incrementa `rev`: un borrador no se transmite por socket. */
    private progresoBorrador(totalEsperado: number): Prisma.import_progresoUpdateOneWithoutRemesaNestedInput {
        return {
            upsert: {
                create: { fase: 'BORRADOR', totalEsperado },
                update: { totalEsperado },
            },
        };
    }

    // --- VALIDAR (preview) ---
    async validateRemesa(remesaId: number, sampleRows = 50, hoja?: string) {
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: { plantilla: true, progreso: { select: { encoladaAt: true } } },
        });

        if (!remesa || !remesa.archivo || !remesa.plantilla) {
            throw new NotFoundException('Remesa/archivo/plantilla no existe');
        }

        // Solo se valida un borrador (#20). Escrita en negativo: lo que no es borrador es lo que
        // está en curso o terminó, y volver a validar le pisaría los contadores.
        if (
            remesa.estadoProceso === 'PROCESANDO' ||
            remesa.estadoProceso === 'FINALIZADA' ||
            remesa.estadoProceso === 'FALLIDA' ||
            remesa.progreso?.encoladaAt
        ) {
            this.logger.warn(
                `Validar rechazado: la remesa ${remesaId} ya fue confirmada (estado=${remesa.estadoProceso})`,
            );
            throw new ConflictException('Esta importación ya fue confirmada: no se puede volver a validar.');
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

            // Antes no persistía nada: la remesa quedaba sin total y la carga sin porcentaje (#10).
            await this.prisma.remesa.update({
                where: { id: remesaId },
                data: {
                    estadoProceso: 'VALIDANDO',
                    totalFilas: totalRows,
                    okFilas: ok,
                    errFilas: 0,
                    progreso: this.progresoBorrador(totalRows),
                },
            });

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
                data: { estadoProceso: 'VALIDANDO', totalFilas: totalRows, okFilas: ok, errFilas: 0, progreso: this.progresoBorrador(totalRows) },
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
                    progreso: this.progresoBorrador(resumen.tramites),
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
        // Se evalúan en el mismo orden que el worker (§9.5.10): primero el filtro de la plantilla y después
        // el corte de la remesa, para que la vista previa y la carga digan lo mismo.
        let descartadas = 0;
        const { dePlantilla, deCorte } = this.filtrosSeparados(remesa, mapping);
        let fueraDeCorte = 0;
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

        // Fase 4a de multiclaves (spec §10.9): si la plantilla de PAGOS mapea `nroConvenio`, se hace
        // una pasada COMPLETA sobre esa columna (no solo la muestra) — reusa el mismo recorrido de
        // arriba, que ya lee el archivo entero para `colisiones`. `idExterno` derivado (D16) NO
        // entra acá: esto es solo el conteo de la vista previa, no escribe nada.
        const idxNroConvenio = mapping?.columns?.nroConvenio?.fromIndex;
        const idxImporteRaw = mapping?.columns?.monto?.fromIndex ?? mapping?.columns?.importe?.fromIndex;
        const transformsImporte = mapping?.columns?.monto?.transforms ?? mapping?.columns?.importe?.transforms;
        const medirMulticlavePagos =
            remesa.categoria === 'PAGOS' && typeof idxNroConvenio === 'number' && idxNroConvenio >= 0;
        let mcFilasConClave = 0;
        let mcIlegibles = 0;
        let mcImporteConClave = 0;
        // Cuenta OCURRENCIAS por convenio (no un Set): si el mismo convenio aparece en dos filas,
        // las dos tienen que contar en `claveCargada`/`quita`/`total` — un `Set` (versión anterior)
        // deduplicaba el convenio y dejaba "2 filas con clave / 1 clave cargada", una contradicción
        // que encontró la auditoría (hallazgo #5). Se sigue consultando `clave_pago` una vez por
        // convenio DISTINTO (barato); lo que cambia es que el conteo final es por FILA.
        const mcConveniosVistos = new Map<string, number>();

        try {
            await recorrerFilas(
                {
                    paths,
                    nombres,
                    tieneHeader: hasHeader,
                    separador: sep,
                    anchoFijo: this.layoutAnchoFijo(mapping),
                    // La misma hoja que usa la ejecución (#19): si el operador eligió otra, la vista previa no puede mirar la primera.
                    hoja: hoja ?? remesa.hoja ?? undefined,
                },
                ({ valores, origen }) => {
                    if (!pasaFiltro(valores, dePlantilla)) {
                        descartadas++;
                        return;
                    }
                    if (!pasaFiltro(valores, deCorte)) {
                        descartadas++;
                        fueraDeCorte++;
                        return;
                    }
                    if (mideColisiones) {
                        colisiones.agregar(
                            String(valores[idxDocumento!] ?? '').trim(),
                            String(valores[idxNroCliente!] ?? '').trim() || null,
                        );
                    }
                    if (medirMulticlavePagos) {
                        const { refClave, ilegible } = refClaveDeFila(valores[idxNroConvenio!]);
                        if (ilegible) mcIlegibles++;
                        if (refClave) {
                            mcFilasConClave++;
                            mcConveniosVistos.set(refClave, (mcConveniosVistos.get(refClave) ?? 0) + 1);
                            if (typeof idxImporteRaw === 'number' && idxImporteRaw >= 0) {
                                const importeTransformado = applyTransforms(valores[idxImporteRaw], transformsImporte);
                                const imp = importeDePago(importeTransformado);
                                if (imp != null) mcImporteConClave += imp;
                            }
                        }
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

        // Fase 4a de multiclaves (spec §10.9): con `nroConvenio` mapeado, cruzar los convenios
        // vistos en TODO el archivo contra `clave_pago`, en tandas de 1.000 (mismo patrón que el
        // resumen de la carga de claves, `ClavesService.resumenLote`).
        let multiclavePagos: {
            filas: number; conClave: number; ilegibles: number;
            claveCargada: number; claveOtraEmpresa: number; claveNoCargada: number;
            quita: number; total: number; sinCaso: number; tramitesEnVariosCasos: number;
            importeConClave: string;
        } | undefined;

        if (medirMulticlavePagos) {
            const convenios = [...mcConveniosVistos.keys()];
            const clavesEncontradas: Array<{ nroConvenio: string; empresaId: number; nroTramite: string; tipo: string }> = [];
            for (let i = 0; i < convenios.length; i += 1000) {
                const chunk = convenios.slice(i, i + 1000);
                const rows = await this.prisma.clave_pago.findMany({
                    where: { nroConvenio: { in: chunk } },
                    select: { nroConvenio: true, empresaId: true, nroTramite: true, tipo: true },
                });
                clavesEncontradas.push(...rows);
            }
            const claveInfoPorConvenio = new Map(clavesEncontradas.map((c) => [c.nroConvenio, c]));

            // Todos los conteos de acá son POR FILA (multiplicando por las ocurrencias de cada
            // convenio en `mcConveniosVistos`), consistente con `filas`/`conClave` — no por convenio
            // distinto, que es lo que producía la contradicción del hallazgo #5.
            let claveCargada = 0;
            let claveOtraEmpresa = 0;
            let claveNoCargada = 0;
            let quita = 0;
            let total = 0;
            for (const [convenio, ocurrencias] of mcConveniosVistos) {
                const info = claveInfoPorConvenio.get(convenio);
                if (!info) {
                    claveNoCargada += ocurrencias;
                } else if (info.empresaId !== remesa.empresaId) {
                    claveOtraEmpresa += ocurrencias;
                } else {
                    claveCargada += ocurrencias;
                    if (info.tipo === 'QUITA') quita += ocurrencias;
                    else if (info.tipo === 'TOTAL') total += ocurrencias;
                }
            }

            // sinCaso/tramitesEnVariosCasos son propiedades del TRÁMITE, no de la fila ni del
            // convenio: un trámite tiene o no tiene caso una sola vez, sin importar cuántas filas de
            // pago lo referencien. Se calculan sobre los convenios DISTINTOS cargados en esta empresa.
            const claveCargadaRows = clavesEncontradas.filter((c) => c.empresaId === remesa.empresaId);
            const nroTramites = [...new Set(claveCargadaRows.map((c) => c.nroTramite))];
            let sinCaso = 0;
            let tramitesEnVariosCasos = 0;
            for (let i = 0; i < nroTramites.length; i += 1000) {
                const chunk = nroTramites.slice(i, i + 1000);
                const casos = await this.prisma.deudor.findMany({
                    where: { empresaId: remesa.empresaId, nroCliente: { in: chunk } },
                    select: { nroCliente: true },
                });
                const porTramite = new Map<string, number>();
                for (const c of casos) {
                    if (!c.nroCliente) continue;
                    porTramite.set(c.nroCliente, (porTramite.get(c.nroCliente) ?? 0) + 1);
                }
                for (const t of chunk) {
                    const n = porTramite.get(t) ?? 0;
                    if (n === 0) sinCaso++;
                    else if (n > 1) tramitesEnVariosCasos++;
                }
            }

            multiclavePagos = {
                // `filas` = TOTAL de filas del archivo (spec §10.9); `conClave` = las que traen un
                // `nroConvenio` que normaliza. Eran el mismo número (hallazgo #5) — un texto que dice
                // "23 de 23 filas" en vez de "23 de 104" es inservible para decidir si conviene cargar
                // las claves que faltan antes de ejecutar.
                filas: totalRows,
                conClave: mcFilasConClave,
                ilegibles: mcIlegibles,
                claveCargada,
                claveOtraEmpresa,
                claveNoCargada,
                quita,
                total,
                sinCaso,
                tramitesEnVariosCasos,
                importeConClave: mcImporteConClave.toFixed(2),
            };

            if (mcFilasConClave > 0) {
                advertencias.push(
                    `${mcFilasConClave} de las ${totalRows.toLocaleString('es-AR')} filas traen número de convenio de ` +
                    `clave de pago. ${claveCargada} corresponden a claves cargadas en esta empresa ` +
                    `(${quita} de quita, ${total} de saldo total)${claveNoCargada > 0 ? ` y ${claveNoCargada} a claves ` +
                    'que no están cargadas: esos casos NO se van a cancelar con quita. Cargá las claves de esas ' +
                    'nóminas y volvé a consolidar.' : '.'}`,
                );
            }
            if (claveOtraEmpresa > 0) {
                advertencias.push(
                    `${claveOtraEmpresa} convenio(s) pertenecen a claves de OTRA empresa. Esas filas se cargan ` +
                    'como pago común si el trámite existe acá.',
                );
            }
            if (tramitesEnVariosCasos > 0) {
                advertencias.push(
                    `${tramitesEnVariosCasos} trámite(s) con clave están en más de un caso de esta empresa: el pago ` +
                    'va al caso con el convenio de la clave, o al de la remesa más reciente.',
                );
            }
            if (mcIlegibles > 0) {
                advertencias.push(
                    `${mcIlegibles} fila(s) traen algo en la columna del convenio que no se puede leer como clave.`,
                );
            }
        }

        await this.prisma.remesa.update({
            where: { id: remesaId },
            data: {
                estadoProceso: 'VALIDANDO',
                totalFilas: totalRows,
                okFilas: ok,
                errFilas: err,
                progreso: this.progresoBorrador(totalRows),
            }
        });

        return {
            total: totalRows,
            ok,
            err,
            sample: preview,
            archivos: paths.length > 1 ? nombres : undefined,
            // `descartadas` es el total (filtro de la plantilla + otros cortes); `fueraDeCorte` es el subconjunto
            // de otro corte y solo viaja si la remesa tiene corte. `filtro` describe SOLO el de la plantilla.
            descartadas: descartadas || undefined,
            fueraDeCorte: deCorte.length > 0 ? fueraDeCorte : undefined,
            filtro: descartadas - fueraDeCorte > 0 ? describirFiltros(dePlantilla) : undefined,
            advertencias: advertencias.length ? advertencias : undefined,
            multiclavePagos,
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
                hoja: hoja ?? remesa.hoja ?? undefined,
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
        const t0 = Date.now();

        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
        });

        if (!remesa) {
            throw new NotFoundException('Remesa no existe');
        }

        if (!remesa.categoria) {
            throw new BadRequestException('La remesa no tiene categoría definida');
        }

        this.logger.log(`Encolando remesa=${remesaId} usuario=${usuarioId ?? 'sin-usuario'} categoria=${remesa.categoria}`);

        // Las remesas de origen con las que se confirma quedan en la fila (lo necesita retomar: viajaban solo en el job).
        const resumenConOrigen = {
            v: 1,
            origen: { remesaOrigenId: remesaOrigenId ?? null, remesaOrigenIds: remesaOrigenIds ?? null },
        } as Prisma.InputJsonObject;

        // Todo el chequeo y el paso a EN_COLA van en una transacción: el mutex es la fila del usuario
        // (no un rango de `remesa`), así dos confirmaciones simultáneas del mismo usuario se ordenan
        // sin depender de qué gap locks toma MySQL.
        let estadoPrevio = 'PENDIENTE';
        const encolada = await this.prisma.$transaction(async (tx) => {
            if (usuarioId) {
                await tx.$queryRaw`SELECT id FROM usuario WHERE id = ${usuarioId} FOR UPDATE`;
            }

            const filas = await tx.$queryRaw<Array<{
                estadoProceso: string; totalFilas: number; encoladaAt: Date | null;
                // Tolerante: un doble que no las devuelve se lee como "sin corte propio".
                numeroRemesa?: string; empresaId?: number; plantillaId?: number | null; archivoHash?: string | null;
                filtroFilas?: unknown; createdAt?: Date | null;
            }>>`
                SELECT r.estadoProceso AS estadoProceso, r.totalFilas AS totalFilas, p.encoladaAt AS encoladaAt,
                       r.numeroRemesa AS numeroRemesa, r.empresaId AS empresaId, r.plantillaId AS plantillaId,
                       r.archivoHash AS archivoHash, r.filtroFilas AS filtroFilas, r.createdAt AS createdAt
                FROM remesa r LEFT JOIN import_progreso p ON p.remesaId = r.id
                WHERE r.id = ${remesaId}
                FOR UPDATE
            `;
            const fila = filas[0];
            if (!fila) throw new NotFoundException('Remesa no existe');

            // Idempotencia (#20): un doble clic o una pestaña vieja no encola dos veces ni
            // re-ejecuta una carga terminada.
            if ((fila.estadoProceso !== 'PENDIENTE' && fila.estadoProceso !== 'VALIDANDO') || fila.encoladaAt != null) {
                this.logger.warn(`Encolar rechazado: la remesa ${remesaId} ya fue confirmada (estado=${fila.estadoProceso})`);
                throw new ConflictException('Esta importación ya fue confirmada.');
            }

            // Respaldo del botón deshabilitado (#4). Una PENDIENTE no pasó por la vista previa y su
            // total no se conoce: se deja pasar y el worker la termina como SIN_FILAS si corresponde.
            if (fila.estadoProceso === 'VALIDANDO' && Number(fila.totalFilas) === 0) {
                this.logger.warn(`Encolar rechazado: la vista previa de la remesa ${remesaId} no encontró filas`);
                throw new BadRequestException(
                    'La vista previa no encontró filas para importar. Revisá el archivo y el filtro de la plantilla.',
                );
            }

            // Otra remesa del mismo corte que se confirmó después de armar esta (dos altas del mismo archivo antes de confirmar ninguna).
            const choques = await this.remesasQueChocanConElCorte(tx, {
                id: remesaId, empresaId: Number(fila.empresaId), plantillaId: fila.plantillaId ?? null,
                archivoHash: fila.archivoHash ?? null, filtroFilas: fila.filtroFilas, createdAt: fila.createdAt,
            });
            if (choques.length > 0) {
                this.logger.warn(`Encolar rechazado: el corte de la remesa ${remesaId} ya figura en ${choques.join(', ')}`);
                throw new ConflictException(this.textoChoqueAlConfirmar([{ numero: String(fila.numeroRemesa), otras: choques }]));
            }

            if (usuarioId) {
                const otras = await tx.$queryRaw<Array<{ remesaId: number }>>`
                    SELECT p.remesaId AS remesaId
                    FROM import_progreso p JOIN remesa r ON r.id = p.remesaId
                    WHERE r.usuarioCreadorId = ${usuarioId} AND p.encoladaAt IS NOT NULL AND p.finishedAt IS NULL
                `;
                if (otras.length > 0) {
                    this.logger.warn(`Encolar rechazado: el usuario ${usuarioId} ya tiene la remesa ${otras[0].remesaId} en curso`);
                    throw new ConflictException(
                        'Ya tenés una importación en curso. Esperá a que termine antes de iniciar otra.',
                    );
                }
            }

            estadoPrevio = fila.estadoProceso;
            const ahora = new Date();
            const totalEsperado = Number(fila.totalFilas);
            // Los contadores de la remesa dejan de ser los de la muestra de la vista previa (mitad del arreglo de #5).
            return tx.remesa.update({
                where: { id: remesaId },
                data: {
                    estadoProceso: 'PENDIENTE',
                    ...(usuarioId ? { usuarioCreadorId: usuarioId } : {}),
                    okFilas: 0,
                    errFilas: 0,
                    progreso: {
                        upsert: {
                            create: { fase: 'EN_COLA', encoladaAt: ahora, totalEsperado, resumen: resumenConOrigen, rev: 1 },
                            update: {
                                fase: 'EN_COLA',
                                subfase: null,
                                encoladaAt: ahora,
                                totalEsperado,
                                porcentaje: 0,
                                procesadas: 0,
                                ok: 0,
                                err: 0,
                                descartadas: 0,
                                advertencias: 0,
                                resultado: null,
                                error: null,
                                errorPostProceso: null,
                                finishedAt: null,
                                cancelSolicitadaAt: null,
                                resumen: resumenConOrigen,
                                rev: { increment: 1 },
                            },
                        },
                    },
                },
                include: { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } },
            });
        });

        const ctx = this.requestContext.get();
        let jobId: string | undefined;
        let job: Job | undefined;
        try {
            // Con Redis caído `add` no tira: espera (ioredis reintenta y encola offline). El tope evita
            // que el pedido HTTP quede colgado con la remesa EN_COLA. Si vence pero el job entra tarde,
            // llega con la remesa en borrador y lo ignora la guarda de `processImportJob`; ese `add`
            // tardío no escribe nada (el `jobId` solo se guarda si entró a tiempo).
            job = await this.conTope(
                this.importQueue.add('process-import', {
                    remesaId,
                    remesaOrigenId,
                    remesaOrigenIds,
                    usuarioId,
                    _ctx: ctx ? { requestId: ctx.requestId, usuarioId: ctx.usuarioId } : undefined,
                }),
                'encolar',
            );
            jobId = job?.id;
        } catch (e: any) {
            // Compensación (#23): sin esto un Redis caído deja al usuario "con una importación en curso" para
            // siempre. La remesa vuelve a borrador (como estaba antes de confirmar) para que el mensaje diga
            // la verdad —"probá de nuevo"— y un segundo "Confirmar e importar" funcione sin volver a subir el archivo.
            this.logger.error(`No se pudo encolar la remesa ${remesaId}: ${e?.message}`, e?.stack);
            // La decisión se toma con la fila bloqueada (§9.5.8): el `update` condicionado de Prisma no es atómico
            // (hace un `SELECT` y después un `UPDATE`), así que si el worker tomó el job entre los dos devolvía a
            // borrador una carga que estaba corriendo —o ya terminada— y le decía "probá de nuevo" al usuario.
            let desenlace: 'COMPENSADA' | 'TOMADA' | 'BORRADA' | 'FALLO' = 'FALLO';
            try {
                desenlace = await this.prisma.$transaction(async (tx) => {
                    const filas = await tx.$queryRaw<Array<{ estadoProceso: string; fase: string | null; startedAt: Date | null }>>`
                        SELECT r.estadoProceso AS estadoProceso, p.fase AS fase, p.startedAt AS startedAt
                        FROM remesa r LEFT JOIN import_progreso p ON p.remesaId = r.id
                        WHERE r.id = ${remesaId}
                        FOR UPDATE
                    `;
                    const f = filas[0];
                    if (!f) return 'BORRADA' as const;
                    if ((f.estadoProceso === 'PENDIENTE' || f.estadoProceso === 'VALIDANDO') && f.fase === 'EN_COLA' && f.startedAt == null) {
                        await tx.remesa.update({
                            where: { id: remesaId },
                            data: {
                                estadoProceso: estadoPrevio as 'PENDIENTE' | 'VALIDANDO',
                                progreso: {
                                    update: { fase: 'BORRADOR', encoladaAt: null, jobId: null, rev: { increment: 1 } },
                                },
                            },
                        });
                        return 'COMPENSADA' as const;
                    }
                    return 'TOMADA' as const;
                });
            } catch (e2: any) {
                this.logger.error(`No se pudo devolver la remesa ${remesaId} a borrador tras el error de encolado: ${motivoLegible(e2)}`, e2?.stack);
            }
            if (desenlace === 'BORRADA') {
                this.logger.warn(`Encolar: la remesa ${remesaId} fue eliminada mientras se confirmaba`);
                throw new NotFoundException('La importación fue eliminada mientras se confirmaba.');
            }
            if (desenlace === 'TOMADA') {
                // El job sí entró y el worker la tomó (o ya terminó): decirle "probá de nuevo" sería mentir.
                const actual = await this.leerCargaTrasEncolarFallido(remesaId);
                if (actual === 'BORRADA') {
                    this.logger.warn(`Encolar: la remesa ${remesaId} fue eliminada mientras se confirmaba`);
                    throw new NotFoundException('La importación fue eliminada mientras se confirmaba.');
                }
                if (actual) {
                    this.logger.warn(
                        `Encolar: el add de la remesa ${remesaId} falló (${motivoLegible(e)}) pero el job entró y el ` +
                        `worker ya tomó la carga (${actual.estadoProceso}): se responde con el estado real, no "probá de nuevo"`,
                    );
                    const cargaReal = armarEstadoCarga(actual, actual.progreso);
                    return { message: 'Importación encolada correctamente', remesaId, carga: cargaReal };
                }
            }
            throw new ServiceUnavailableException(
                'No se pudo iniciar la importación: la cola de trabajos no responde. Probá de nuevo en unos minutos.',
            );
        }

        // El id del job queda en la fila: es lo que permite encontrarlo (y sacarlo de la cola) si la
        // carga nunca arranca y hay que borrarla.
        if (jobId) {
            try {
                await this.prisma.remesa.update({
                    where: { id: remesaId },
                    data: { progreso: { update: { jobId: String(jobId).slice(0, 64) } } },
                });
            } catch (e: any) {
                if (e?.code === 'P2025') {
                    // La remesa ya no está: el borrado llegó entre el commit y el `add` (§9.5.8). Se saca el job
                    // recién encolado; si no se puede, el worker tampoco va a encontrar la remesa.
                    this.logger.warn(`Encolar: la remesa ${remesaId} fue eliminada mientras se confirmaba; se saca su job ${jobId}`);
                    try {
                        await this.conTope(job!.remove(), 'remove');
                    } catch (rmErr: any) {
                        this.logger.warn(`No se pudo sacar de la cola el job ${jobId} de la remesa ${remesaId}: ${rmErr?.message}`);
                    }
                    throw new NotFoundException('La importación fue eliminada mientras se confirmaba.');
                }
                this.logger.warn(`No se pudo guardar el id del job de la remesa ${remesaId}: ${e?.message}`);
            }
        }

        const enColaDelante = await this.enColaDelanteDe(remesaId, encolada.progreso?.encoladaAt ?? null);
        const carga = armarEstadoCarga(encolada, encolada.progreso, new Date(), { enColaDelante });
        try {
            this.realtimeService.emitImportProgreso(carga);
        } catch (emitErr: any) {
            this.logger.warn(`Error emitiendo import:progreso (EN_COLA) de la remesa ${remesaId}: ${emitErr?.message}`);
        }

        this.logger.log(`Remesa ${remesaId} encolada job=${jobId ?? 'n/d'} en ${Date.now() - t0}ms`);

        return { message: 'Importación encolada correctamente', remesaId, carga };
    }

    // ─── Fase C, entrega 1 (docs/imports-progreso-realtime-spec.md §10) ───────────────────────────────────────────
    // Carga dividida encolada por el backend, cancelar, retomar lo que no cargó nada. Toda escritura condicionada va
    // con la fila bloqueada (`FOR UPDATE`): el `update` de Prisma con un `where` no único no es atómico.

    /** `SELECT … FOR UPDATE` de remesas con su fila de progreso, en orden de id (el orden de los locks). */
    private async bloquearCargas(tx: Prisma.TransactionClient, ids: number[]): Promise<FilaBloqueada[]> {
        const filas = await tx.$queryRaw<FilaBloqueada[]>`
            SELECT r.id AS id, r.numeroRemesa AS numeroRemesa, r.estadoProceso AS estadoProceso, r.totalFilas AS totalFilas,
                   r.categoria AS categoria, r.empresaId AS empresaId, r.plantillaId AS plantillaId,
                   r.archivoHash AS archivoHash, r.filtroFilas AS filtroFilas, r.usuarioCreadorId AS usuarioCreadorId,
                   p.remesaId AS progresoId, p.fase AS fase, p.encoladaAt AS encoladaAt, p.startedAt AS startedAt,
                   p.finishedAt AS finishedAt, p.resumen AS resumen, p.cancelSolicitadaAt AS cancelSolicitadaAt,
                   p.jobId AS jobId, p.resultado AS resultado, p.rev AS rev, r.createdAt AS createdAt
            FROM remesa r LEFT JOIN import_progreso p ON p.remesaId = r.id
            WHERE r.id IN (${Prisma.join(ids)})
            ORDER BY r.id
            FOR UPDATE
        `;
        return filas.map((f) => ({ ...f, id: Number(f.id), totalFilas: Number(f.totalFilas) }));
    }

    /** Dueño de la remesa o `importacion.ver_progreso_otros`: la misma regla que el borrado. */
    private verificarDuenoOPermiso(duenoId: number | null, user: UsuarioDeCarga, que: string): void {
        if (!user.permisos.includes('importacion.ver_progreso_otros') && duenoId !== user.sub) {
            this.logger.warn(`Usuario ${user.sub} sin permiso para ${que} de otro usuario (dueño=${duenoId ?? 'n/d'})`);
            throw new ForbiddenException(`No tenés permiso para ${que}`);
        }
    }

    private async nombreDeUsuario(usuarioId: number): Promise<string> {
        try {
            const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nombre: true } });
            return u?.nombre ?? '';
        } catch (e: any) {
            this.logger.warn(`No se pudo leer el nombre del usuario ${usuarioId}: ${e?.message}`);
            return '';
        }
    }

    private async leerCargaConProgreso(remesaId: number) {
        return this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } },
        });
    }

    // --- EJECUTAR UN GRUPO (carga dividida) ---
    /**
     * Confirma las N remesas de una carga dividida con UN pedido: pasan juntas a EN_COLA y el backend las encola en
     * orden (§10.5.2). No hay un job padre: el grupo es una etiqueta en N filas, y si una falla, las demás siguen.
     */
    async ejecutarGrupo(
        p: { remesaIds: number[]; remesaOrigenId?: number; remesaOrigenIds?: number[] },
        usuarioId: number,
    ) {
        const t0 = Date.now();
        const remesaIds = [...new Set((p.remesaIds ?? []).map(Number))].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
        if (remesaIds.length < 2 || remesaIds.length > 100) {
            this.logger.warn(`Grupo rechazado: ${remesaIds.length} remesa(s); tienen que ser entre 2 y 100`);
            throw new BadRequestException('Una carga dividida necesita entre 2 y 100 remesas.');
        }
        const grupoId = crypto.randomUUID();
        this.logger.log(`Encolando grupo ${grupoId} de ${remesaIds.length} remesas (${remesaIds.join(', ')}) usuario=${usuarioId}`);
        const r = await this.encolarLote({
            remesaIds,
            modo: 'CONFIRMAR',
            solicitanteId: usuarioId,
            origen: { remesaOrigenId: p.remesaOrigenId, remesaOrigenIds: p.remesaOrigenIds },
            grupoId,
        });
        this.logger.log(`Grupo ${grupoId} encolado: ${r.cargas.length} en curso, ${r.noEncoladas.length} sin encolar, en ${Date.now() - t0}ms`);
        return {
            message: 'Carga dividida encolada correctamente',
            grupoId,
            cargas: r.cargas,
            ...(r.noEncoladas.length > 0 ? { noEncoladas: r.noEncoladas } : {}),
        };
    }

    /** Las remesas de un grupo, por `grupoOrden`. `404` si no hay ninguna. `remesas` puede traer menos que `total` si alguna se eliminó. */
    async grupo(grupoId: string) {
        const remesas = await this.prisma.remesa.findMany({
            where: { progreso: { is: { grupoId } } },
            orderBy: { progreso: { grupoOrden: 'asc' } },
            include: { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } },
        });
        if (remesas.length === 0) {
            this.logger.warn(`Grupo ${grupoId}: no existe`);
            throw new NotFoundException('La carga dividida no existe.');
        }
        const posiciones = remesas.some((r) => r.progreso?.fase === 'EN_COLA') ? await this.posicionesEnCola() : null;
        return {
            grupoId,
            total: remesas[0].progreso?.grupoTotal ?? remesas.length,
            remesas: remesas.map((r) =>
                armarEstadoCarga(r, r.progreso, new Date(), { enColaDelante: posiciones?.get(r.id) ?? null }),
            ),
        };
    }

    // --- ENCOLAR UN LOTE (confirmar un grupo / retomar) ---
    /**
     * Una sola función para confirmar un grupo y para retomar (§10.5.1): una transacción pasa las N a EN_COLA con
     * `encoladaAt` escalonado de a 1 ms, un `addBulk` las manda a la cola en orden y, si el encolado falla, se
     * COMPENSA mirando la base —lo que el worker ya hizo o no—, porque `addBulk` no es atómico.
     */
    private async encolarLote(p: {
        remesaIds: number[];
        modo: 'CONFIRMAR' | 'RETOMAR';
        solicitanteId: number;
        origen?: { remesaOrigenId?: number; remesaOrigenIds?: number[] };
        grupoId?: string;
        /** RETOMAR de un grupo: lo que no se puede retomar va a `omitidas` en vez de abortar. */
        tolerante?: boolean;
    }): Promise<{
        cargas: EstadoCargaDto[];
        noEncoladas: Array<{ remesaId: number; numeroRemesa: string }>;
        omitidas: Array<{ remesaId: number; numeroRemesa: string; motivo: string }>;
    }> {
        const { modo } = p;
        const omitidas: Array<{ remesaId: number; numeroRemesa: string; motivo: string }> = [];
        // Los dueños se conocen sin lock; después de bloquear se comprueba que no cambiaron.
        const duenos = modo === 'CONFIRMAR'
            ? [p.solicitanteId]
            : [...new Set((await this.prisma.remesa.findMany({
                where: { id: { in: p.remesaIds } }, select: { usuarioCreadorId: true },
            })).map((r) => r.usuarioCreadorId).filter((n): n is number => n != null))].sort((a, b) => a - b);

        let encoladas: Array<NonNullable<Awaited<ReturnType<ImportService['leerCargaConProgreso']>>>>;
        const previos = new Map<number, 'PENDIENTE' | 'VALIDANDO'>();
        let ids = p.remesaIds;
        let origenes = new Map<number, { remesaOrigenId: number | null; remesaOrigenIds: number[] | null }>();
        try {
            encoladas = await this.prisma.$transaction(async (tx) => {
                // a. mutex: la fila de los usuarios, por id (el orden de `executeRemesa`).
                if (duenos.length > 0) {
                    await tx.$queryRaw`SELECT id FROM usuario WHERE id IN (${Prisma.join(duenos)}) ORDER BY id FOR UPDATE`;
                }
                // b. las remesas, por id, con su fila de progreso.
                const filas = await this.bloquearCargas(tx, p.remesaIds);
                const porId = new Map(filas.map((f) => [f.id, f]));
                const validas: FilaBloqueada[] = [];
                for (const id of p.remesaIds) {
                    const f = porId.get(id);
                    if (!f) {
                        if (modo === 'RETOMAR' && p.tolerante) {
                            omitidas.push({ remesaId: id, numeroRemesa: String(id), motivo: 'La remesa ya no existe.' });
                            continue;
                        }
                        this.logger.warn(`Encolar lote: la remesa ${id} no existe`);
                        throw new NotFoundException(`La remesa ${id} no existe.`);
                    }
                    // c. validar según el modo.
                    if (modo === 'CONFIRMAR') this.validarParaConfirmar(f);
                    else {
                        const rechazo = await this.motivoNoRetomable(tx, f);
                        if (rechazo) {
                            if (p.tolerante) {
                                // Solo las fallidas que no se pueden retomar son "omitidas"; una que terminó bien o sigue en curso no.
                                if (f.estadoProceso === 'FALLIDA') omitidas.push({ remesaId: id, numeroRemesa: f.numeroRemesa, motivo: rechazo.texto });
                                continue;
                            }
                            throw rechazo.excepcion;
                        }
                    }
                    validas.push(f);
                }
                if (modo === 'CONFIRMAR') {
                    this.validarMismoArchivo(validas);
                    // Ninguna se encola si alguna choca con otra del mismo corte confirmada después de armarla.
                    const choques: Array<{ numero: string; otras: string[] }> = [];
                    for (const f of validas) {
                        const otras = await this.remesasQueChocanConElCorte(tx, f);
                        if (otras.length > 0) choques.push({ numero: f.numeroRemesa, otras });
                    }
                    if (choques.length > 0) {
                        this.logger.warn(`Grupo rechazado: ${choques.map((c) => `${c.numero} choca con ${c.otras.join(', ')}`).join('; ')}`);
                        throw new ConflictException(this.textoChoqueAlConfirmar(choques));
                    }
                }
                if (validas.length === 0) {
                    throw new ConflictException('Ninguna de las importaciones se puede retomar: ya procesaron filas o no terminaron.');
                }
                ids = validas.map((f) => f.id);
                // El dueño no cambió entre la lectura sin lock y ahora.
                if (modo === 'RETOMAR' && validas.some((f) => f.usuarioCreadorId != null && !duenos.includes(f.usuarioCreadorId))) {
                    throw new ConflictException('Otra operación está tocando estas remesas. Probá de nuevo.');
                }
                // d. cada dueño sin otra carga en curso que no sea de este lote.
                const duenosDelLote = modo === 'CONFIRMAR'
                    ? [p.solicitanteId]
                    : [...new Set(validas.map((f) => f.usuarioCreadorId).filter((n): n is number => n != null))];
                if (duenosDelLote.length > 0) {
                    const otras = await tx.$queryRaw<Array<{ remesaId: number; duenoId?: number | null }>>`
                        SELECT p.remesaId AS remesaId, r.usuarioCreadorId AS duenoId
                        FROM import_progreso p JOIN remesa r ON r.id = p.remesaId
                        WHERE r.usuarioCreadorId IN (${Prisma.join(duenosDelLote)}) AND p.encoladaAt IS NOT NULL
                          AND p.finishedAt IS NULL AND p.remesaId NOT IN (${Prisma.join(ids)})
                    `;
                    if (otras.length > 0) {
                        this.logger.warn(`Encolar lote rechazado: ya hay una importación en curso (remesa ${otras[0].remesaId})`);
                        // Retomar la remesa de otro usuario: el que tiene la carga en curso es su dueño, no quien la retoma.
                        if (otras[0].duenoId != null && Number(otras[0].duenoId) !== p.solicitanteId) {
                            throw new ConflictException(
                                'El dueño de esta remesa ya tiene una importación en curso. Esperá a que termine antes de retomarla.',
                            );
                        }
                        throw new ConflictException('Ya tenés una importación en curso. Esperá a que termine antes de iniciar otra.');
                    }
                }
                // e. el paso a EN_COLA de las N, en orden, con `encoladaAt` escalonado.
                const ahora = Date.now();
                const resultado: typeof encoladas = [];
                for (const [i, f] of validas.entries()) {
                    const encoladaAt = new Date(ahora + i);
                    previos.set(f.id, f.estadoProceso === 'VALIDANDO' ? 'VALIDANDO' : 'PENDIENTE');
                    const include = { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } } as const;
                    if (modo === 'CONFIRMAR') {
                        const origen = {
                            remesaOrigenId: p.origen?.remesaOrigenId ?? null,
                            remesaOrigenIds: p.origen?.remesaOrigenIds ?? null,
                        };
                        origenes.set(f.id, origen);
                        const grupo = { grupoId: p.grupoId!, grupoOrden: i + 1, grupoTotal: validas.length };
                        const resumen = { v: 1, origen } as Prisma.InputJsonObject;
                        resultado.push(await tx.remesa.update({
                            where: { id: f.id },
                            data: {
                                estadoProceso: 'PENDIENTE',
                                usuarioCreadorId: p.solicitanteId,
                                okFilas: 0,
                                errFilas: 0,
                                progreso: {
                                    upsert: {
                                        create: { fase: 'EN_COLA', encoladaAt, totalEsperado: f.totalFilas, ...grupo, resumen, rev: 1 },
                                        update: {
                                            fase: 'EN_COLA', subfase: null, encoladaAt, totalEsperado: f.totalFilas,
                                            porcentaje: 0, procesadas: 0, ok: 0, err: 0, descartadas: 0, advertencias: 0,
                                            resultado: null, error: null, errorPostProceso: null, finishedAt: null,
                                            cancelSolicitadaAt: null, ...grupo, resumen, rev: { increment: 1 },
                                        },
                                    },
                                },
                            },
                            include,
                        }));
                    } else {
                        const previo = leerResumen(f.resumen) ?? {};
                        const { sinFilasEntregadas: _marca, cancelacion: _cancelacion, ...resto } = previo;
                        const resumen = { ...resto, v: 1, retomas: (previo.retomas ?? 0) + 1 } as Prisma.InputJsonObject;
                        origenes.set(f.id, {
                            remesaOrigenId: previo.origen?.remesaOrigenId ?? null,
                            remesaOrigenIds: previo.origen?.remesaOrigenIds ?? null,
                        });
                        resultado.push(await tx.remesa.update({
                            where: { id: f.id },
                            data: {
                                estadoProceso: 'PENDIENTE',
                                okFilas: 0,
                                errFilas: 0,
                                progreso: {
                                    update: {
                                        fase: 'EN_COLA', encoladaAt, totalEsperado: f.totalFilas,
                                        startedAt: null, heartbeatAt: null, finishedAt: null, resultado: null, error: null,
                                        errorPostProceso: null, cancelSolicitadaAt: null, subfase: null, jobId: null,
                                        fueraDeCorte: null, nuevos: null, actualizados: null,
                                        porcentaje: 0, procesadas: 0, ok: 0, err: 0, descartadas: 0, advertencias: 0, intentos: 0,
                                        resumen, rev: { increment: 1 },
                                    },
                                },
                            },
                            include,
                        }));
                    }
                }
                return resultado;
            }, TX_C1);
        } catch (e: any) {
            throw this.errorDeBloqueo(e, 'Encolar lote');
        }

        // ── 2. Encolar ──
        const ctx = this.requestContext.get();
        const jobsAEncolar = encoladas.map((r) => {
            const o = origenes.get(r.id);
            return {
                name: 'process-import',
                data: {
                    remesaId: r.id,
                    remesaOrigenId: o?.remesaOrigenId ?? undefined,
                    remesaOrigenIds: o?.remesaOrigenIds ?? undefined,
                    usuarioId: r.usuarioCreadorId ?? p.solicitanteId,
                    _ctx: ctx ? { requestId: ctx.requestId, usuarioId: ctx.usuarioId } : undefined,
                },
            };
        });
        let jobs: Job[] = [];
        try {
            // `addBulk` usa un pipeline y no un MULTI: no es atómico. Con Redis caído espera; el tope evita colgar el pedido.
            jobs = await this.conTope(this.importQueue.addBulk(jobsAEncolar), 'encolar lote');
        } catch (e: any) {
            this.logger.error(`No se pudo encolar el lote de ${ids.length} remesas (${ids.join(', ')}): ${e?.message}`, e?.stack);
            return this.compensarLote(ids, modo, previos, omitidas);
        }

        // ── 4. Emitir (antes de guardar los jobId) ──
        // Los `import:progreso` EN_COLA salen apenas el lote entró a la cola y ANTES de las N escrituras del jobId: el worker puede tomar
        // la primera remesa enseguida, y el evento EN_COLA llegaba después de su `import:iniciada` (hallazgo 4 de la auditoría).
        const posiciones = await this.posicionesEnCola();
        const cargas: EstadoCargaDto[] = [];
        for (const r of encoladas) {
            const carga = armarEstadoCarga(r, r.progreso, new Date(), { enColaDelante: posiciones?.get(r.id) ?? null });
            cargas.push(carga);
            try {
                this.realtimeService.emitImportProgreso(carga);
            } catch (emitErr: any) {
                this.logger.warn(`Error emitiendo import:progreso (EN_COLA) de la remesa ${r.id}: ${emitErr?.message}`);
            }
        }

        // ── 5. Guardar el jobId de cada una ──
        const quedaron = new Set(ids);
        for (const [i, r] of encoladas.entries()) {
            const job = jobs[i];
            if (!job?.id) continue;
            try {
                await this.prisma.remesa.update({
                    where: { id: r.id },
                    data: { progreso: { update: { jobId: String(job.id).slice(0, 64) } } },
                });
            } catch (e: any) {
                if (e?.code === 'P2025') {
                    this.logger.warn(`Encolar lote: la remesa ${r.id} fue eliminada mientras se confirmaba; se saca su job ${job.id}`);
                    quedaron.delete(r.id);
                    try {
                        await this.conTope(job.remove(), 'remove');
                    } catch (rmErr: any) {
                        this.logger.warn(`No se pudo sacar de la cola el job ${job.id} de la remesa ${r.id}: ${rmErr?.message}`);
                    }
                } else {
                    this.logger.warn(`No se pudo guardar el id del job de la remesa ${r.id}: ${e?.message}`);
                }
            }
        }

        const cargasFinal = cargas.filter((c) => quedaron.has(c.remesaId));
        return { cargas: cargasFinal, noEncoladas: [], omitidas };
    }

    private validarParaConfirmar(f: FilaBloqueada): void {
        if ((f.estadoProceso !== 'PENDIENTE' && f.estadoProceso !== 'VALIDANDO') || f.encoladaAt != null) {
            this.logger.warn(`Grupo rechazado: la remesa ${f.id} ya fue confirmada (estado=${f.estadoProceso})`);
            throw new ConflictException(`La remesa ${f.numeroRemesa} ya fue confirmada.`);
        }
        if (!f.categoria) throw new BadRequestException('La remesa no tiene categoría definida');
        if (f.estadoProceso === 'PENDIENTE') {
            this.logger.warn(`Grupo rechazado: la remesa ${f.id} no tiene hecha la vista previa`);
            throw new BadRequestException(`La remesa ${f.numeroRemesa} no tiene hecha la vista previa.`);
        }
        if (Number(f.totalFilas) === 0) {
            this.logger.warn(`Grupo rechazado: la vista previa de la remesa ${f.id} no encontró filas`);
            throw new BadRequestException(
                `La vista previa de la remesa ${f.numeroRemesa} no encontró filas para importar. Revisá el archivo y el filtro de la plantilla.`,
            );
        }
    }

    private validarMismoArchivo(filas: FilaBloqueada[]): void {
        const a = filas[0];
        const mismo = filas.every(
            (f) =>
                f.empresaId === a.empresaId && f.plantillaId === a.plantillaId && f.categoria === a.categoria &&
                f.archivoHash != null && f.archivoHash === a.archivoHash && this.tieneCortePropio(f.filtroFilas),
        );
        if (!mismo) {
            this.logger.warn(`Grupo rechazado: las remesas ${filas.map((f) => f.id).join(', ')} no son cortes del mismo archivo`);
            throw new BadRequestException('Las remesas no son cortes del mismo archivo.');
        }
        if (['MULTIRREGISTRO', 'MULTIARCHIVO', 'MULTICLAVES'].includes(String(a.categoria))) {
            this.logger.warn(`Grupo rechazado: la categoría ${a.categoria} no admite dividir la carga`);
            throw new BadRequestException('Esta categoría no admite dividir la carga.');
        }
    }

    /**
     * Compensación cuando `addBulk` falla (§10.5.1). No se intenta saber qué entró: se decide con la base, que es lo
     * que el worker ya hizo o no. Si la primera ya fue tomada, el lote entró y no se compensa nada.
     */
    private async compensarLote(
        ids: number[],
        modo: 'CONFIRMAR' | 'RETOMAR',
        previos: Map<number, 'PENDIENTE' | 'VALIDANDO'>,
        omitidas: Array<{ remesaId: number; numeroRemesa: string; motivo: string }>,
    ) {
        const tomada = (f: FilaBloqueada | undefined) =>
            !!f && (f.startedAt != null || f.finishedAt != null || f.estadoProceso === 'FINALIZADA' || f.estadoProceso === 'FALLIDA' || f.estadoProceso === 'PROCESANDO');
        let primeraTomada = false;
        try {
            primeraTomada = await this.prisma.$transaction(async (tx) => tomada((await this.bloquearCargas(tx, [ids[0]]))[0]), TX_C1);
        } catch (e: any) {
            this.logger.error(`No se pudo mirar si la primera remesa del lote (${ids[0]}) fue tomada: ${motivoLegible(e)}`, e?.stack);
        }
        if (primeraTomada) {
            this.logger.warn(`El encolado del lote falló pero la primera remesa (${ids[0]}) ya fue tomada: el lote entró, no se compensa nada`);
            const reales = await this.cargasDeLote(ids);
            return { cargas: reales, noEncoladas: [], omitidas };
        }

        const compensadas: Array<{ remesaId: number; numeroRemesa: string }> = [];
        for (const id of [...ids].reverse()) {
            try {
                const hecha = await this.prisma.$transaction(async (tx) => {
                    const f = (await this.bloquearCargas(tx, [id]))[0];
                    if (!f) return null;
                    const sigueEnCola = f.progresoId != null && f.fase === 'EN_COLA' && f.startedAt == null && f.finishedAt == null &&
                        (f.estadoProceso === 'PENDIENTE' || f.estadoProceso === 'VALIDANDO');
                    if (!sigueEnCola) return false;
                    if (modo === 'CONFIRMAR') {
                        await tx.remesa.update({
                            where: { id },
                            data: {
                                estadoProceso: previos.get(id) ?? 'VALIDANDO',
                                progreso: {
                                    update: {
                                        fase: 'BORRADOR', encoladaAt: null, jobId: null,
                                        grupoId: null, grupoOrden: null, grupoTotal: null, rev: { increment: 1 },
                                    },
                                },
                            },
                        });
                    } else {
                        const ahora = new Date();
                        await tx.remesa.update({
                            where: { id },
                            data: {
                                estadoProceso: 'FALLIDA',
                                progreso: {
                                    update: {
                                        fase: 'TERMINADA', resultado: 'FALLIDA', finishedAt: ahora,
                                        error: textoInterrupcion('SIN_JOB', f.categoria, { conCorte: this.tieneCortePropio(f.filtroFilas), retomable: true }),
                                        rev: { increment: 1 },
                                    },
                                },
                            },
                        });
                    }
                    compensadas.push({ remesaId: id, numeroRemesa: f.numeroRemesa });
                    return true;
                }, TX_C1);
                if (hecha) this.logger.warn(`Remesa ${id}: compensada tras el encolado fallido (${modo === 'CONFIRMAR' ? 'vuelve a borrador' : 'vuelve a quedar retomable'})`);
                else if (hecha === false) this.logger.warn(`Remesa ${id}: la tomó el worker mientras se compensaba; se deja`);
            } catch (e: any) {
                this.logger.error(`No se pudo compensar la remesa ${id} tras el encolado fallido: ${motivoLegible(e)}`, e?.stack);
            }
        }

        if (compensadas.length === ids.length) {
            // Ninguna fue tomada: nada entró (o entra tarde y las encuentra en borrador, y las ignora).
            throw new ServiceUnavailableException(
                'No se pudo iniciar la importación: la cola de trabajos no responde. Probá de nuevo en unos minutos.',
            );
        }
        this.logger.error(
            `Encolado parcial: quedaron en curso las remesas ${ids.filter((i) => !compensadas.some((c) => c.remesaId === i)).join(', ')} ` +
            `y se compensaron ${compensadas.map((c) => c.remesaId).join(', ')}`,
        );
        const enCurso = ids.filter((i) => !compensadas.some((c) => c.remesaId === i));
        return { cargas: await this.cargasDeLote(enCurso), noEncoladas: compensadas.reverse(), omitidas };
    }

    private async cargasDeLote(ids: number[]): Promise<EstadoCargaDto[]> {
        const remesas = await this.prisma.remesa.findMany({
            where: { id: { in: ids } },
            orderBy: { id: 'asc' },
            include: { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } },
        });
        const posiciones = remesas.some((r) => r.progreso?.fase === 'EN_COLA') ? await this.posicionesEnCola() : null;
        return remesas.map((r) => armarEstadoCarga(r, r.progreso, new Date(), { enColaDelante: posiciones?.get(r.id) ?? null }));
    }

    // --- CANCELAR ---
    /**
     * Pide cancelar una carga (§10.5.3). Cancelar es ESCRIBIR `cancelSolicitadaAt` con la fila bloqueada: el runner lo
     * ve en sus puntos de corte y cierra la carga él mismo, con sus contadores exactos. Una carga que todavía no
     * arrancó y cuyo job se pudo sacar de la cola se cierra acá, en el acto. No revierte nada.
     */
    async cancelarCarga(remesaId: number, user: UsuarioDeCarga): Promise<{ message: string; efecto: 'CANCELADA' | 'PEDIDA'; carga: EstadoCargaDto }> {
        const t0 = Date.now();
        const r = await this.leerCargaConProgreso(remesaId);
        if (!r) {
            this.logger.warn(`Cancelar: la remesa ${remesaId} no existe`);
            throw new NotFoundException('Remesa no encontrada');
        }
        // El dueño se chequea ANTES de tocar la cola: un 403 no puede sacar el job de otro.
        this.verificarDuenoOPermiso(r.usuarioCreadorId, user, 'cancelar esta importación');
        this.logger.log(`Cancelar remesa=${remesaId} usuario=${user.sub} fase=${r.progreso?.fase ?? 'n/d'}`);

        const sinArrancar = r.progreso?.encoladaAt != null && r.progreso.startedAt == null && r.progreso.finishedAt == null;
        const sacado = sinArrancar ? await this.sacarJobDeLaCola(remesaId, r.progreso?.jobId ?? null) : false;
        const cancelacion = { usuarioId: user.sub, nombre: await this.nombreDeUsuario(user.sub) };

        let decision: { efecto: 'CANCELADA' | 'PEDIDA'; escribio: boolean };
        try {
            decision = await this.prisma.$transaction(async (tx) => {
                const f = (await this.bloquearCargas(tx, [remesaId]))[0];
                if (!f) throw new NotFoundException('Remesa no encontrada');
                // La memoria del tracker se lee con la fila YA bloqueada: la escritura de POST_PROCESO puede fallar y el
                // runner sigue igual, con la fila diciendo PROCESANDO mientras el `afterAll` corre.
                const enMemoria = this.cargasVivas.get(remesaId)?.faseActual.fase ?? null;
                if (f.progresoId == null || f.encoladaAt == null) {
                    this.logger.warn(`Cancelar rechazado: la remesa ${remesaId} no está en curso (borrador o heredada)`);
                    throw new ConflictException(MSG_CANCELAR_NO_EN_CURSO);
                }
                if (f.finishedAt != null || f.estadoProceso === 'FINALIZADA' || f.estadoProceso === 'FALLIDA') {
                    if (f.resultado === RESULTADO_CANCELADA) return { efecto: 'CANCELADA' as const, escribio: false };
                    this.logger.warn(`Cancelar rechazado: la remesa ${remesaId} ya terminó`);
                    throw new ConflictException(MSG_CANCELAR_YA_TERMINO);
                }
                if (f.startedAt == null) {
                    // Todavía no arrancó.
                    if (sacado) {
                        await this.escribirCanceladaEnCola(tx, f, cancelacion);
                        return { efecto: 'CANCELADA' as const, escribio: true };
                    }
                    // El worker la está tomando, o la cola no responde: queda el pedido, y `iniciar` lo lee con la fila bloqueada.
                    if (f.cancelSolicitadaAt != null) return { efecto: 'PEDIDA' as const, escribio: false };
                    await this.escribirPedidoDeCancelacion(tx, f, cancelacion);
                    return { efecto: 'PEDIDA' as const, escribio: true };
                }
                // Ya arrancó.
                if (f.cancelSolicitadaAt != null) return { efecto: 'PEDIDA' as const, escribio: false };
                if (f.fase === 'POST_PROCESO' || enMemoria === 'POST_PROCESO') {
                    this.logger.warn(`Cancelar rechazado: la remesa ${remesaId} está en post-proceso`);
                    throw new ConflictException(MSG_CANCELAR_POST_PROCESO);
                }
                if (f.categoria === 'ACCIONES') {
                    this.logger.warn(`Cancelar rechazado: la remesa ${remesaId} es una acción masiva que ya arrancó`);
                    throw new ConflictException(MSG_CANCELAR_ACCIONES);
                }
                await this.escribirPedidoDeCancelacion(tx, f, cancelacion);
                return { efecto: 'PEDIDA' as const, escribio: true };
            }, TX_C1);
        } catch (e: any) {
            throw this.errorDeBloqueo(e, 'Cancelar');
        }

        // Fuera de la transacción, cada paso en su `try/catch`: lo escrito ya está.
        const actual = await this.leerCargaConProgreso(remesaId);
        const enCola = actual?.progreso?.fase === 'EN_COLA' ? await this.enColaDelanteDe(remesaId, actual.progreso.encoladaAt) : null;
        const carga = actual ? armarEstadoCarga(actual, actual.progreso, new Date(), { enColaDelante: enCola }) : armarEstadoCarga(r, r.progreso);
        if (decision.escribio && decision.efecto === 'PEDIDA') {
            try {
                this.cargasVivas.get(remesaId)?.avisarCancelacion();
            } catch (e: any) {
                this.logger.warn(`No se pudo avisar la cancelación al tracker de la remesa ${remesaId}: ${e?.message}`);
            }
            try {
                this.realtimeService.emitImportProgreso(carga);
            } catch (e: any) {
                this.logger.warn(`Error emitiendo import:progreso de la remesa ${remesaId} (cancelación pedida): ${e?.message}`);
            }
        } else if (decision.escribio && decision.efecto === 'CANCELADA') {
            await this.anunciarCanceladaEnCola(carga, actual?.usuarioCreadorId ?? null, cancelacion);
        }
        this.logger.log(`Cancelar remesa=${remesaId}: efecto=${decision.efecto}${decision.escribio ? '' : ' (ya estaba)'} en ${Date.now() - t0}ms`);
        return {
            message: decision.efecto === 'CANCELADA' ? 'Importación cancelada' : 'Se pidió cancelar la importación',
            efecto: decision.efecto,
            carga,
        };
    }

    /** Cancela lo que falta de una carga dividida (§10.5.3): las que no empezaron primero, la que corre al final. */
    async cancelarGrupo(grupoId: string, user: UsuarioDeCarga) {
        const t0 = Date.now();
        const remesas = await this.prisma.remesa.findMany({
            where: { progreso: { is: { grupoId } } },
            orderBy: { progreso: { grupoOrden: 'desc' } },
            include: { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } },
        });
        if (remesas.length === 0) {
            this.logger.warn(`Cancelar grupo ${grupoId}: no existe`);
            throw new NotFoundException('La carga dividida no existe.');
        }
        for (const r of remesas) this.verificarDuenoOPermiso(r.usuarioCreadorId, user, 'cancelar esta importación');
        this.logger.log(`Cancelar grupo ${grupoId} usuario=${user.sub}: ${remesas.length} remesas`);

        const resultados: Array<{
            remesaId: number; numeroRemesa: string; efecto: 'CANCELADA' | 'PEDIDA' | 'YA_TERMINADA' | 'RECHAZADA'; motivo?: string; carga: EstadoCargaDto;
        }> = [];
        for (const r of remesas) {
            const base = { remesaId: r.id, numeroRemesa: r.numeroRemesa };
            if (r.progreso?.finishedAt != null || r.estadoProceso === 'FINALIZADA' || r.estadoProceso === 'FALLIDA') {
                resultados.push({ ...base, efecto: 'YA_TERMINADA', carga: armarEstadoCarga(r, r.progreso) });
                continue;
            }
            try {
                const res = await this.cancelarCarga(r.id, user);
                resultados.push({ ...base, efecto: res.efecto, carga: res.carga });
            } catch (e: any) {
                // Terminó mientras se recorría el grupo: no es un rechazo, ya está terminada.
                if (e instanceof ConflictException && e.message === MSG_CANCELAR_YA_TERMINO) {
                    const actual = await this.leerCargaConProgreso(r.id);
                    resultados.push({ ...base, efecto: 'YA_TERMINADA', carga: actual ? armarEstadoCarga(actual, actual.progreso) : armarEstadoCarga(r, r.progreso) });
                    continue;
                }
                // Un 409 de una (por ejemplo la que está en post-proceso) no frena a las demás.
                if (!(e instanceof HttpException)) this.logger.error(`Cancelar grupo ${grupoId}: falló la remesa ${r.id}: ${e?.message}`, e?.stack);
                resultados.push({
                    ...base,
                    efecto: 'RECHAZADA',
                    motivo: e instanceof HttpException ? e.message : 'No se pudo cancelar por un error del servidor.',
                    carga: armarEstadoCarga(r, r.progreso),
                });
            }
        }
        this.logger.log(`Cancelar grupo ${grupoId}: ${resultados.map((x) => `${x.remesaId}=${x.efecto}`).join(', ')} en ${Date.now() - t0}ms`);
        return { resultados: resultados.reverse() };
    }

    /** Escribe solo el pedido (carga que ya arrancó, o que el worker está tomando). Con la fila bloqueada. */
    private async escribirPedidoDeCancelacion(
        tx: Prisma.TransactionClient,
        f: FilaBloqueada,
        cancelacion: { usuarioId: number; nombre: string },
    ): Promise<void> {
        const resumen = { v: 1, ...(leerResumen(f.resumen) ?? {}), cancelacion } as Prisma.InputJsonObject;
        await tx.import_progreso.update({
            where: { remesaId: f.id },
            data: { cancelSolicitadaAt: new Date(), resumen, rev: { increment: 1 } },
        });
    }

    /** Cierra como CANCELADA una carga en cola que no arrancó. Con la fila bloqueada; `startedAt` queda null. */
    private async escribirCanceladaEnCola(
        tx: Prisma.TransactionClient,
        f: FilaBloqueada,
        cancelacion: { usuarioId: number; nombre: string } | null,
    ): Promise<void> {
        const ahora = new Date();
        const previo = leerResumen(f.resumen) ?? {};
        // Si ya había un pedido (de otra persona), el nombre es el del que lo hizo primero.
        const quien = previo.cancelacion ?? cancelacion ?? undefined;
        const resumen = { v: 1, ...previo, ...(quien ? { cancelacion: quien } : {}) } as Prisma.InputJsonObject;
        const texto = textoCancelacion({
            ok: 0, err: 0, total: f.totalFilas, categoria: f.categoria, conCorte: this.tieneCortePropio(f.filtroFilas),
            por: quien?.nombre ?? null, arranco: false, sinFilasEntregadas: true,
        });
        await tx.remesa.update({
            where: { id: f.id },
            data: {
                estadoProceso: 'FALLIDA',
                okFilas: 0,
                errFilas: 0,
                progreso: {
                    update: {
                        fase: 'TERMINADA',
                        subfase: null,
                        resultado: RESULTADO_CANCELADA,
                        error: texto,
                        cancelSolicitadaAt: f.cancelSolicitadaAt ?? ahora,
                        finishedAt: ahora,
                        resumen,
                        rev: { increment: 1 },
                    },
                },
            },
        });
    }

    /**
     * El worker tomó el job de una carga con la cancelación ya pedida (la compuerta de `iniciar` no escribió nada): la
     * cierra como cancelada sin que haya arrancado. Devuelve `null` si la carga ya no está en cola.
     */
    private async cerrarCanceladaSinArrancar(remesaId: number): Promise<EstadoCargaDto | null> {
        let cancelacion: { usuarioId: number; nombre: string } | null = null;
        let cerro = false;
        try {
            cerro = await this.prisma.$transaction(async (tx) => {
                const f = (await this.bloquearCargas(tx, [remesaId]))[0];
                if (!f || f.progresoId == null || f.encoladaAt == null) return false;
                if (f.finishedAt != null || f.estadoProceso === 'FINALIZADA' || f.estadoProceso === 'FALLIDA' || f.startedAt != null) return false;
                cancelacion = leerResumen(f.resumen)?.cancelacion ?? null;
                await this.escribirCanceladaEnCola(tx, f, cancelacion);
                return true;
            }, TX_C1);
        } catch (e: any) {
            // El reaper la cierra a los ~3 minutos como "no llegó a empezar" (retomable): no queda nada a medias sin dueño.
            this.logger.error(`No se pudo cerrar como cancelada la remesa ${remesaId}, que no arrancó: ${motivoLegible(e)}`, e?.stack);
            return null;
        }
        if (!cerro) return null;
        const r = await this.leerCargaConProgreso(remesaId);
        if (!r) return null;
        const carga = armarEstadoCarga(r, r.progreso);
        await this.anunciarCanceladaEnCola(carga, r.usuarioCreadorId, cancelacion);
        return carga;
    }

    /** Lo que sigue al cierre de una carga cancelada sin arrancar: evento, notificación (solo al dueño, y solo si la pidió otro) y auditoría. */
    private async anunciarCanceladaEnCola(
        carga: EstadoCargaDto,
        duenoId: number | null,
        cancelacion: { usuarioId: number; nombre: string } | null,
    ): Promise<void> {
        try {
            this.realtimeService.emitImportFinalizada(carga);
        } catch (e: any) {
            this.logger.warn(`Error emitiendo import:finalizada de la remesa ${carga.remesaId} (cancelada en cola): ${e?.message}`);
        }
        // No procesó nada y quien cancela ya lo sabe: avisar a todos los que ven importaciones de otros sería ruido.
        if (cancelacion?.usuarioId !== duenoId) await this.notificarResultadoCarga(carga, duenoId, false, true);
        await this.auditarCancelacion(carga, cancelacion?.usuarioId ?? duenoId, cancelacion?.nombre ?? null);
        this.logger.warn(`Remesa ${carga.remesaId} cancelada antes de empezar${cancelacion ? ` por ${cancelacion.usuarioId}` : ''}`);
    }

    private async auditarCancelacion(carga: EstadoCargaDto, usuarioId: number | null, canceladaPor: string | null): Promise<void> {
        try {
            await this.auditoria.log({
                modulo: AuditModulo.IMPORT,
                entidad: 'Remesa',
                tipo: AuditTipo.IMPORT_FAIL,
                severidad: AuditSeveridad.WARN,
                estado: AuditEstado.FALLIDO,
                usuarioId,
                entidadId: carga.remesaId,
                resumen: `Importación cancelada remesa ${carga.numeroRemesa}`,
                data: { contexto: { canceladaPor, ok: carga.ok, err: carga.err, procesadas: carga.procesadas } },
            });
        } catch (e: any) {
            this.logger.warn(`No se pudo auditar la cancelación de la remesa ${carga.remesaId}: ${e?.message}`);
        }
    }

    /** El runner vivo cierra una carga cancelada (§10.5.3): contadores exactos, sin cierre de carga. No es una falla: no relanza. */
    private async cerrarCargaCancelada(
        tracker: ProgresoTracker,
        remesa: { categoria: string | null; filtroFilas: unknown },
        c: { ok: number; err: number; descartadas: number; fueraDeCorte: number | null },
        x: { total: number; filasEntregadas: boolean; ownerId: number | null; t0: number; remesaId: number; donde?: string },
    ): Promise<{ total: number; ok: number; err: number; cancelada?: true; ignorado?: true }> {
        const sinFilasEntregadas = !x.filasEntregadas;
        let por = tracker.canceladaPor;
        if (!por) {
            // Mejor esfuerzo: solo para el texto. Nada se decide con esta lectura.
            try {
                const fila = await this.prisma.import_progreso.findUnique({ where: { remesaId: x.remesaId }, select: { resumen: true } });
                por = leerResumen(fila?.resumen)?.cancelacion?.nombre ?? null;
            } catch {
                por = null;
            }
        }
        const texto = textoCancelacion({
            ok: c.ok, err: c.err, total: tracker.estado.totalEsperado, categoria: remesa.categoria,
            conCorte: this.tieneCortePropio(remesa.filtroFilas), por, arranco: true, sinFilasEntregadas,
        });
        const estado = await tracker.cancelar(c, { texto, sinFilasEntregadas });
        if (tracker.cerradaPorFuera) {
            this.logger.warn(`La remesa ${x.remesaId} fue cerrada por fuera mientras se cancelaba: no se notifica (ok=${c.ok} err=${c.err})`);
            return { total: x.total, ok: c.ok, err: c.err, ignorado: true };
        }
        await this.notificarResultadoCarga(estado, x.ownerId, tracker.noSePudoRegistrar);
        await this.auditarCancelacion(estado, x.ownerId, por);
        this.logger.warn(
            `Remesa ${x.remesaId} cancelada${por ? ` por ${por}` : ''} con ok=${c.ok} err=${c.err} ` +
            `(cortó ${x.donde ?? 'en una compuerta'}; el cierre de la carga no corrió) en ${Date.now() - x.t0}ms`,
        );
        return { total: x.total, ok: c.ok, err: c.err, cancelada: true };
    }

    // --- RETOMAR ---
    /**
     * Vuelve a encolar LA MISMA remesa —mismo id, mismo archivo, mismas remesas de origen— con el progreso en cero
     * (§10.5.4). Solo cuando está demostrado que no cargó ninguna fila: el marcador lo escribe el runner vivo, y acá
     * además se cuentan los casos y las claves de la base. Sin ninguna de las dos, no hay nada escrito que duplicar.
     */
    async retomarRemesas(
        sel: { remesaIds: number[] } | { grupoId: string },
        user: UsuarioDeCarga,
    ): Promise<{
        cargas: EstadoCargaDto[];
        omitidas: Array<{ remesaId: number; numeroRemesa: string; motivo: string }>;
        noEncoladas: Array<{ remesaId: number; numeroRemesa: string }>;
    }> {
        const t0 = Date.now();
        const esGrupo = 'grupoId' in sel;
        const remesas = await this.prisma.remesa.findMany({
            where: esGrupo ? { progreso: { is: { grupoId: sel.grupoId } } } : { id: { in: sel.remesaIds } },
            orderBy: { id: 'asc' },
            include: { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } },
        });
        if (remesas.length === 0 || (!esGrupo && remesas.length !== new Set(sel.remesaIds).size)) {
            this.logger.warn(`Retomar: no existe ${esGrupo ? `el grupo ${sel.grupoId}` : `alguna de las remesas ${sel.remesaIds.join(', ')}`}`);
            throw new NotFoundException(esGrupo ? 'La carga dividida no existe.' : 'Remesa no encontrada');
        }
        for (const r of remesas) this.verificarDuenoOPermiso(r.usuarioCreadorId, user, 'retomar esta importación');
        this.logger.log(`Retomar ${esGrupo ? `grupo ${sel.grupoId}` : `remesa ${sel.remesaIds.join(', ')}`} usuario=${user.sub}`);

        const omitidas: Array<{ remesaId: number; numeroRemesa: string; motivo: string }> = [];
        const candidatas: number[] = [];
        for (const r of remesas) {
            // Los archivos se comprueban ANTES de la transacción, y solo su existencia.
            const retomableSegunDto = armarEstadoCarga(r, r.progreso).retomable;
            let problema: HttpException | null = null;
            if (!retomableSegunDto) problema = this.excepcionNoRetomable(r.progreso, r.estadoProceso);
            else {
                try {
                    this.comprobarArchivosDeRemesa(r);
                } catch (e: any) {
                    problema = e instanceof HttpException ? e : new BadRequestException(e?.message);
                }
            }
            if (!problema) {
                candidatas.push(r.id);
                continue;
            }
            if (!esGrupo) throw problema;
            // Las que terminaron bien o siguen en curso no son "omitidas": no hay nada que retomar y la pantalla no tiene por qué listarlas.
            if (r.estadoProceso !== 'FALLIDA' || r.progreso?.finishedAt == null) continue;
            omitidas.push({ remesaId: r.id, numeroRemesa: r.numeroRemesa, motivo: problema.message });
        }
        if (candidatas.length === 0) {
            this.logger.warn(`Retomar: ninguna de las remesas se puede retomar (${omitidas.map((o) => o.remesaId).join(', ')})`);
            throw new ConflictException('Ninguna de las importaciones se puede retomar: ya procesaron filas o no terminaron.');
        }

        const r = await this.encolarLote({
            remesaIds: candidatas,
            modo: 'RETOMAR',
            solicitanteId: user.sub,
            tolerante: esGrupo,
        });
        this.logger.log(
            `Retomar listo: ${r.cargas.length} encolada(s), ${omitidas.length + r.omitidas.length} omitida(s), ` +
            `${r.noEncoladas.length} sin encolar, por usuario ${user.sub} en ${Date.now() - t0}ms`,
        );
        return { cargas: r.cargas, omitidas: [...omitidas, ...r.omitidas], noEncoladas: r.noEncoladas };
    }

    /** Comprueba que los archivos de la remesa siguen en el disco (solo existencia). Tira el 400 que ya dan los helpers. */
    private comprobarArchivosDeRemesa(remesa: { categoria: string | null; archivo: string | null; archivos: unknown }): void {
        if (remesa.categoria === 'MULTIARCHIVO') this.leerPaqueteMultiarchivo(remesa, true);
        else this.archivosDeRemesa(remesa);
    }

    private excepcionNoRetomable(
        progreso: { finishedAt?: Date | null; startedAt?: Date | null; resumen?: unknown } | null,
        estadoProceso: string,
    ): ConflictException {
        if (!progreso?.finishedAt || estadoProceso !== 'FALLIDA') return new ConflictException(MSG_RETOMAR_NO_TERMINO);
        const resumen = leerResumen(progreso.resumen);
        if (resumen?.v !== 1 || !resumen.origen) return new ConflictException(MSG_RETOMAR_ANTERIOR);
        return new ConflictException(MSG_RETOMAR_PROCESO_FILAS);
    }

    /** Las validaciones de RETOMAR contra la fila bloqueada y los datos (§10.5.4). Null = se puede. */
    private async motivoNoRetomable(
        tx: Prisma.TransactionClient,
        f: FilaBloqueada,
    ): Promise<{ texto: string; excepcion: HttpException } | null> {
        const rechazo = (e: HttpException) => ({ texto: e.message, excepcion: e });
        if (f.estadoProceso !== 'FALLIDA' || f.progresoId == null || f.finishedAt == null) {
            this.logger.warn(`Retomar rechazado: la remesa ${f.id} no terminó o terminó bien (estado=${f.estadoProceso})`);
            return rechazo(new ConflictException(MSG_RETOMAR_NO_TERMINO));
        }
        const resumen = leerResumen(f.resumen);
        if (resumen?.v !== 1 || !resumen.origen) {
            this.logger.warn(`Retomar rechazado: la remesa ${f.id} es anterior a la función de retomar`);
            return rechazo(new ConflictException(MSG_RETOMAR_ANTERIOR));
        }
        if (f.startedAt != null && resumen.sinFilasEntregadas !== true) {
            this.logger.warn(`Retomar rechazado: la remesa ${f.id} ya procesó filas`);
            return rechazo(new ConflictException(MSG_RETOMAR_PROCESO_FILAS));
        }
        // Independiente del marcador: contra los datos.
        const [casos, claves] = await Promise.all([
            tx.deudor.count({ where: { remesaId: f.id } }),
            tx.clave_pago.count({ where: { remesaId: f.id } }),
        ]);
        if (casos > 0 || claves > 0) {
            this.logger.error(
                `Retomar rechazado: la remesa ${f.id} figura sin filas entregadas pero tiene ${casos} caso(s) y ${claves} clave(s) ` +
                'cargados: el marcador y los datos se contradicen',
            );
            return rechazo(new ConflictException(MSG_RETOMAR_PROCESO_FILAS));
        }
        // Su corte ya se cargó en otra remesa (se canceló en cola, se volvió a subir el archivo y se cargó en una nueva).
        const choques = await this.remesasQueChocanConElCorte(tx, f);
        if (choques.length > 0) {
            this.logger.warn(`Retomar rechazado: el corte de la remesa ${f.id} ya figura en ${choques.join(', ')}`);
            return rechazo(new ConflictException(
                `El corte de esta remesa ya figura en la remesa ${choques.join(', ')}: no se puede retomar. ` +
                'Si esta ya no hace falta, eliminala desde el Historial.',
            ));
        }
        return null;
    }

    /** Traducción de un error de bloqueo (deadlock, P2034) a un 409; todo lo demás sale como vino. */
    private errorDeBloqueo(e: any, que: string): unknown {
        const deadlock = e?.code === 'P2034' || (e?.code === 'P2010' && /1213|deadlock/i.test(String(e?.message ?? '')));
        if (!deadlock) return e;
        this.logger.warn(`${que}: deadlock o conflicto de escritura (${motivoLegible(e)})`);
        return new ConflictException('Otra operación está tocando estas remesas. Probá de nuevo.');
    }

    // --- EN CURSO ---
    /** Cargas encoladas y sin terminar (§8.3: `encoladaAt != null && finishedAt == null`). Una remesa
     *  heredada, sin fila de progreso, nunca figura acá. */
    async listarEnCurso(user: { sub: number; permisos: string[] }): Promise<EstadoCargaDto[]> {
        const enCurso = { progreso: { is: { encoladaAt: { not: null }, finishedAt: null } } };
        const where: Prisma.remesaWhereInput = user.permisos.includes('importacion.ver_progreso_otros')
            ? enCurso
            : { ...enCurso, usuarioCreadorId: user.sub };

        const remesas = await this.prisma.remesa.findMany({
            where,
            orderBy: { progreso: { encoladaAt: 'asc' } },
            include: {
                progreso: true,
                usuarioCreador: { select: { id: true, nombre: true } },
            },
        });

        // La posición cuenta las cargas de TODOS los usuarios, aunque el listado no las traiga.
        const posiciones = remesas.some((r) => r.progreso?.fase === 'EN_COLA') ? await this.posicionesEnCola() : null;
        return remesas.map((r) =>
            armarEstadoCarga(r, r.progreso, new Date(), {
                enColaDelante: posiciones?.get(r.id) ?? null,
            }),
        );
    }

    /**
     * Cuántas cargas en curso se confirmaron antes que esta, contando la que está corriendo (§9.5.9).
     * Mejor esfuerzo: si la consulta falla es `null` y nunca hace fallar un encolado ni una lectura. Es
     * aproximada: el orden de `encoladaAt` no es exactamente el de la cola.
     */
    private async enColaDelanteDe(remesaId: number, encoladaAt: Date | null): Promise<number | null> {
        if (!encoladaAt) return null;
        try {
            const filas = await this.prisma.$queryRaw<Array<{ n: bigint | number }>>`
                SELECT COUNT(*) AS n FROM import_progreso
                WHERE finishedAt IS NULL AND encoladaAt IS NOT NULL
                  AND (encoladaAt < ${encoladaAt} OR (encoladaAt = ${encoladaAt} AND remesaId < ${remesaId}))
            `;
            const n = Number(filas?.[0]?.n);
            return Number.isFinite(n) ? n : null;
        } catch (e: any) {
            this.logger.warn(`No se pudo calcular la posición en la cola de la remesa ${remesaId}: ${e?.message}`);
            return null;
        }
    }

    /** Posición en la cola de todas las cargas en curso, en una sola consulta. `null` si falla. */
    private async posicionesEnCola(): Promise<Map<number, number> | null> {
        try {
            const todas = await this.prisma.import_progreso.findMany({
                where: { encoladaAt: { not: null }, finishedAt: null },
                select: { remesaId: true },
                orderBy: [{ encoladaAt: 'asc' }, { remesaId: 'asc' }],
            });
            return new Map(todas.map((p, i) => [p.remesaId, i]));
        } catch (e: any) {
            this.logger.warn(`No se pudo calcular la posición en la cola de las cargas en curso: ${e?.message}`);
            return null;
        }
    }

    /** Lectura de la carga después de un `add` fallido que no se pudo compensar. `'BORRADA'` si ya no existe. */
    private async leerCargaTrasEncolarFallido(remesaId: number) {
        try {
            const r = await this.prisma.remesa.findUnique({
                where: { id: remesaId },
                include: { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } },
            });
            if (!r) return 'BORRADA' as const;
            const tomada =
                r.estadoProceso === 'PROCESANDO' || r.estadoProceso === 'FINALIZADA' || r.estadoProceso === 'FALLIDA' ||
                r.progreso?.startedAt != null;
            return tomada ? r : null;
        } catch (e: any) {
            this.logger.warn(`No se pudo releer la remesa ${remesaId} tras el error de encolado: ${e?.message}`);
            return null;
        }
    }

    /** Estado liviano de una carga (una lectura por PK): lo que consultan los hooks al hacer polling. */
    async progreso(remesaId: number): Promise<EstadoCargaDto> {
        const r = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: {
                progreso: true,
                usuarioCreador: { select: { id: true, nombre: true } },
            },
        });
        if (!r) {
            this.logger.warn(`Progreso: la remesa ${remesaId} no existe`);
            throw new NotFoundException('Remesa no encontrada');
        }
        const enColaDelante = r.progreso?.fase === 'EN_COLA' ? await this.enColaDelanteDe(remesaId, r.progreso.encoladaAt) : null;
        return armarEstadoCarga(r, r.progreso, new Date(), { enColaDelante });
    }

    // --- WORKER DE IMPORTACIÓN LÓGICA PESADA ---
    async processImportJob(
        job: Job,
        remesaId: number,
        remesaOrigenId?: number,
        remesaOrigenIds?: number[],
    ): Promise<{ total: number; ok: number; err: number; ignorado?: true; cancelada?: true }> {
        const usuarioId: number | undefined = job.data?.usuarioId;
        const t0 = Date.now();

        let remesa;
        try {
            remesa = await this.prisma.remesa.findUnique({
                where: { id: remesaId },
                include: {
                    plantilla: true,
                    usuarioCreador: { select: { id: true, nombre: true } },
                    progreso: true,
                },
            });
        } catch (e: any) {
            // Sin tracker todavía: se compensa en lo posible para no dejar la carga EN_COLA (y al
            // usuario bloqueado) por una lectura que falló.
            this.logger.error(`No se pudo leer la remesa ${remesaId} para importarla: ${e?.message}`, e?.stack);
            await this.marcarFallidaSinTracker(remesaId, e);
            throw e;
        }

        if (!remesa) {
            throw new NotFoundException('Remesa/archivo/plantilla no existe');
        }

        // De un estado terminal no se sale: si BullMQ re-ejecuta un job (p. ej. lo da por stalled
        // estando vivo) sobre una carga que ya terminó, no se la reprocesa ni se la vuelve a PROCESANDO.
        // Escrita en negativo: las fixtures de los specs viejos no traen `estadoProceso` ni fila.
        if (
            (remesa.estadoProceso === 'FINALIZADA' || remesa.estadoProceso === 'FALLIDA') &&
            remesa.progreso?.finishedAt
        ) {
            this.logger.warn(
                `Job ignorado: la remesa ${remesaId} ya terminó (${remesa.estadoProceso}); no se reprocesa.`,
            );
            return { total: remesa.progreso.procesadas, ok: remesa.progreso.ok, err: remesa.progreso.err, ignorado: true };
        }

        // Un job "fantasma": `queue.add` tiró pero el job igual entró y la remesa volvió a borrador (se le
        // dijo 503 al usuario). Con fila de progreso y sin `encoladaAt` no hay camino legítimo para correr.
        // En negativo: un borrador anterior al deploy no tiene fila, así que no lo alcanza.
        if (remesa.progreso && !remesa.progreso.encoladaAt) {
            this.logger.warn(`Job ignorado: la remesa ${remesaId} no está encolada (es un borrador); no se procesa.`);
            return { total: 0, ok: 0, err: 0, ignorado: true };
        }

        // Una carga NO se re-ejecuta (§9.3 y §9.5.1): si BullMQ vuelve a entregar el job de una carga que
        // ya había arrancado (y no terminó), el worker que la tomaba murió. Se cierra como interrumpida,
        // sin tocar una fila. Escrita en negativo: una fila sin `startedAt` (fixtures viejas) no la dispara.
        if (remesa.progreso?.startedAt && !remesa.progreso.finishedAt) {
            if (this.cargasVivas.has(remesaId)) {
                this.logger.warn(`Job ignorado: la remesa ${remesaId} ya la está procesando este proceso; no se vuelve a entregar.`);
                return { total: 0, ok: 0, err: 0, ignorado: true };
            }
            this.logger.warn(
                `Job ${job.id} re-entregado para la remesa ${remesaId}, que ya había arrancado: se cierra como interrumpida, no se re-ejecuta`,
            );
            await this.cerrarCargaInterrumpida(remesaId, 'REENTREGA', { jobId: job.id });
            return { total: 0, ok: 0, err: 0, ignorado: true };
        }

        // La fila manda (hallazgo 1 de la auditoría): un job que entra tarde —el confirmar dio 503, la remesa volvió a borrador y
        // se confirmó de nuevo con otra remesa de origen— corría con el origen del primer intento. Si la fila guarda el origen con
        // el que se confirmó, es ese; `job.data` queda solo para una carga anterior a C1, que no lo tiene.
        const origenDeLaFila = leerResumen(remesa.progreso?.resumen)?.origen;
        if (origenDeLaFila && typeof origenDeLaFila === 'object') {
            const idFila = origenDeLaFila.remesaOrigenId ?? undefined;
            const idsFila = origenDeLaFila.remesaOrigenIds?.length ? origenDeLaFila.remesaOrigenIds : undefined;
            const difiere =
                (remesaOrigenId ?? undefined) !== idFila ||
                JSON.stringify(remesaOrigenIds?.length ? remesaOrigenIds : undefined) !== JSON.stringify(idsFila);
            if (difiere) {
                this.logger.warn(
                    `Remesa ${remesaId}: el job trae otra remesa de origen (${remesaOrigenId ?? '-'}/${JSON.stringify(remesaOrigenIds ?? null)}) ` +
                    `que la fila (${idFila ?? '-'}/${JSON.stringify(idsFila ?? null)}): se usa la de la fila`,
                );
            }
            remesaOrigenId = idFila;
            remesaOrigenIds = idsFila;
        }

        const usuarioNombre = remesa.usuarioCreador?.nombre ?? 'Sistema';
        const ownerId = remesa.usuarioCreadorId ?? usuarioId;

        // Único escritor del estado de la carga durante el job (docs/imports-progreso-realtime-spec.md §8.5).
        const tracker = new ProgresoTracker(
            { prisma: this.prisma, realtime: this.realtimeService, logger: this.logger },
            {
                remesaId,
                numeroRemesa: remesa.numeroRemesa,
                nombre: remesa.nombre,
                empresaId: remesa.empresaId,
                tipo: (remesa.categoria as string | null) ?? '',
                usuarioId: ownerId ?? null,
                usuarioNombre,
                totalFilasVistaPrevia: remesa.totalFilas ?? 0,
            },
            remesa.progreso ?? null,
        );
        this.cargasVivas.set(remesaId, tracker);

        let ok = 0;
        let err = 0;
        let total = 0;
        let descartadas = 0;
        // De las descartadas, las que eran de otro corte de la división. null = la remesa no tiene corte propio.
        let fueraDeCorte: number | null = null;
        // Filas de aviso (rowNumber 0) que este runner ya contó en el tracker; el resto, escrito por los
        // processors, se suma recién después del post-proceso.
        let avisosEscritos = 0;
        // Marcador de §10.5.4: se prende JUSTO ANTES de la primera llamada a un processor (`processRow` o
        // `processBatch`). Mientras sea `false` no se escribió nada que un reintento pueda duplicar.
        let filasEntregadas = false;

        try {
        // Va ANTES de cualquier validación: todo job emite `iniciada` y después `finalizada`, y
        // `fallar` siempre tiene una fila donde dejar el motivo.
        try {
            await tracker.iniciar(job.id);
        } catch (e) {
            if (e instanceof CargaCerradaPorFueraError) {
                this.logger.warn(
                    `Job ignorado: la remesa ${remesaId} ya no está en cola (se borró, terminó o volvió a borrador); no se procesa.`,
                );
                return { total: 0, ok: 0, err: 0, ignorado: true };
            }
            if (e instanceof CargaCanceladaError) {
                // Alguien pidió cancelar antes de que el worker la tomara: la compuerta de `iniciar` no escribió nada.
                this.logger.warn(`La remesa ${remesaId} tenía la cancelación pedida cuando el worker tomó el job: no arranca`);
                await this.cerrarCanceladaSinArrancar(remesaId);
                return { total: 0, ok: 0, err: 0, ignorado: true };
            }
            throw e;
        }

        // Si el borrado confirmó mientras `iniciar` esperaba el lock, el `update` no avisa que afectó 0
        // filas: se confirma con una lectura nueva antes de procesar nada (un lote en PAGOS, ACTUALIZACIONES,
        // CONTACTOS o ENRIQUECIMIENTO se aplicaría sin dejar remesa). `iniciada` ya salió; no se emite más.
        const sigueExistiendo = await this.prisma.remesa.findUnique({ where: { id: remesaId }, select: { id: true } });
        if (!sigueExistiendo) {
            this.logger.warn(`Job ignorado: la remesa ${remesaId} se borró mientras el worker tomaba el job; no se procesa.`);
            return { total: 0, ok: 0, err: 0, ignorado: true };
        }

        if (!remesa.archivo || !remesa.plantilla) {
            throw new NotFoundException('Remesa/archivo/plantilla no existe');
        }

        if (!remesa.categoria) {
            throw new Error('La remesa no tiene categoría definida');
        }

        // Obtener procesador para la categoría (una instancia nueva por carga)
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
        // Canal de reporte de los processors (§9.4.4): sincrónico, sin IO y que nunca tira. Un reporte roto
        // es un `warn` (uno por carga) y no cambia lo que hace el processor.
        let reporteAvisado = false;
        const reportar = (que: string, fn: () => void): void => {
            try {
                fn();
            } catch (e: any) {
                if (!reporteAvisado) {
                    reporteAvisado = true;
                    this.logger.warn(`Reporte de progreso (${que}) de la remesa ${remesaId} falló: ${e?.message}`);
                }
            }
        };
        ctx.progreso = {
            filasDelLote: (n) => reportar('filasDelLote', () => tracker.avanceDelLote(n)),
            subfase: (nombre, hecho, totalPaso) => reportar('subfase', () => tracker.subfase(nombre, hecho, totalPaso)),
            contadores: (c) => reportar('contadores', () => tracker.contadores(c)),
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

        // Limpiar errores previos de esta remesa
        await this.prisma.importerror.deleteMany({
            where: { remesaId }
        });

        const tFilas = Date.now();

        const processBatch = async () => {
            // Otro cerró la carga (reaper de otro proceso): se corta por lote.
            if (tracker.cerradaPorFuera) throw new CargaCerradaPorFueraError(remesaId);
            // Punto de corte de LOTE (§10.5.3): una bandera en memoria, sin IO. Los contadores los escribe `cancelar`.
            if (tracker.cancelacionPedida) throw new CargaCanceladaError('lote');
            const group = batch.splice(0, batch.length);
            let cortar = false;
            const errorBatch: Array<{ remesaId: number; rowNumber: number; rawRow: any; errorMsg: string }> = [];

            // Filas que pasaron mapeo + validación, para el camino por lote.
            const validas: Array<{ row: any; idx: number; mapped: any; origen?: string | null }> = [];

            for (const { row, idx, origen } of group) {
                // Punto de corte de FILA: solo donde cada `processRow` es una unidad cerrada y el contador queda exacto.
                if (!processor.processBatch && tracker.cancelacionPedida) {
                    cortar = true;
                    break;
                }
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

                    filasEntregadas = true;
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
                } finally {
                    // Solo memoria: lo vuelca el reloj del tracker. Un reporte por fila, sin `await`.
                    tracker.avance({ ok, err, descartadas, fueraDeCorte });
                }
            }

            if (processor.processBatch && validas.length > 0) {
                const porIdx = new Map(validas.map((v) => [v.idx, v]));
                let fallos: Array<{ idx: number; error: string }> = [];
                filasEntregadas = true;
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

            // Se cortó entre filas: los errores de las ya procesadas quedaron guardados y `cancelar` escribe los contadores.
            if (cortar) throw new CargaCanceladaError('fila');

            // Persiste el lote (sin tocar `remesa.totalFilas`: es el de la vista previa) y emite.
            await tracker.lote({ ok, err, descartadas, fueraDeCorte });

            await job.updateProgress({ total, ok, err });
        };

        if (esMultirregistro) {
            // ── Archivo con varios tipos de línea (Toyota cuenta 87) ────────────────────
            const cfgMulti = mapping?.multirregistro;
            if (!cfgMulti) {
                throw new Error(
                    'La plantilla es de categoría MULTIRREGISTRO pero no tiene `mappingJson.multirregistro` configurado.',
                );
            }

            await tracker.entrarEnLectura();
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

            // El parseo bloqueó el event loop: antes de tocar nada más (sin dejar nada "sucio" que el reloj emita durante la espera)
            // se cede y se relee el pedido de cancelación. Si hay, corta con 0 filas.
            await this.cederYReleerCancelacion(tracker, remesaId);

            // Las advertencias del parseo (clientes sin ficha, avisos repetidos) se registran como
            // errores de la remesa para que queden visibles en el detalle del import.
            if (advertencias.length > 0) {
                avisosEscritos += await this.registrarAdvertenciasDeParseo(remesaId, advertencias);
            }

            tracker.fijarTotalEsperado(filas.length);
            tracker.sumarAdvertencias(advertencias.length);

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

            await tracker.entrarEnLectura();
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

            // El parseo bloqueó el event loop: antes de tocar nada más (sin dejar nada "sucio" que el reloj emita durante la espera)
            // se cede y se relee el pedido de cancelación. Si hay, corta con 0 filas.
            await this.cederYReleerCancelacion(tracker, remesaId);

            // Las advertencias del cruce (cuotas huérfanas, casos sin detalle, codeudores sin
            // titular) se registran como errores de la remesa para que queden visibles en el
            // detalle del import: son el dato que el operador necesita para reclamarle al cedente.
            if (advertencias.length > 0) {
                avisosEscritos += await this.registrarAdvertenciasDeParseo(remesaId, advertencias);
            }

            tracker.fijarTotalEsperado(filas.length);
            tracker.sumarAdvertencias(advertencias.length);

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

            await tracker.entrarEnLectura();
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

            // El parseo bloqueó el event loop: antes de tocar nada más (sin dejar nada "sucio" que el reloj emita durante la espera)
            // se cede y se relee el pedido de cancelación. Si hay, corta con 0 filas.
            await this.cederYReleerCancelacion(tracker, remesaId);

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
                avisosEscritos += avisos.length;
            }

            tracker.fijarTotalEsperado(tramitesMulticlaves.length);
            tracker.sumarAdvertencias(avisos.length);

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
            // El filtro de la plantilla y el del corte de la remesa se evalúan por separado y en ese orden
            // (§9.5.3): una fila que la plantilla descarta lo es en cualquier remesa de la división, aunque
            // tampoco sea de este corte; `fueraDeCorte` cuenta solo las que la plantilla dejaba pasar.
            const { dePlantilla, deCorte } = this.filtrosSeparados(remesa, mapping);
            const filtros = [...dePlantilla, ...deCorte];
            fueraDeCorte = deCorte.length > 0 ? 0 : null;

            // Un Excel se lee entero y de golpe (`xlsx.readFile` es síncrono): se avisa antes.
            const leeExcel = paths.some(esExcel);
            if (leeExcel) await tracker.entrarEnLectura();
            // La lectura del Excel es síncrona y bloquea: antes de la primera fila se cede el event loop (ver la constante).
            let pausaPendiente = leeExcel;

            // Las filas que el filtro descarta no son errores: no se procesan, no van a
            // `importerror` y no cuentan en el total. Son las de la plantilla más el corte
            // propio de la remesa cuando la carga se dividió por nómina/gestión.
            const alFila = ({ valores, origen }: { valores: any; origen?: string | null }) => {
                if (!pasaFiltro(valores, dePlantilla)) {
                    descartadas++;
                    tracker.avance({ ok, err, descartadas, fueraDeCorte });
                    return;
                }
                if (!pasaFiltro(valores, deCorte)) {
                    descartadas++;
                    fueraDeCorte = (fueraDeCorte ?? 0) + 1;
                    tracker.avance({ ok, err, descartadas, fueraDeCorte });
                    return;
                }
                batch.push({ row: valores, idx: total++, origen });
                // Devolver la promesa hace que el recorrido se pause hasta que el lote termine.
                if (batch.length >= BATCH_SIZE) return processBatch();
            };

            await recorrerFilas(
                {
                    paths,
                    nombres,
                    tieneHeader: hasHeader,
                    separador: sep,
                    anchoFijo: this.layoutAnchoFijo(mapping),
                    hoja: remesa.hoja ?? undefined,
                },
                (fila) => {
                    if (pausaPendiente) {
                        pausaPendiente = false;
                        return this.cederYReleerCancelacion(tracker, remesaId).then(() => alFila(fila));
                    }
                    return alFila(fila);
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

        {
            const msFilas = Date.now() - tFilas;
            const procesadasFilas = ok + err;
            this.logger.log(
                `Filas remesa=${remesaId}: ${procesadasFilas} procesadas en ${msFilas}ms ` +
                `(${msFilas > 0 ? Math.round((procesadasFilas * 10000) / msFilas) / 10 : procesadasFilas} filas/s)`,
            );
        }

        // Punto de corte previo al cierre (§10.5.3): un pedido que llegó durante el último lote corta ACÁ, tenga o no
        // `afterAll` el processor. En ACTUALIZACIONES el cierre da por pagados o desasigna a los ausentes del archivo.
        if (tracker.cancelacionPedida) throw new CargaCanceladaError('antes del cierre');

        // Hook post-batch: lógica que corre después de todas las filas. Si tira, las filas ya están
        // cargadas: la carga NO pasa a FALLIDA, pero el motivo queda escrito y visible (#3).
        let errorPostProceso: string | null = null;
        if (processor.afterAll) {
            // Una etiqueta de fase no puede impedir la consolidación: si no se puede escribir, se sigue.
            try {
                await tracker.entrarEnPostProceso();
            } catch (faseErr: any) {
                // Una carga que otro ya cerró NO entra al post-proceso: el `afterAll` de ACTUALIZACIONES o PAGOS
                // genera pagos y cancela casos, y no se corre sobre una carga FALLIDA. Se corta acá (el `catch`
                // de abajo lo trata como el corte por lote: sin `fallar` ni notificar).
                // La compuerta leyó un pedido de cancelación con la fila bloqueada: el `afterAll` NO corre.
                if (faseErr instanceof CargaCerradaPorFueraError || faseErr instanceof CargaCanceladaError) throw faseErr;
                this.logger.warn(`No se pudo registrar la fase POST_PROCESO de la remesa ${remesaId}: ${motivoLegible(faseErr)}`);
                // La escritura de la etiqueta falló por otra causa y el `afterAll` va a correr igual: antes se confirma
                // con una lectura simple que nadie pidió cancelar. Si la lectura falla o viene vacía, se sigue: una
                // etiqueta no frena la consolidación (y un vacío espurio nunca es un pedido).
                if (tracker.cancelacionPedida) throw new CargaCanceladaError('antes del post-proceso');
                try {
                    const fila = await this.prisma.import_progreso.findUnique({
                        where: { remesaId },
                        select: { cancelSolicitadaAt: true },
                    });
                    if (fila?.cancelSolicitadaAt != null) {
                        tracker.avisarCancelacion();
                        throw new CargaCanceladaError('antes del post-proceso');
                    }
                } catch (lecturaErr) {
                    if (lecturaErr instanceof CargaCanceladaError) throw lecturaErr;
                    this.logger.warn(`No se pudo confirmar si hay una cancelación pedida en la remesa ${remesaId}: ${motivoLegible(lecturaErr)}`);
                }
            }
            const t1 = Date.now();
            this.logger.log(`Post-proceso remesa=${remesaId} categoria=${remesa.categoria} iniciado`);
            try {
                await processor.afterAll(ctx);
                this.logger.log(
                    `Post-proceso remesa=${remesaId} categoria=${remesa.categoria} terminó en ${Date.now() - t1}ms`,
                );
            } catch (e: any) {
                this.logger.error(
                    `Post-proceso remesa=${remesaId} categoria=${remesa.categoria} falló tras ${Date.now() - t1}ms: ${e?.message}`,
                    e?.stack,
                );
                errorPostProceso = motivoLegible(e) || 'Error desconocido en el post-proceso';
                try {
                    await this.prisma.importerror.create({
                        data: {
                            remesaId,
                            rowNumber: 0,
                            rawRow: [] as any,
                            errorMsg: `[post-proceso] ${errorPostProceso}`.slice(0, 4000),
                        },
                    });
                    avisosEscritos++;
                } catch (ie: any) {
                    this.logger.warn(`No se pudo registrar el error de post-proceso de la remesa ${remesaId}: ${ie?.message}`);
                }
                tracker.sumarAdvertencias(1);
            }
            tracker.cerrarSubfase();
        }

        // Avisos que escribieron los processors (CLAVE_NO_CARGADA en el afterAll de PAGOS, TANDA_ANTERIOR
        // en el lote de MULTICLAVES…): no pasan por el runner, así que sin esto `advertencias` no los
        // cuenta y con `errFilas = 0` la pantalla no los muestra (#11). Se distinguen de un error de fila
        // por el prefijo (los errores de fila de cargas con varios archivos también empiezan con `[`).
        try {
            const enBase = await this.prisma.importerror.count({
                where: {
                    remesaId,
                    // Todos los avisos se escriben con rowNumber 0: acota el índice (de ~100 ms a ~1 ms con 200 mil errores).
                    rowNumber: 0,
                    OR: [
                        { errorMsg: { startsWith: '[aviso]' } },
                        { errorMsg: { startsWith: '[parseo]' } },
                        { errorMsg: { startsWith: '[post-proceso]' } },
                    ],
                },
            });
            // Lo ya contado en memoria nunca baja (el truncado a 500 sigue diciendo el total real).
            if (enBase > avisosEscritos) tracker.sumarAdvertencias(enBase - avisosEscritos);
        } catch (countErr: any) {
            this.logger.warn(`No se pudieron contar los avisos de la remesa ${remesaId}: ${countErr?.message}`);
        }

        // Antes de finalizar: si tirara después, el `catch` intentaría marcar FALLIDA una carga que terminó bien.
        try {
            await job.updateProgress({ total, ok, err });
        } catch (upErr: any) {
            this.logger.warn(`No se pudo actualizar el progreso final del job de la remesa ${remesaId}: ${upErr?.message}`);
        }

        const estadoFinal = await tracker.finalizar({ ok, err, descartadas, fueraDeCorte, errorPostProceso });

        // Nada de lo que sigue puede tirar hacia el `catch`: el estado terminal ya está persistido.
        await this.notificarResultadoCarga(estadoFinal, ownerId ?? null);

        this.logger.log(
            `Remesa ${remesaId} finalizada resultado=${estadoFinal.resultado} ok=${ok} err=${err} ` +
            `descartadas=${descartadas} advertencias=${estadoFinal.advertencias} en ${Date.now() - t0}ms`,
        );

        return { total, ok, err };

        } catch (error: any) {
            // Otro cerró la carga mientras se procesaba (terminó, se borró, volvió a borrador): no se pisa su
            // estado ni se notifica; ya lo hizo quien la cerró.
            if (error instanceof CargaCerradaPorFueraError || tracker.cerradaPorFuera) {
                this.logger.warn(
                    `La remesa ${remesaId} fue cerrada por fuera mientras se procesaba: se corta sin tocar su estado ` +
                    `(ok=${ok} err=${err})`,
                );
                return { total, ok, err, ignorado: true };
            }
            // Cancelación pedida (§10.5.3): no es una falla. Se cierra con los contadores exactos, sin cierre de carga.
            if (error instanceof CargaCanceladaError) {
                return this.cerrarCargaCancelada(tracker, remesa, { ok, err, descartadas, fueraDeCorte }, { total, filasEntregadas, ownerId: ownerId ?? null, t0, remesaId, donde: error.donde });
            }
            // Un error de negocio (plantilla sin estado inicial, archivo que falta…) es `warn`; una falla
            // inesperada, `error` con stack. El detalle completo va solo al log.
            if (error instanceof HttpException) {
                this.logger.warn(`Remesa ${remesaId} falló tras ${Date.now() - t0}ms: ${error.message}`);
            } else {
                this.logger.error(`Remesa ${remesaId} falló tras ${Date.now() - t0}ms: ${error?.message}`, error?.stack);
            }
            const estadoFallido = await tracker.fallar(error, { ok, err, descartadas, fueraDeCorte }, { sinFilasEntregadas: !filasEntregadas });
            if (tracker.cerradaPorFuera) {
                // `fallar` se encontró con que otro ya había cerrado la carga: tampoco se notifica.
                this.logger.warn(`La remesa ${remesaId} fue cerrada por fuera mientras se marcaba como fallida: no se notifica`);
                return { total, ok, err, ignorado: true };
            }
            await this.notificarResultadoCarga(estadoFallido, ownerId ?? null, tracker.noSePudoRegistrar);
            throw error;
        } finally {
            // Pase lo que pase: detiene el reloj y saca la carga del registro de cargas vivas.
            tracker.cerrar();
            this.cargasVivas.delete(remesaId);
        }
    }

    /**
     * Cede el event loop y relee el pedido de cancelación de la base (§10.5.3, hallazgo 3 de la auditoría). Se llama después de una
     * lectura síncrona que bloquea y ANTES de entregar la primera fila. Si hay pedido corta con 0 filas. Una lectura que falla no
     * es un pedido: la carga sigue.
     */
    private async cederYReleerCancelacion(tracker: ProgresoTracker, remesaId: number): Promise<void> {
        await new Promise((r) => setTimeout(r, PAUSA_TRAS_LECTURA_BLOQUEANTE_MS));
        if (tracker.cancelacionPedida) throw new CargaCanceladaError('lectura');
        try {
            const fila = await this.prisma.import_progreso.findUnique({ where: { remesaId }, select: { cancelSolicitadaAt: true } });
            if (fila?.cancelSolicitadaAt != null) {
                tracker.avisarCancelacion();
                throw new CargaCanceladaError('lectura');
            }
        } catch (e) {
            if (e instanceof CargaCanceladaError) throw e;
            this.logger.warn(`No se pudo releer la cancelación de la remesa ${remesaId} tras la lectura: ${motivoLegible(e)}`);
        }
    }

    /** ¿Este proceso está procesando alguna carga ahora? (el reaper lo usa para distinguir "el worker no toma el job"). */
    hayCargasVivasEnEsteProceso(): boolean {
        return this.cargasVivas.size > 0;
    }

    /**
     * ¿Esta carga la está procesando este proceso ahora? Lo consulta el reaper (§9.5.6): `null` si no.
     * Es memoria del proceso, no depende de ningún timer.
     */
    cargaVivaEnEsteProceso(
        remesaId: number,
    ): { sinAvanceMs: number; fase: string; subfase: string | null; cancelacionPedidaHaceMs: number | null } | null {
        const t = this.cargasVivas.get(remesaId);
        if (!t) return null;
        const { fase, subfase } = t.faseActual;
        return { sinAvanceMs: t.sinAvanceMs, fase, subfase, cancelacionPedidaHaceMs: t.cancelacionPedidaHaceMs };
    }

    /** Compensación cuando `processImportJob` falla antes de tener tracker: deja la carga FALLIDA con
     *  motivo en vez de EN_COLA. Nunca tira (si la base no responde, no hay nada más que hacer). */
    private async marcarFallidaSinTracker(remesaId: number, error: unknown): Promise<void> {
        try {
            const motivo = motivoLegible(error);
            // Las dos escrituras van juntas o ninguna: si fallara la segunda, quedaría la remesa FALLIDA con
            // la fila EN_COLA (terminal y en curso a la vez, usuario bloqueado).
            await this.prisma.$transaction(async (tx) => {
                // De un estado terminal no se sale: un job duplicado sobre una carga que ya terminó no la pisa.
                const { count } = await tx.remesa.updateMany({
                    where: { id: remesaId, estadoProceso: { notIn: ['FINALIZADA', 'FALLIDA'] } },
                    data: { estadoProceso: 'FALLIDA' },
                });
                if (count === 0) return;
                const fin = new Date();
                await tx.import_progreso.upsert({
                    where: { remesaId },
                    create: { remesaId, fase: 'TERMINADA', resultado: 'FALLIDA', error: motivo, finishedAt: fin, rev: 1 },
                    update: { fase: 'TERMINADA', resultado: 'FALLIDA', error: motivo, finishedAt: fin, rev: { increment: 1 } },
                });
            });
        } catch (e: any) {
            this.logger.error(`No se pudo marcar la remesa ${remesaId} como FALLIDA: ${e?.message}`, e?.stack);
        }
    }

    /**
     * Notificación persistente según cómo terminó la carga (§8.5.5). Nunca tira: la carga ya terminó.
     * El resultado viaja en `payload.resultado`; el enum `TipoNotificacion` no se toca.
     */
    private async notificarResultadoCarga(
        estado: EstadoCargaDto,
        ownerId: number | null,
        sinRegistrar = false,
        /** Solo al dueño: sin avisar a quienes ven las importaciones de otros (una cancelada en cola no procesó nada). */
        soloAlDueno = false,
    ): Promise<void> {
        if (ownerId == null) {
            this.logger.warn(`La remesa ${estado.remesaId} no tiene dueño: no hay a quién notificar el resultado.`);
            return;
        }
        try {
            const texto = textoNotificacion(estado, { sinRegistrar });
            await this.notificacionesService.crear({
                tipo: texto.tipo,
                entidadTipo: 'REMESA',
                entidadId: estado.remesaId,
                titulo: texto.titulo,
                mensaje: texto.mensaje,
                payload: {
                    resultado: estado.resultado,
                    ok: estado.ok,
                    err: estado.err,
                    procesadas: estado.procesadas,
                    descartadas: estado.descartadas,
                    fueraDeCorte: estado.fueraDeCorte,
                    descartadasPorFiltro: estado.descartadasPorFiltro,
                    advertencias: estado.advertencias,
                    durationMs: estado.durationMs,
                    tipoImport: estado.tipo,
                    okFilas: estado.okFilas,
                    errFilas: estado.errFilas,
                    totalFilas: estado.totalFilas,
                    ...(estado.cancelada ? { cancelada: true } : {}),
                },
                rutaAccion: `/historial-importaciones/${estado.remesaId}`,
                destinatarioPrincipalId: ownerId,
                ...(soloAlDueno ? {} : { incluirUsuariosConPermiso: 'importacion.ver_progreso_otros' }),
            });
        } catch (notifErr: any) {
            this.logger.warn(`Error creando notificacion de importacion de la remesa ${estado.remesaId}: ${notifErr?.message}`);
        }
    }

    /** Las advertencias del parseo quedan visibles como filas `[parseo]` de la remesa (rowNumber 0).
     *  Se guardan las primeras 500; si hubo más, una fila más dice cuántas se omitieron. */
    private async registrarAdvertenciasDeParseo(remesaId: number, advertencias: string[]): Promise<number> {
        const MAX = 500;
        this.logger.warn(`Remesa ${remesaId}: ${advertencias.length} advertencia(s) de parseo.`);
        const data = advertencias.slice(0, MAX).map((a) => ({
            remesaId,
            rowNumber: 0,
            rawRow: [] as any,
            errorMsg: `[parseo] ${a}`,
        }));
        if (advertencias.length > MAX) {
            data.push({
                remesaId,
                rowNumber: 0,
                rawRow: [] as any,
                errorMsg: `[parseo] Se omitieron ${advertencias.length - MAX} advertencias más (se guardan las primeras ${MAX}).`,
            });
        }
        await this.prisma.importerror.createMany({ data });
        return data.length;
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
                progreso: true,
            },
        });

        if (!r) throw new NotFoundException();

        const enColaDelante = r.progreso?.fase === 'EN_COLA' ? await this.enColaDelanteDe(remesaId, r.progreso.encoladaAt) : null;
        const carga = armarEstadoCarga(r, r.progreso, new Date(), { enColaDelante });

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
            // Se conserva la clave para las pestañas viejas: el estado ya no sale de `jobimport` (que nunca se escribe).
            jobimport: null,
            carga,
            duracionMs: carga.duracionMs,
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
        //
        // La situación cancelada se resuelve por CATEGORÍA (`idsSituacionCancelada`), no por la
        // clave `SIT-050`: un caso cancelado con quita (SIT-054, multiclaves) es tan "cerrado" como
        // uno en SIT-050/051/052/053, y antes de este cambio el combo lo contaba como vivo — ver
        // docs/multiclaves-spec.md §10.7.
        let idsCerrados: number[] = [];
        if (soloEnGestion) {
            const [idsCancelado, gestionCierre] = await Promise.all([
                idsSituacionCancelada(this.prisma),
                this.prisma.parametro.findMany({
                    where: { clave: { in: ['GES-094', 'GES-090'] } },
                    select: { id: true },
                }),
            ]);
            idsCerrados = [...idsCancelado, ...gestionCierre.map((c) => c.id)];
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

    /**
     * Tope de tiempo para hablar con la cola (`IMPORTS_QUEUE_TIMEOUT_MS`, default 10 s, bien por debajo de
     * los 60 s del ALB). No se toca la conexión global de BullMQ (la comparten los workers, que bloquean
     * a propósito): el tope vive acá. Al vencer rechaza; la promesa original queda con un `catch` vacío
     * para que si rechaza o resuelve tarde no deje un rechazo sin manejar.
     */
    private conTope<T>(promesa: Promise<T>, que: string): Promise<T> {
        const raw = Number(process.env.IMPORTS_QUEUE_TIMEOUT_MS);
        const ms = Number.isFinite(raw) && raw > 0 ? raw : 10_000;
        promesa.catch(() => undefined);
        let timer: NodeJS.Timeout;
        const vencido = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`La cola de trabajos no respondió en ${ms} ms (${que})`)), ms);
        });
        return Promise.race([promesa, vencido]).finally(() => clearTimeout(timer));
    }

    /**
     * Para borrar una carga encolada que no arrancó: ¿se puede, y queda el job fuera de la cola?
     * `true` si el job no existe (o ya no corre) o si estaba esperando y se lo sacó; `false` si está
     * activo, si no se pudo sacar o si no se puede consultar la cola. Tolerante a una cola sin `getJob`.
     */
    async sacarJobDeLaCola(remesaId: number, jobId: string | null): Promise<boolean> {
        const cola = this.importQueue;
        try {
            let job: Job | undefined | null;
            if (jobId) {
                if (typeof cola?.getJob !== 'function') return true;
                job = await this.conTope(cola.getJob(jobId), 'getJob');
                // Los ids de BullMQ son un contador que vive en Redis: si Redis perdió sus datos, un `jobId`
                // viejo puede ser el de otra carga. Escrito en negativo a propósito: los jobs falsos de los
                // specs de borrado no traen `data` y se tienen que seguir sacando.
                if (job && job.data?.remesaId !== undefined && job.data.remesaId !== remesaId) {
                    this.logger.warn(`Remesa ${remesaId}: el job ${jobId} guardado es de otra carga; se lo busca por remesa`);
                    job = null;
                    if (typeof cola?.getJobs !== 'function') return true;
                    const candidatos = await this.conTope(
                        cola.getJobs(['waiting', 'active', 'delayed', 'paused', 'prioritized']),
                        'getJobs',
                    );
                    job = candidatos.find((j) => j?.data?.remesaId === remesaId);
                }
            } else {
                // Sin id guardado (se perdió el update o la encoló el código viejo): se lo busca por `data.remesaId`.
                if (typeof cola?.getJobs !== 'function') return true;
                const candidatos = await this.conTope(
                    cola.getJobs(['waiting', 'active', 'delayed', 'paused', 'prioritized']),
                    'getJobs',
                );
                job = candidatos.find((j) => j?.data?.remesaId === remesaId);
            }
            if (!job) return true;
            const estado = await this.conTope(job.getState(), 'getState');
            if (estado === 'active') {
                this.logger.warn(`Remesa ${remesaId}: su job ${job.id} está activo, no se puede borrar`);
                return false;
            }
            if (estado === 'completed' || estado === 'failed') return true;
            await this.conTope(job.remove(), 'remove');
            this.logger.log(`Remesa ${remesaId}: job ${job.id} (${estado}) sacado de la cola antes de borrarla`);
            return true;
        } catch (e: any) {
            this.logger.warn(`Remesa ${remesaId}: no se pudo consultar o sacar su job de la cola: ${e?.message}`);
            return false;
        }
    }

    /**
     * Qué dice BullMQ del job de una carga (§9.5.6). Nunca tira: cualquier excepción, un tope de tiempo
     * vencido o una cola sin lo necesario para mirar el lock dan `DESCONOCIDO`, y el reaper ante la
     * duda no cierra nada. El lock (`<cola>:<id>:lock`) es la señal de vida que BullMQ mira (sonda S-2).
     */
    async estadoDelJobDeCarga(remesaId: number, jobId: string | null): Promise<{ estado: EstadoJobDeCarga }> {
        const cola = this.importQueue;
        try {
            let job: Job | undefined | null = null;
            if (jobId && typeof cola?.getJob === 'function') {
                job = await this.conTope(cola.getJob(jobId), 'getJob');
                // El id ya no es de esta carga (Redis perdió sus datos y el contador volvió a empezar).
                if (job && job.data?.remesaId !== undefined && job.data.remesaId !== remesaId) job = null;
            }
            if (!job) {
                if (typeof cola?.getJobs !== 'function') return { estado: 'DESCONOCIDO' };
                const candidatos = await this.conTope(
                    cola.getJobs(['waiting', 'active', 'delayed', 'paused', 'prioritized']),
                    'getJobs',
                );
                job = candidatos.find((j) => j?.data?.remesaId === remesaId);
            }
            if (!job) return { estado: 'NO_EXISTE' };
            const estado = await this.conTope(job.getState(), 'getState');
            switch (estado) {
                case 'active': {
                    if (typeof cola?.toKey !== 'function' || typeof cola?.client === 'undefined') {
                        return { estado: 'DESCONOCIDO' };
                    }
                    const cliente = await this.conTope(Promise.resolve(cola.client), 'client');
                    const existe = await this.conTope(cliente.exists(`${cola.toKey(String(job.id))}:lock`), 'lock');
                    return { estado: Number(existe) === 1 ? 'ACTIVO_CON_LOCK' : 'ACTIVO_SIN_LOCK' };
                }
                case 'waiting':
                case 'delayed':
                case 'prioritized':
                case 'waiting-children':
                    return { estado: 'EN_ESPERA' };
                case 'completed':
                case 'failed':
                    return { estado: 'TERMINADO' };
                default:
                    return { estado: 'DESCONOCIDO' };
            }
        } catch (e: any) {
            this.logger.warn(`Remesa ${remesaId}: no se pudo consultar el estado de su job: ${e?.message}`);
            return { estado: 'DESCONOCIDO' };
        }
    }

    /**
     * Cierra como FALLIDA una carga interrumpida (§9.5.5): el reaper y la guarda de re-entrega, nadie más.
     * Devuelve el estado terminal, o `null` si no cerró nada. El `SELECT … FOR UPDATE` serializa el cierre
     * contra todo lo que escribe esa fila (el `iniciar` del worker, el borrado, la confirmación): el que
     * llega segundo ve el resultado del primero.
     */
    async cerrarCargaInterrumpida(
        remesaId: number,
        motivo: MotivoInterrupcion,
        detalle: { jobId?: string | number; umbralMs?: number } = {},
    ): Promise<EstadoCargaDto | null> {
        const t0 = Date.now();
        // Nunca una carga viva en este proceso.
        if (this.cargasVivas.has(remesaId)) {
            this.logger.warn(`No se cierra la remesa ${remesaId} como interrumpida: este proceso la está procesando`);
            return null;
        }
        const umbralMs = detalle.umbralMs ?? UMBRAL_LATIDO_DEFAULT_MS;
        this.logger.warn(`Cerrando como interrumpida la remesa ${remesaId} (motivo=${motivo})`);

        type FilaCierre = {
            estadoProceso: string; categoria: string | null; filtroFilas: unknown;
            encoladaAt: Date | null; startedAt: Date | null; heartbeatAt: Date | null; finishedAt: Date | null;
            ok: number; err: number; jobId: string | null; resumen?: unknown;
        };
        let minutosSinLatido: number | null = null;
        const cerrada = await this.prisma.$transaction(async (tx) => {
            const filas = await tx.$queryRaw<FilaCierre[]>`
                SELECT r.estadoProceso AS estadoProceso, r.categoria AS categoria, r.filtroFilas AS filtroFilas, p.encoladaAt AS encoladaAt,
                       p.startedAt AS startedAt, p.heartbeatAt AS heartbeatAt, p.finishedAt AS finishedAt,
                       p.ok AS ok, p.err AS err, p.jobId AS jobId, p.resumen AS resumen
                FROM remesa r JOIN import_progreso p ON p.remesaId = r.id
                WHERE r.id = ${remesaId}
                FOR UPDATE
            `;
            const f = filas[0];
            // Sin fila: se borró, o es una remesa heredada sin fila de progreso.
            if (!f) return null;
            // Un terminal no se pisa.
            if (f.estadoProceso === 'FINALIZADA' || f.estadoProceso === 'FALLIDA' || f.finishedAt != null) return null;
            // Un borrador no es una carga.
            if (f.encoladaAt == null) return null;

            // La comprobación del motivo, otra vez, ya con el lock.
            if (motivo === 'SIN_LATIDO') {
                if (f.startedAt == null) return null;
                const ultimo = (f.heartbeatAt ?? f.startedAt).getTime();
                if (t0 - ultimo < umbralMs) return null; // latió mientras tanto
                minutosSinLatido = Math.round((t0 - ultimo) / 60_000);
            } else if (motivo === 'SIN_JOB') {
                if (f.startedAt != null) return null; // arrancó mientras tanto
            } else if (f.startedAt == null) {
                return null; // REENTREGA
            }

            const ahora = new Date();
            // "Tiene corte propio": el mismo criterio con el que el runner arma `deCorte` (`filtrosSeparados`).
            // Retomable (§10.5.4): nunca arrancó (`SIN_JOB` ya lo comprobó con el lock) y se guardó con qué remesas de origen
            // se confirmó. El marcador de "no entregó filas" NO se escribe acá: lo escribe solo el runner vivo.
            const resumen = leerResumen(f.resumen);
            const retomable = motivo === 'SIN_JOB' && resumen?.v === 1 && !!resumen.origen;
            const texto = textoInterrupcion(motivo, f.categoria, { conCorte: this.tieneCortePropio(f.filtroFilas), retomable });
            // Una sola escritura, con la remesa y su fila juntas. `heartbeatAt` NO se toca: queda el último real.
            return tx.remesa.update({
                where: { id: remesaId },
                data: {
                    estadoProceso: 'FALLIDA',
                    okFilas: Number(f.ok),
                    errFilas: Number(f.err),
                    progreso: {
                        update: {
                            fase: 'TERMINADA',
                            resultado: 'FALLIDA',
                            error: texto,
                            subfase: null,
                            finishedAt: ahora,
                            rev: { increment: 1 },
                        },
                    },
                },
                include: { progreso: true, usuarioCreador: { select: { id: true, nombre: true } } },
            });
        });

        if (!cerrada) {
            this.logger.log(`Remesa ${remesaId}: no se cerró como interrumpida (ya no corresponde, motivo=${motivo})`);
            return null;
        }

        const estado = armarEstadoCarga(cerrada, cerrada.progreso);
        const ownerId = cerrada.usuarioCreadorId ?? null;

        // Fuera de la transacción, cada paso en su `try/catch`: el cierre ya está hecho.
        try {
            this.realtimeService.emitImportFinalizada(estado);
        } catch (e: any) {
            this.logger.warn(`Error emitiendo import:finalizada de la remesa ${remesaId} (interrumpida): ${e?.message}`);
        }
        await this.notificarResultadoCarga(estado, ownerId);
        try {
            await this.auditoria.log({
                modulo: AuditModulo.IMPORT,
                entidad: 'Remesa',
                tipo: AuditTipo.IMPORT_FAIL,
                severidad: AuditSeveridad.ERROR,
                estado: AuditEstado.FALLIDO,
                usuarioId: ownerId,
                entidadId: remesaId,
                resumen: `Importación interrumpida remesa ${remesaId}`,
                data: { contexto: { motivo, jobId: detalle.jobId ?? cerrada.progreso?.jobId ?? null, umbralMs: detalle.umbralMs } },
            });
        } catch (e: any) {
            this.logger.warn(`No se pudo auditar el cierre por interrupción de la remesa ${remesaId}: ${e?.message}`);
        }

        this.logger.warn(
            `Remesa ${remesaId} cerrada como interrumpida (motivo=${motivo}, ` +
            `${minutosSinLatido != null ? `${minutosSinLatido} min sin latido, ` : ''}` +
            `filas procesadas=${estado.procesadas}) en ${Date.now() - t0}ms`,
        );
        return estado;
    }

    /**
     * Dentro de la transacción de borrado: relee la remesa con `FOR UPDATE` y aborta si el worker la
     * tomó entre la lectura inicial y ahora (la lectura de `deleteRemesa` es anterior y puede estar vieja).
     * Una carga terminada tiene `startedAt` pero también `finishedAt`: esa sí se borra.
     * Tolerante a un `tx` sin `$queryRaw` (mocks de los specs de borrado).
     */
    private async verificarNoArrancada(
        tx: Prisma.TransactionClient,
        remesaId: number,
        /** La lectura inicial del borrado ya la había visto encolada (carga en cola sin arrancar). */
        vistaEnCola = false,
    ): Promise<void> {
        if (typeof (tx as { $queryRaw?: unknown }).$queryRaw !== 'function') return;
        const filas = await tx.$queryRaw<Array<{ estadoProceso: string; encoladaAt?: Date | null; startedAt: Date | null; finishedAt: Date | null }>>`
            SELECT r.estadoProceso AS estadoProceso, p.encoladaAt AS encoladaAt, p.startedAt AS startedAt, p.finishedAt AS finishedAt
            FROM remesa r LEFT JOIN import_progreso p ON p.remesaId = r.id
            WHERE r.id = ${remesaId}
            FOR UPDATE
        `;
        const f = filas[0];
        if (f && (f.estadoProceso === 'PROCESANDO' || (f.startedAt != null && f.finishedAt == null))) {
            this.logger.warn(`Remesa ${remesaId}: el worker la tomó mientras se borraba; se aborta el borrado`);
            throw new BadRequestException('No se puede eliminar una importación en curso');
        }
        // La lectura inicial la vio borrador y la confirmación hizo commit antes de este lock: una carga recién
        // encolada pasaría. Escrita para que `undefined` (fixtures viejas) no la dispare.
        if (f && !vistaEnCola && f.encoladaAt != null && f.finishedAt == null) {
            this.logger.warn(`Remesa ${remesaId}: se confirmó mientras se borraba; se aborta el borrado`);
            throw new ConflictException('Esta importación se acaba de confirmar. Si igual querés eliminarla, volvé a intentarlo.');
        }
    }

    /** El borrado venció la transacción (P2028): 400 con el motivo en vez del 500 opaco. Todo lo demás se relanza. */
    private errorDeBorrado(remesaId: number, e: any): never {
        // Causa de tiempo o de conexión: P2028 (venció la transacción), P1017 (la conexión rota que deja un vencimiento) o
        // un lock wait timeout de MySQL (1205, que llega como P2010 "Raw query failed. Code: `1205`").
        const lockWait = e?.code === 'P2010' && /1205|lock wait timeout/i.test(String(e?.message ?? '') + String(e?.meta?.code ?? ''));
        if (e?.code === 'P2028' || e?.code === 'P1017' || lockWait) {
            this.logger.warn(`Remesa ${remesaId}: el borrado no terminó (${motivoLegible(e)})`);
            throw new BadRequestException(MSG_BASE_LENTA);
        }
        throw e;
    }

    /** Una notificación no sobrevive a su remesa (#12). Va afuera de la transacción de borrado y sin
     *  tirar: si la limpieza falla, la remesa ya se borró y eso no se deshace por una notificación. */
    private async borrarNotificacionesDeRemesa(remesaId: number): Promise<void> {
        try {
            const afectados = await this.prisma.notificacion.findMany({
                where: { entidadTipo: 'REMESA', entidadId: remesaId },
                select: { usuarioId: true },
                distinct: ['usuarioId'],
            });
            await this.prisma.notificacion.deleteMany({ where: { entidadTipo: 'REMESA', entidadId: remesaId } });
            // El contador de no leídas de cada afectado queda desfasado hasta la próxima hidratación: se re-emite.
            for (const { usuarioId } of afectados) {
                const { noLeidas } = await this.notificacionesService.contador(usuarioId);
                this.realtimeService.emitToUser(usuarioId, 'notificacion:contador', { noLeidas });
            }
        } catch (e: any) {
            this.logger.warn(`No se pudieron borrar las notificaciones de la remesa ${remesaId}: ${e?.message}`);
        }
    }

    // --- ELIMINAR REMESA ---
    async deleteRemesa(remesaId: number, user: { sub: number; permisos: string[] }) {
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: { progreso: { select: { encoladaAt: true, startedAt: true, finishedAt: true, jobId: true } } },
        });
        if (!remesa) throw new NotFoundException(`Remesa ${remesaId} no encontrada`);

        // El dueño se chequea ANTES de cualquier efecto sobre la cola: un 403 no puede sacar el job de otro.
        const puedeVerOtros = user.permisos.includes('importacion.ver_progreso_otros');
        if (!puedeVerOtros && remesa.usuarioCreadorId !== user.sub) {
            throw new ForbiddenException('No tenés permiso para eliminar esta importación');
        }

        // "En curso" es encolada y sin terminar (#24): una carga EN_COLA tampoco se puede borrar, el
        // worker después reventaría con "Remesa/archivo/plantilla no existe".
        const enCurso = remesa.progreso?.encoladaAt != null && remesa.progreso.finishedAt == null;
        if (remesa.estadoProceso === 'PROCESANDO' || enCurso) {
            // Una carga encolada que todavía no arrancó se puede abortar: si su job no existe (se perdió,
            // nunca se encoló) o está esperando en la cola, se lo saca y se borra. Una que ya arrancó y no
            // terminó sigue bloqueada (es del reaper de la Fase B), y una con el job activo también.
            const sinArrancar = enCurso && !remesa.progreso?.startedAt && remesa.estadoProceso !== 'PROCESANDO';
            if (!sinArrancar || !(await this.sacarJobDeLaCola(remesaId, remesa.progreso?.jobId ?? null))) {
                throw new BadRequestException('No se puede eliminar una importación en curso');
            }
            this.logger.warn(`Remesa ${remesaId}: se borra una carga encolada que no llegó a arrancar`);
        }

        // MULTICLAVES no crea deudores: tiene su propia rama, sin el chequeo de gestión de abajo
        // (que mira comentarios/convenios/pagos/llamadas/emails de LOS DEUDORES de la remesa).
        if (remesa.categoria === 'MULTICLAVES') {
            return this.deleteRemesaMulticlaves(remesaId, user, enCurso);
        }

        // Chequeo previo por tamaño, antes de abrir la transacción y sin tocar nada.
        const totalCasos = await this.prisma.deudor.count({ where: { remesaId } });
        const tope = borradoMaxCasos();
        if (totalCasos > tope) {
            this.logger.warn(`Remesa ${remesaId}: tiene ${totalCasos} casos, más que el tope de ${tope} para borrarla desde la pantalla`);
            throw new BadRequestException(MSG_REMESA_GRANDE);
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
            await this.verificarNoArrancada(tx, remesaId, enCurso);
            if (deudorIds.length > 0) {
                await tx.contacto.deleteMany({ where: { deudorId: { in: deudorIds } } });
                await tx.campoextra.deleteMany({ where: { deudorId: { in: deudorIds } } });
                await tx.factura.deleteMany({ where: { deudorId: { in: deudorIds } } });
                await tx.deudor.deleteMany({ where: { id: { in: deudorIds } } });
            }
            await tx.jobimport.deleteMany({ where: { remesaId } });
            await tx.importerror.deleteMany({ where: { remesaId } });
            await tx.remesa.delete({ where: { id: remesaId } });
        }, TX_BORRADO).catch((e: any) => this.errorDeBorrado(remesaId, e));
        await this.borrarNotificacionesDeRemesa(remesaId);

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
    private async deleteRemesaMulticlaves(remesaId: number, user: { sub: number; permisos: string[] }, vistaEnCola = false) {
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
            await this.verificarNoArrancada(tx, remesaId, vistaEnCola);
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
        await this.borrarNotificacionesDeRemesa(remesaId);

        this.logger.log(
            `Multiclaves remesa=${remesaId} eliminada por usuario ${user.sub}: ${borradas} clave(s) borradas, ` +
            `${restauradas} restaurada(s) a VIGENTE, ${repuntadas} repuntada(s) a la tanda ganadora ` +
            `en ${Date.now() - t0}ms`,
        );
        return { deleted: true, clavesEliminadas: borradas, clavesRestauradas: restauradas };
    }
}