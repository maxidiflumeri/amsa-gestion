// src/import/import.service.ts
import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { applyTransforms } from './transforms';
import { resolveDelimiter } from './utils/delimitador';
import { FileStorageService } from './file-storage.service';
import * as fs from 'fs';
import * as fastcsv from 'fast-csv';
import * as xlsx from 'xlsx';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ClonarPlantillaDto, CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';
import { MappingJson } from './mapping-types';
import { getProcessor, getSupportedCategories } from './processors/processor-registry';
import { ProcessContext, MappedRow } from './processors/processor.interface';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { ProgressEmitter } from './utils/progress-emitter';
import { parseMultirregistro } from './utils/multirregistro-parser';
import { siguienteNumeroRemesa } from './utils/numero-remesa';
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

    async previewFile(file: any, separador: string, tieneHeader: boolean, hoja?: string, maxRows = 5) {
        const rows: any[] = [];
        const isExcel = file.originalname?.match(/\.(xls|xlsx)$/i);

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

    // --- REMESA / ARCHIVO ---
    async createRemesa(dto: CreateRemesaDto, file: any, usuarioCreadorId?: number) {

        const plantilla = await this.prisma.plantillaimport.findUnique({ where: { id: dto.plantillaId } });
        if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

        const saved = await this.files.saveBuffer(file, dto.empresaId, dto.categoria);
        const numeroRemesa = await this.resolverNumeroRemesa(dto.empresaId, dto.numeroRemesa);
        const remesa = await this.prisma.remesa.create({
            data: {
                numeroRemesa,
                empresaId: dto.empresaId,
                nombre: dto.nombre,
                categoria: dto.categoria as any,
                plantillaId: dto.plantillaId,
                archivo: saved.path,
                archivoHash: saved.hash,
                hoja: dto.hoja,
                fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
                validarDomicilios: dto.validarDomicilios ?? false,
                estadoProceso: 'PENDIENTE',
                usuarioCreadorId: usuarioCreadorId ?? null,
            },
        });
        return { remesaId: remesa.id };
    }

    // --- PARSEAR FILAS (shared entre validate y execute) ---
    private mapRow(row: any, mapping: MappingJson): MappedRow {
        const obj: MappedRow = {};

        // Si fast-csv devuelve un objeto (tieneHeader=true), convertir a array
        const rowArr = Array.isArray(row) ? row : Object.values(row);
        obj._raw = rowArr; // fila cruda por índice (la usa la categoría ACCIONES)

        // Mapeo principal por índice
        for (const [dest, cfg] of Object.entries(mapping.columns)) {
            const raw = cfg.fromIndex === -1 ? (cfg as any).staticValue : rowArr[cfg.fromIndex];
            obj[dest] = applyTransforms(raw, cfg.transforms);
        }

        // Mapeo de extras → camposAdicionales (JSON)
        if (mapping.extras) {
            const extrasObj: Record<string, any> = {};
            for (const [name, cfg] of Object.entries(mapping.extras)) {
                const raw = cfg.fromIndex === -1 ? (cfg as any).staticValue : rowArr[cfg.fromIndex];
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
                    const raw = cfg.fromIndex === -1 ? (cfg as any).staticValue : rowArr[cfg.fromIndex];
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
        const isExcel = remesa.archivo.match(/\.(xls|xlsx)$/i);

        if (isExcel) {
            const workbook = xlsx.readFile(remesa.archivo, {
                cellDates: true,
                dateNF: 'yyyy-mm-dd'
            });
            const sheetName = hoja && workbook.SheetNames.includes(hoja) ? hoja : workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Defval para llenar celdas vacías, raw: false para fechas y números formateados
            const excelRows: any[][] = xlsx.utils.sheet_to_json(worksheet, { 
                header: 1, 
                defval: '',
                raw: false
            });
            
            const processRow = (row: any[], index: number) => {
                const idx = totalRows++;
                if (idx < sampleRows) {
                    try {
                        const obj = this.mapRow(row, mapping);
                        this.validateMappedRow(obj, mapping);
                        preview.push({ row: idx, data: obj, error: null });
                        ok++;
                    } catch (e: any) {
                        preview.push({ row: idx, data: null, error: e.message });
                        err++;
                    }
                }
            };

            for (let i = hasHeader ? 1 : 0; i < excelRows.length; i++) {
                if (excelRows[i] && excelRows[i].length > 0) {
                    processRow(excelRows[i], i);
                }
            }

        } else {
            const stream = fs.createReadStream(remesa.archivo);
            const parser = fastcsv.parse({
                headers: hasHeader,
                delimiter: sep,
                trim: false
            });

            await new Promise<void>((resolve, reject) => {
                parser
                    .on('error', (parseErr) => {
                        this.logger.error(`Error parsing CSV remesa=${remesaId}: ${parseErr.message}`, parseErr.stack);
                        reject(parseErr);
                    })
                    .on('data', (row: any) => {
                        const idx = totalRows++;
                        if (idx < sampleRows) {
                            try {
                                const obj = this.mapRow(row, mapping);
                                this.validateMappedRow(obj, mapping);
                                preview.push({ row: idx, data: obj, error: null });
                                ok++;
                            } catch (e: any) {
                                preview.push({ row: idx, data: null, error: e.message });
                                err++;
                            }
                        }
                    })
                    .on('end', () => resolve());

                stream.pipe(parser);
            });
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
            sample: preview
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

        const push = (rowArr: any[]) => {
            totalFilas++;
            const v = String(rowArr?.[idx] ?? '').trim();
            if (v) valores.add(v);
        };

        if (remesa.archivo.match(/\.(xls|xlsx)$/i)) {
            const wb = xlsx.readFile(remesa.archivo, { cellDates: true, dateNF: 'yyyy-mm-dd' });
            const sheetName = hoja && wb.SheetNames.includes(hoja) ? hoja : wb.SheetNames[0];
            const rows: any[][] = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });
            for (let i = hasHeader ? 1 : 0; i < rows.length; i++) if (rows[i]?.length) push(rows[i]);
        } else {
            await new Promise<void>((resolve, reject) => {
                const parser = fastcsv.parse({ headers: hasHeader, delimiter: sep, trim: false });
                parser.on('error', reject)
                    .on('data', (row: any) => push(Array.isArray(row) ? row : Object.values(row)))
                    .on('end', () => resolve());
                fs.createReadStream(remesa.archivo!).pipe(parser);
            });
        }

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
        const { defaultEstadoSituacionId, defaultEstadoGestionId } = remesa.plantilla;
        const esAcciones = remesa.categoria === 'ACCIONES';
        if (!esAcciones && (!defaultEstadoSituacionId || !defaultEstadoGestionId)) {
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
            montoDeudorDesdeFacturas,
            modoActualizacion,
            comportamientoDeudaMayor,
            crearNuevosCasos,
            accionAusente,
            accionesConfig: mapping?.acciones,
        };

        const sep = resolveDelimiter(remesa.plantilla.separador ?? '|');
        const hasHeader = !!remesa.plantilla.tieneHeader;

        const BATCH_SIZE = IMPORTS_BATCH_SIZE;
        const batch: Array<{ row: any; idx: number }> = [];

        // MULTIRREGISTRO no es "una fila = un registro": el archivo trae varios tipos de línea que
        // hay que agrupar antes de procesar. El parser las convierte en filas ya normalizadas, así
        // que estas NO pasan por `mapRow` (que asume un array de columnas).
        const esMultirregistro = remesa.categoria === 'MULTIRREGISTRO';

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
            const validas: Array<{ row: any; idx: number; mapped: any }> = [];

            for (const { row, idx } of group) {
                try {
                    const obj = esMultirregistro ? (row as MappedRow) : this.mapRow(row, mapping);
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
                        validas.push({ row, idx, mapped: obj });
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
                        errorMsg: e.message ?? 'Error desconocido',
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
                        errorMsg: f.error,
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

        const isExcel = remesa.archivo.match(/\.(xls|xlsx)$/i);

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

        } else if (isExcel) {
            const workbook = xlsx.readFile(remesa.archivo, {
                cellDates: true,
                dateNF: 'yyyy-mm-dd'
            });
            const sheetName = remesa.hoja && workbook.SheetNames.includes(remesa.hoja) ? remesa.hoja : workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const excelRows: any[][] = xlsx.utils.sheet_to_json(worksheet, {
                header: 1,
                defval: '',
                raw: false
            });

            for (let i = hasHeader ? 1 : 0; i < excelRows.length; i++) {
                if (excelRows[i] && excelRows[i].length > 0) {
                    const idx = total++;
                    batch.push({ row: excelRows[i], idx });
                    
                    if (batch.length >= BATCH_SIZE) {
                        await processBatch();
                    }
                }
            }
            if (batch.length > 0) await processBatch();

        } else {
            const stream = fs.createReadStream(remesa.archivo);
            await new Promise<void>((resolve, reject) => {
                const parser = fastcsv.parse({ headers: hasHeader, delimiter: sep, trim: false });
                parser
                    .on("error", reject)
                    .on("data", (row: any) => {
                        const idx = total++;
                        batch.push({ row, idx });

                        if (batch.length >= BATCH_SIZE) {
                            parser.pause();
                            processBatch()
                                .then(() => parser.resume())
                                .catch(reject);
                        }
                    })
                    .on("end", async () => {
                        if (batch.length > 0) await processBatch();
                        resolve();
                    });

                stream.pipe(parser);
            });
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
    async listRemesas(empresaId: number, categoria?: string) {
        return this.prisma.remesa.findMany({
            where: {
                empresaId,
                ...(categoria ? { categoria: categoria as any } : {}),
            },
            orderBy: { createdAt: 'desc' },
            include: { plantilla: { select: { nombre: true } } },
        });
    }

    // --- POLÍTICA ---
    async updatePolitica(remesaId: number, politicaId: number | null) {
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
}