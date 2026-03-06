// src/import/import.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { applyTransforms } from './transforms';
import { FileStorageService } from './file-storage.service';
import * as fs from 'fs';
import * as fastcsv from 'fast-csv';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';
import { MappingJson } from './mapping-types';
import { getProcessor, getSupportedCategories } from './processors/processor-registry';
import { ProcessContext, MappedRow } from './processors/processor.interface';

@Injectable()
export class ImportService {
    constructor(
        private prisma: PrismaService,
        private files: FileStorageService,
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

    async previewFile(file: any, separador: string, tieneHeader: boolean, maxRows = 5) {
        const rows: any[] = [];

        const stream = require('stream');
        const bufferStream = new stream.PassThrough();
        bufferStream.end(file.buffer);

        const parser = fastcsv.parse({
            headers: false,
            delimiter: separador,
            trim: false,
            maxRows,
        });

        await new Promise<void>((resolve, reject) => {
            parser
                .on('error', reject)
                .on('data', (row: any) => rows.push(row))
                .on('end', () => resolve());

            bufferStream.pipe(parser);
        });

        return {
            totalColumns: rows.length > 0 ? rows[0].length : 0,
            rows,
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
            const raw = rowArr[cfg.fromIndex];
            obj[dest] = applyTransforms(raw, cfg.transforms);
        }

        // Mapeo de extras → camposAdicionales (JSON)
        if (mapping.extras) {
            const extrasObj: Record<string, any> = {};
            for (const [name, cfg] of Object.entries(mapping.extras)) {
                const raw = rowArr[cfg.fromIndex];
                extrasObj[name] = applyTransforms(raw, cfg.transforms);
            }
            obj.camposAdicionales = extrasObj;
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
    async validateRemesa(remesaId: number, sampleRows = 50) {
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

        const stream = fs.createReadStream(remesa.archivo);
        const parser = fastcsv.parse({
            headers: hasHeader,
            delimiter: sep,
            trim: false
        });

        // Leer TODAS las filas: contar total, mapear solo las primeras sampleRows
        await new Promise<void>((resolve, reject) => {
            parser
                .on('error', (parseErr) => {
                    console.error("CSV ERROR:", parseErr);
                    reject(parseErr);
                })
                .on('data', (row: any) => {
                    const idx = totalRows++;

                    // Solo mapeamos/validamos las primeras sampleRows para el preview
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

    // --- EJECUTAR ---
    async executeRemesa(remesaId: number, remesaOrigenId?: number) {

        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: { plantilla: true }
        });

        if (!remesa || !remesa.archivo || !remesa.plantilla) {
            throw new NotFoundException('Remesa/archivo/plantilla no existe');
        }

        if (!remesa.categoria) {
            throw new BadRequestException('La remesa no tiene categoría definida');
        }

        // Obtener procesador para la categoría
        const processor = getProcessor(remesa.categoria);

        // Obtener estados por defecto
        const estadoSituacionDefault = await this.prisma.parametro.findFirst({
            where: { grupo: 'estadoSituacion', clave: 'ACTIVO', empresaId: remesa.empresaId },
            select: { id: true },
        });

        const estadoGestionDefault = await this.prisma.parametro.findFirst({
            where: { grupo: 'estadoGestion', clave: 'PENDIENTE', empresaId: remesa.empresaId },
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

        const stream = fs.createReadStream(remesa.archivo);

        await new Promise<void>((resolve, reject) => {
            const parser = fastcsv.parse({
                headers: hasHeader,
                delimiter: sep,
                trim: false
            });

            const processBatch = async () => {
                const group = batch.splice(0, batch.length);
                const errorBatch: Array<{ remesaId: number; rowNumber: number; rawRow: any; errorMsg: string }> = [];

                for (const { row, idx } of group) {
                    try {
                        const obj = this.mapRow(row, mapping);
                        this.validateMappedRow(obj, mapping);

                        // Validación específica del procesador
                        if (processor.validateRow) {
                            const result = processor.validateRow(obj, ctx);
                            if (!result.valid) {
                                throw new Error(result.error ?? 'Validación de fila fallida');
                            }
                        }

                        // Procesar la fila
                        await processor.processRow(obj, ctx);
                        ok++;

                    } catch (e: any) {
                        err++;
                        // Registrar error para esta fila
                        errorBatch.push({
                            remesaId,
                            rowNumber: idx,
                            rawRow: Array.isArray(row) ? row : Object.values(row),
                            errorMsg: e.message ?? 'Error desconocido',
                        });
                    }
                }

                // Guardar errores en batch
                if (errorBatch.length > 0) {
                    await this.prisma.importerror.createMany({
                        data: errorBatch,
                    });
                }

                // Actualizar progreso
                await this.prisma.remesa.update({
                    where: { id: remesaId },
                    data: { totalFilas: total, okFilas: ok, errFilas: err }
                });
            };

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

                    await this.prisma.remesa.update({
                        where: { id: remesaId },
                        data: {
                            estadoProceso: 'FINALIZADA',
                            totalFilas: total,
                            okFilas: ok,
                            errFilas: err
                        }
                    });

                    resolve();
                });

            stream.pipe(parser);
        });

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