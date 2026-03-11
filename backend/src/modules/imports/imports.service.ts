// src/import/import.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { applyTransforms } from './transforms';
import { FileStorageService } from './file-storage.service';
import * as fs from 'fs';
import * as fastcsv from 'fast-csv';
import * as xlsx from 'xlsx';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';
import { MappingJson } from './mapping-types';
import { getProcessor, getSupportedCategories } from './processors/processor-registry';
import { ProcessContext, MappedRow } from './processors/processor.interface';

@Injectable()
export class ImportService {
    private readonly logger = new Logger(ImportService.name);

    constructor(
        private prisma: PrismaService,
        private files: FileStorageService,
        @InjectQueue('import-queue') private importQueue: Queue,
    ) { }

    // --- PLANTILLAS ---
    async createPlantilla(dto: CreatePlantillaDto) {
        return this.prisma.plantillaimport.create({
            data: {
                empresaId: dto.empresaId,
                nombre: dto.nombre,
                categoria: dto.categoria as any,
                version: dto.version ?? 1,
                separador: dto.separador ?? '|',
                tieneHeader: dto.tieneHeader ?? false,
                mappingJson: dto.mappingJson,
            },
        });
    }

    async listPlantillas(empresaId: number, categoria?: string) {
        return this.prisma.plantillaimport.findMany({
            where: { empresaId, ...(categoria ? { categoria: categoria as any } : {}) },
            orderBy: [{ nombre: 'asc' }, { version: 'desc' }],
        });
    }

    async getPlantilla(id: number) {
        const p = await this.prisma.plantillaimport.findUnique({ where: { id } });
        if (!p) throw new NotFoundException('Plantilla no encontrada');
        return p;
    }

