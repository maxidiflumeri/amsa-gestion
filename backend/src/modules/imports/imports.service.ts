// src/import/import.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { applyTransforms } from './transforms';
import { FileStorageService } from './file-storage.service';
import * as fs from 'fs';
import * as fastcsv from 'fast-csv';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';
import { MappingJson } from './mapping-types';

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

    // parsea N filas para preview/validación
    async validateRemesa(remesaId: number, sampleRows = 200) {
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: { plantilla: true }
        });

        if (!remesa || !remesa.archivo || !remesa.plantilla) {
            throw new NotFoundException('Remesa/archivo/plantilla no existe');
        }

        const mapping = remesa.plantilla.mappingJson as any;
        const sep = remesa.plantilla.separador ?? '|';
        const hasHeader = !!remesa.plantilla.tieneHeader;

        const rows: any[] = [];
        let ok = 0;
        let err = 0;

        const stream = fs.createReadStream(remesa.archivo);
        const parser = fastcsv.parse({
            headers: hasHeader,
            delimiter: sep,
            trim: false
        });

        // --- PROCESAR STREAM (OPTIMIZADO CON CHUNKS) ---
        await new Promise<void>((resolve, reject) => {

            let count = 0;

            parser
                .on('error', (err) => {
                    console.error("CSV ERROR:", err);
                    reject(err);
                })

                .on('data', (row: any) => {
                    rows.push(row);
                    count++;

                    // CORTAR LUEGO DE sampleRows FILAS
                    if (count >= sampleRows) {
                        stream.unpipe(parser);
                        parser.end(); // dispara "end" y "close"
                    }
                })

                .on('end', () => resolve())
                .on('close', () => resolve());

            stream.pipe(parser);
        });

        // --- PROCESAR MAPEOS Y VALIDACIÓN ---
        const preview: any[] = [];

        for (let idx = 0; idx < rows.length; idx++) {
            const row = rows[idx];

            try {
                const obj: any = {};

                // mapping por índice
                for (const [dest, cfg] of Object.entries(mapping.columns)) {
                    const index = (cfg as any).fromIndex;
                    const raw = Array.isArray(row) ? row[index] : row[index];
                    obj[dest] = applyTransforms(raw, (cfg as any).transforms);
                }

                Object.assign(obj, mapping.defaults ?? {});

                // Validaciones
                for (const v of (mapping.validations ?? [])) {
                    if (v.rule === 'required' &&
                        (obj[v.field] === null || obj[v.field] === undefined || obj[v.field] === '')) {
                        throw new Error(`Campo requerido faltante: ${v.field}`);
                    }
                }

                preview.push({ row: idx, data: obj, error: null });
                ok++;

            } catch (e: any) {
                preview.push({ row: idx, data: null, error: e.message });
                err++;
            }
        }

        await this.prisma.remesa.update({
            where: { id: remesaId },
            data: {
                estadoProceso: 'VALIDANDO',
                totalFilas: preview.length,
                okFilas: ok,
                errFilas: err
            }
        });

        return {
            total: preview.length,
            ok,
            err,
            sample: preview.slice(0, 50)
        };
    }

    // MVP: procesa todo en el hilo (luego lo pasamos a BullMQ)
    // --- REMESA / EJECUTAR ---
    async executeRemesa(remesaId: number) {

        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: { plantilla: true }
        });

        if (!remesa || !remesa.archivo || !remesa.plantilla) {
            throw new NotFoundException('Remesa/archivo/plantilla no existe');
        }

        // obtener ID de estado por defecto
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

        const stream = fs.createReadStream(remesa.archivo);

        await new Promise<void>((resolve, reject) => {
            const parser = fastcsv.parse({
                headers: hasHeader,
                delimiter: sep,
                trim: false
            });

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

            // -------------------------
            // PROCESS BATCH (WITH EXTRAS)
            // -------------------------
            const processBatch = async () => {
                const group = batch.splice(0, batch.length);

                for (const { row } of group) {
                    try {
                        const obj: any = {};                     // campos principales
                        const extrasObj: any = {};               // extras -> camposAdicionales

                        // ---------------------------
                        // MAPEO PRINCIPAL
                        // ---------------------------
                        for (const [dest, cfg] of Object.entries(mapping.columns)) {
                            const raw = Array.isArray(row)
                                ? row[cfg.fromIndex]
                                : row[cfg.fromIndex];

                            obj[dest] = applyTransforms(raw, cfg.transforms);
                        }

                        // ---------------------------
                        // MAPEO DE EXTRAS (JSON)
                        // ---------------------------
                        if (mapping.extras) {
                            for (const [name, cfg] of Object.entries(mapping.extras)) {
                                const raw = Array.isArray(row)
                                    ? row[cfg.fromIndex]
                                    : row[cfg.fromIndex];

                                extrasObj[name] = applyTransforms(raw, cfg.transforms);
                            }
                            obj.camposAdicionales = extrasObj;
                        }

                        // DEFAULTS
                        Object.assign(obj, mapping.defaults ?? {});

                        // VALIDACIONES
                        for (const v of (mapping.validations ?? [])) {
                            if (
                                v.rule === "required" &&
                                (obj[v.field] == null || obj[v.field] === "")
                            ) throw new Error(`Campo requerido faltante: ${v.field}`);
                        }

                        // ---------------------------
                        // PROCESO POR CATEGORÍA
                        // ---------------------------
                        if (remesa.categoria === 'DEUDORES') {

                            await this.prisma.deudor.upsert({
                                where: {
                                    empresaId_documento_remesaId: {
                                        empresaId: remesa.empresaId,
                                        documento: String(obj.documento),
                                        remesaId: remesa.id
                                    }
                                },
                                create: {
                                    empresaId: remesa.empresaId,
                                    remesaId: remesa.id,
                                    documento: String(obj.documento),
                                    nombre: obj.nombre ?? '',
                                    apellido: obj.apellido ?? '',
                                    montoTotal: obj.montoTotal ?? null,
                                    fechaVencimiento: obj.fechaVencimiento ?? null,
                                    camposAdicionales: obj.camposAdicionales ?? null,
                                    // valores por defecto
                                    estadoSituacionId: estadoSituacionDefault.id,
                                    estadoGestionId: estadoGestionDefault.id,
                                },
                                update: {
                                    nombre: obj.nombre ?? undefined,
                                    apellido: obj.apellido ?? undefined,
                                    montoTotal: obj.montoTotal ?? undefined,
                                    fechaVencimiento: obj.fechaVencimiento ?? undefined,
                                    camposAdicionales: obj.camposAdicionales ?? undefined,

                                    // NO cambiamos los estados por defecto al actualizar.
                                    // Esto mantiene histórico correcto.
                                }
                            });
                        }

                        else if (remesa.categoria === 'FACTURAS') {

                            const nroCliente = String(obj.nro_cliente ?? "").trim();
                            if (!nroCliente) throw new Error("nro_cliente no encontrado en factura");

                            const rows = await this.prisma.$queryRawUnsafe<{ id: number }[]>(`
                                SELECT id 
                                FROM deudor
                                WHERE empresaId = ${remesa.empresaId}
                                  AND remesaId = ${remesa.id}
                                  AND JSON_UNQUOTE(JSON_EXTRACT(camposAdicionales, '$.nro_cliente')) = '${nroCliente}'
                                LIMIT 1
                            `);

                            if (!rows.length) {
                                throw new Error(`Deudor no encontrado (nro_cliente=${nroCliente})`);
                            }

                            const deudor = rows[0]
                            
                            if (!deudor) {                                
                                throw new Error(`Deudor no encontrado (nro_cliente=${obj.nro_cliente})`);
                            }

                            console.log(deudor)

                            await this.prisma.factura.upsert({
                                where: {
                                    deudorId_nroFactura: {
                                        deudorId: deudor.id,
                                        nroFactura: String(obj.nroFactura)
                                    }
                                },
                                create: {
                                    deudorId: deudor.id,
                                    nroFactura: String(obj.nroFactura),
                                    importe: obj.importe ?? 0,
                                    fechaEmision: obj.fechaEmision ?? new Date(),
                                    vencimiento: obj.vencimiento ?? new Date()
                                },
                                update: {
                                    importe: obj.importe ?? undefined,
                                    fechaEmision: obj.fechaEmision ?? undefined,
                                    vencimiento: obj.vencimiento ?? undefined
                                }
                            });
                        }

                        ok++;

                    } catch (e) {       
                        console.log("ERROR PROCESSING ROW:", e);                 
                        err++;
                    }
                }

                await this.prisma.remesa.update({
                    where: { id: remesaId },
                    data: { totalFilas: total, okFilas: ok, errFilas: err }
                });
            };
        });

        return { total, ok, err };
    }

    async status(remesaId: number) {
        const r = await this.prisma.remesa.findUnique({ where: { id: remesaId } });
        if (!r) throw new NotFoundException();
        return r;
    }
}