    async updatePlantilla(id: number, data: Partial<CreatePlantillaDto>) {
        const existing = await this.prisma.plantillaimport.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Plantilla no encontrada');

        return this.prisma.plantillaimport.update({
            where: { id },
            data: {
                ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
                ...(data.categoria !== undefined ? { categoria: data.categoria as any } : {}),
                ...(data.version !== undefined ? { version: data.version } : {}),
                ...(data.separador !== undefined ? { separador: data.separador } : {}),
                ...(data.tieneHeader !== undefined ? { tieneHeader: data.tieneHeader } : {}),
                ...(data.mappingJson !== undefined ? { mappingJson: data.mappingJson } : {}),
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
                delimiter: separador,
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

    // --- REMESA / ARCHIVO ---
    async createRemesa(dto: CreateRemesaDto, file: any) {

        const plantilla = await this.prisma.plantillaimport.findUnique({ where: { id: dto.plantillaId } });
        if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

        const saved = await this.files.saveBuffer(file, dto.empresaId, dto.categoria);
        const remesa = await this.prisma.remesa.create({
            data: {
                numeroRemesa: dto.numeroRemesa,
                empresaId: dto.empresaId,
                nombre: dto.nombre,
                categoria: dto.categoria as any,
                plantillaId: dto.plantillaId,
                archivo: saved.path,
                archivoHash: saved.hash,
                hoja: dto.hoja,
                estadoProceso: 'PENDIENTE',
            },
        });
        return { remesaId: remesa.id };
    }

    // --- PARSEAR FILAS (shared entre validate y execute) ---
    private mapRow(row: any, mapping: MappingJson): MappedRow {
        const obj: MappedRow = {};

        // Si fast-csv devuelve un objeto (tieneHeader=true), convertir a array
        const rowArr = Array.isArray(row) ? row : Object.values(row);

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
        const sep = remesa.plantilla.separador ?? '|';
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
                        console.error("CSV ERROR:", parseErr);
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

    // --- EJECUTAR (Encuela el trabajo en BullMQ) ---
    async executeRemesa(remesaId: number, remesaOrigenId?: number) {

        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
        });

        if (!remesa) {
            throw new NotFoundException('Remesa no existe');
        }

        if (!remesa.categoria) {
            throw new BadRequestException('La remesa no tiene categoría definida');
        }

        // Marcar como PENDIENTE (o equivalente a en cola)
        await this.prisma.remesa.update({
            where: { id: remesaId },
            data: { estadoProceso: 'PENDIENTE' }
        });

        // Encolar el trabajo
        await this.importQueue.add('process-import', {
            remesaId,
            remesaOrigenId,
        });

        return { message: 'Importación encolada correctamente', remesaId };
    }

    // --- WORKER DE IMPORTACIÓN LÓGICA PESADA ---
    async processImportJob(job: Job, remesaId: number, remesaOrigenId?: number) {
        
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: { plantilla: true }
        });

        if (!remesa || !remesa.archivo || !remesa.plantilla) {
            throw new Error('Remesa/archivo/plantilla no existe');
        }

        if (!remesa.categoria) {
            throw new Error('La remesa no tiene categoría definida');
        }

        // Obtener procesador para la categoría
        const processor = getProcessor(remesa.categoria);

        // Obtener estados por defecto asignados a la empresa
        const estadoSituacionDefault = await this.prisma.parametro.findFirst({
            where: { grupo: 'estadoSituacion', clave: 'ACTIVO', empresas: { some: { empresaId: remesa.empresaId } } },
            select: { id: true },
        });

        const estadoGestionDefault = await this.prisma.parametro.findFirst({
            where: { grupo: 'estadoGestion', clave: 'PENDIENTE', empresas: { some: { empresaId: remesa.empresaId } } },
            select: { id: true },
        });

        if (!estadoSituacionDefault || !estadoGestionDefault) {
            throw new Error("No se encontraron códigos por defecto para estado_situacion o estado_gestion");
        }

        const ctx: ProcessContext = {
            prisma: this.prisma,
            remesaId: remesa.id,
            empresaId: remesa.empresaId,
            remesaOrigenId,
            defaults: {
                estadoSituacionId: estadoSituacionDefault.id,
                estadoGestionId: estadoGestionDefault.id,
            },
        };

        const mapping = remesa.plantilla.mappingJson as unknown as MappingJson;
        const sep = remesa.plantilla.separador ?? '|';
        const hasHeader = !!remesa.plantilla.tieneHeader;

        let ok = 0, err = 0, total = 0;
        const BATCH_SIZE = 200;
        const batch: Array<{ row: any; idx: number }> = [];

        await this.prisma.remesa.update({
            where: { id: remesaId },
            data: { estadoProceso: 'PROCESANDO' }
        });

        // Limpiar errores previos de esta remesa
        await this.prisma.importerror.deleteMany({
            where: { remesaId }
        });

        const processBatch = async () => {
            const group = batch.splice(0, batch.length);
            const errorBatch: Array<{ remesaId: number; rowNumber: number; rawRow: any; errorMsg: string }> = [];

            for (const { row, idx } of group) {
                try {
                    const obj = this.mapRow(row, mapping);
                    this.validateMappedRow(obj, mapping);

                    if (processor.validateRow) {
                        const result = processor.validateRow(obj, ctx);
                        if (!result.valid) {
                            throw new Error(result.error ?? 'Validación de fila fallida');
                        }
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

            if (errorBatch.length > 0) {
                await this.prisma.importerror.createMany({ data: errorBatch });
            }

            await this.prisma.remesa.update({
                where: { id: remesaId },
                data: { totalFilas: total, okFilas: ok, errFilas: err }
            });
            
            if (total > 0 && total % 1000 === 0) {
                await job.updateProgress({ total, ok, err });
            }
        };

        const isExcel = remesa.archivo.match(/\.(xls|xlsx)$/i);

        if (isExcel) {
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
        return { total, ok, err };
    }

    // --- ESTADO ---
    async status(remesaId: number) {
        const r = await this.prisma.remesa.findUnique({ where: { id: remesaId } });
        if (!r) throw new NotFoundException();
        return r;
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
}