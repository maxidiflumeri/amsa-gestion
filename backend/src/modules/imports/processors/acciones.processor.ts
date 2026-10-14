// processors/acciones.processor.ts
//
// Categoría ACCIONES (acciones masivas): aplica un catálogo CERRADO de operaciones a
// los deudores matcheados por un listado, grabando un snapshot de cada cambio para
// poder revertir (undo). Modo DEUDOR: operaciones SET_* / SET_ADICIONALES / ADD_COMENTARIO /
// DELETE_CONTACTO. Modo CONTACTO: limpieza global de un teléfono/email de toda la base.
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { AccionesConfig, AccionOperacion } from '../mapping-types';
import { mergeAdicionales } from '../utils/campos-adicionales';
import { normalizarTelefonoArgentino } from '../../../common/utils/phone-utils';
import { AuditEstado, AuditModulo, AuditSeveridad, AuditTipo } from '../../transacciones/audit.enums';
import { idsSituacionCancelada } from '../utils/situaciones-cerradas';

type SnapshotRow = {
    remesaId: number;
    deudorId: number;
    entidad: string;
    entidadId: number;
    accion: string;
    datosPrevios?: Record<string, any>;
};

/** Cliente de la transacción de un caso: lo único con lo que se escribe adentro de `conCaso`. */
type Db = Prisma.TransactionClient;

/** Lo que acumula un caso mientras su transacción corre; se suma a los contadores recién después del commit. */
type BufferCaso = {
    snapshots: SnapshotRow[];
    comentarios: number;
    contactos: number;
    toco: boolean;
};

const TX_CASO = { maxWait: 10_000, timeout: 30_000 } as const;
/** Deadlock o conflicto de escritura de Prisma: se reintenta una vez, el caso hizo rollback entero. */
const CODIGO_CONFLICTO = 'P2034';

export class AccionesProcessor implements ICategoryProcessor {
    readonly category = 'ACCIONES';
    private readonly logger = new Logger(AccionesProcessor.name);

    /** La remesa ya se marcó con `accionSnapshotsPorCaso` (una vez por carga, antes de la primera escritura). */
    private marcada = false;
    private deudoresAfectados = new Set<number>();
    private comentariosCreados = 0;
    private contactosEliminados = 0;
    private saltadosCancelados = 0;
    private sinMatch = 0;
    /** cache clave de parámetro → id (para SET_* por columna). */
    private paramCache = new Map<string, number | null>();

    private reset(): void {
        this.marcada = false;
        this.deudoresAfectados = new Set();
        this.comentariosCreados = 0;
        this.contactosEliminados = 0;
        this.saltadosCancelados = 0;
        this.sinMatch = 0;
        this.paramCache.clear();
    }

    /** Valores candidatos con los que puede estar guardado un contacto (normalizado como en el import). */
    private valoresCandidatos(tipo: string, valor: string): string[] {
        const raw = String(valor).trim();
        if (!raw) return [];
        const set = new Set<string>([raw]);
        if (tipo === 'telefono' || tipo === 'cualquiera') {
            const n = normalizarTelefonoArgentino(raw);
            if (n.valido && n.e164) set.add(n.e164);
        }
        if (tipo === 'email' || tipo === 'cualquiera') set.add(raw.toLowerCase());
        return [...set];
    }

    /**
     * Corre `fn` en una transacción propia del caso: los cambios y sus snapshots se confirman juntos o no se confirma
     * nada (C3b). Un deadlock se reintenta una vez; cualquier otro error sube y el caso queda sin tocar. Los contadores
     * se suman después del commit: un caso que hizo rollback no cuenta.
     */
    private async conCaso<T>(ctx: ProcessContext, fn: (db: Db, buf: BufferCaso) => Promise<T>): Promise<T> {
        for (let intento = 1; ; intento++) {
            const buf: BufferCaso = { snapshots: [], comentarios: 0, contactos: 0, toco: false };
            try {
                const resultado = await ctx.prisma.$transaction(async (tx) => {
                    const r = await fn(tx, buf);
                    if (buf.snapshots.length) {
                        await tx.accion_masiva_snapshot.createMany({
                            data: buf.snapshots.map(s => ({
                                remesaId: s.remesaId,
                                deudorId: s.deudorId,
                                entidad: s.entidad,
                                entidadId: s.entidadId,
                                accion: s.accion,
                                datosPrevios: s.datosPrevios === undefined ? Prisma.JsonNull : (s.datosPrevios as Prisma.InputJsonValue),
                            })),
                        });
                    }
                    return r;
                }, TX_CASO);
                this.comentariosCreados += buf.comentarios;
                this.contactosEliminados += buf.contactos;
                return resultado;
            } catch (e: any) {
                if (e?.code === CODIGO_CONFLICTO && intento === 1) {
                    this.logger.warn(`ACCIONES remesa=${ctx.remesaId}: conflicto de escritura en un caso, se reintenta una vez`);
                    continue;
                }
                throw e;
            }
        }
    }

    /** Antes de la primera escritura: lo que esta carga aplique queda cubierto por sus snapshots. */
    private async marcarSnapshotsPorCaso(ctx: ProcessContext): Promise<void> {
        if (this.marcada) return;
        await ctx.prisma.remesa.update({ where: { id: ctx.remesaId }, data: { accionSnapshotsPorCaso: true } });
        this.marcada = true;
    }

    /** Borra los contactos que matchean `where`, grabando snapshot de cada uno (para el undo). */
    private async eliminarContactos(where: any, ctx: ProcessContext, db: Db, buf: BufferCaso): Promise<number> {
        const contactos = await db.contacto.findMany({ where });
        if (!contactos.length) return 0;
        for (const c of contactos) {
            buf.snapshots.push({
                remesaId: ctx.remesaId, deudorId: c.deudorId, entidad: 'contacto', entidadId: c.id, accion: 'DELETE',
                datosPrevios: {
                    deudorId: c.deudorId, tipo: c.tipo, valor: c.valor, subtipo: c.subtipo,
                    prioridad: c.prioridad, validado: c.validado, whatsapp: c.whatsapp,
                },
            });
        }
        await db.contacto.deleteMany({ where: { id: { in: contactos.map(c => c.id) } } });
        buf.contactos += contactos.length;
        return contactos.length;
    }

    private parseFloatSafe(val: any): number | null {
        if (val === null || val === undefined || val === '') return null;
        const n = parseFloat(String(val).replace(/[^\d.,-]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.'));
        return isNaN(n) ? null : n;
    }

    private parseDateSafe(val: any): Date | null {
        if (!val) return null;
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }

    private raw(row: MappedRow, fromIndex?: number): string {
        if (fromIndex === undefined || fromIndex === null) return '';
        return String(row._raw?.[fromIndex] ?? '').trim();
    }

    /** Valor textual de una operación (texto fijo, una columna, o plantilla con variables). */
    private valorTexto(op: any, row: MappedRow): string {
        // Plantilla de texto libre: cada {{colN}} se reemplaza por el valor de la columna N.
        if (op.modo === 'PLANTILLA') {
            return String(op.plantilla ?? '')
                .replace(/\{\{\s*col\s*(\d+)\s*\}\}/gi, (_m: string, idx: string) => this.raw(row, Number(idx)))
                .trim();
        }
        if (op.modo === 'COLUMNA') return this.raw(row, op.fromIndex);
        return String(op.valor ?? op.texto ?? '').trim();
    }

    private async resolveParametroId(op: any, row: MappedRow, db: Db): Promise<number | null> {
        if (op.modo === 'ESTATICO') return op.parametroId ?? null;
        const clave = this.raw(row, op.fromIndex);
        if (!clave) return null;
        if (this.paramCache.has(clave)) return this.paramCache.get(clave)!;
        const p = await db.parametro.findUnique({ where: { clave }, select: { id: true } });
        const id = p?.id ?? null;
        this.paramCache.set(clave, id);
        return id;
    }

    validateRow(row: MappedRow, ctx: ProcessContext): RowValidationResult {
        const cfg = ctx.accionesConfig;
        if (!cfg) return { valid: false, error: 'La plantilla de acciones no tiene configuración' };
        if (cfg.matchMode === 'CONTACTO') {
            if (!cfg.contactoValor) return { valid: false, error: 'Falta la columna del contacto a eliminar' };
            if (!this.raw(row, cfg.contactoValor.fromIndex)) return { valid: false, error: 'Fila sin valor de contacto' };
            return { valid: true };
        }
        if (!cfg.operaciones?.length) {
            return { valid: false, error: 'La plantilla de acciones no tiene operaciones configuradas' };
        }
        if (!cfg.matchColumn) return { valid: false, error: 'Falta la columna de match (nro_cliente/documento/id)' };
        if (!this.raw(row, cfg.matchColumn.fromIndex)) {
            return { valid: false, error: `Fila sin ${cfg.matchColumn.field}` };
        }
        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        try {
            await this.procesarFila(row, ctx);
        } finally {
            // La fila sale por varios `return` (sin match, cancelado salteado) y por excepciones: se informa en todos.
            this.informarResumen(ctx);
        }
    }

    /** Lo que hizo la carga hasta ahora (C3a). Solo memoria: no escribe nada. */
    private informarResumen(ctx: ProcessContext): void {
        ctx.progreso?.resumen({
            tipo: 'ACCIONES',
            deudoresAfectados: this.deudoresAfectados.size,
            comentariosCreados: this.comentariosCreados,
            contactosEliminados: this.contactosEliminados,
            saltadosCancelados: this.saltadosCancelados,
            filasSinMatch: this.sinMatch,
        });
    }

    private async procesarFila(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const cfg = ctx.accionesConfig;
        if (!cfg) throw new Error('ACCIONES sin configuración (mappingJson.acciones)');
        await this.marcarSnapshotsPorCaso(ctx);

        // ── Modo CONTACTO: limpieza global de un teléfono/email de toda la base ──
        if (cfg.matchMode === 'CONTACTO') {
            const cv = cfg.contactoValor;
            if (!cv) return;
            const valor = this.raw(row, cv.fromIndex);
            const candidatos = this.valoresCandidatos(cv.tipo, valor);
            if (!candidatos.length) return;
            const deudorWhere: any = { empresaId: ctx.empresaId };
            if (ctx.remesaOrigenId) deudorWhere.remesaId = ctx.remesaOrigenId;
            const borrados = await this.conCaso(ctx, (db, buf) => this.eliminarContactos(
                { tipo: cv.tipo, valor: { in: candidatos }, deudor: deudorWhere }, ctx, db, buf,
            ));
            if (borrados === 0) this.sinMatch++;
            return;
        }

        const mc = cfg.matchColumn!;
        const matchVal = this.raw(row, mc.fromIndex);
        if (!matchVal) return;

        // Scope opcional a una remesa (ctx.remesaOrigenId). Sin scope = toda la empresa.
        const base: any = { empresaId: ctx.empresaId };
        if (ctx.remesaOrigenId) base.remesaId = ctx.remesaOrigenId;

        let where: any;
        if (mc.field === 'documento') where = { ...base, documento: matchVal };
        else if (mc.field === 'id') {
            const idNum = Number(matchVal);
            if (!Number.isInteger(idNum)) { this.sinMatch++; return; }
            where = { ...base, id: idNum };
        } else where = { ...base, nroCliente: matchVal };

        const deudores = await ctx.prisma.deudor.findMany({
            where,
            select: {
                id: true, estadoSituacionId: true, estadoGestionId: true, motivoNoPagoId: true,
                nombre: true, apellido: true, montoTotal: true, fechaVencimiento: true, nroCliente: true,
                camposAdicionales: true,
            },
        });

        if (!deudores.length) { this.sinMatch++; return; }

        // Categoría CANCELADO completa, no solo SIT-050: un caso cancelado con quita (SIT-054,
        // multiclaves) es tan "cancelado" como uno en SIT-050/051/052/053. Ver
        // docs/multiclaves-spec.md §10.7.
        const idsCancelado = cfg.saltearCanceladas ? await idsSituacionCancelada(ctx.prisma) : [];

        for (const d of deudores) {
            if (cfg.saltearCanceladas && d.estadoSituacionId != null && idsCancelado.includes(d.estadoSituacionId)) {
                this.saltadosCancelados++;
                continue;
            }
            // Una transacción por caso: sus cambios y sus snapshots se confirman juntos.
            const toco = await this.conCaso(ctx, (db, buf) => this.aplicarOperaciones(d, row, cfg, ctx, db, buf));
            if (toco) this.deudoresAfectados.add(d.id);
        }
    }

    /** Aplica las operaciones a un caso. Adentro de la transacción solo se escribe con `db`, nunca con `ctx.prisma`. */
    private async aplicarOperaciones(
        d: any, row: MappedRow, cfg: AccionesConfig, ctx: ProcessContext, db: Db, buf: BufferCaso,
    ): Promise<boolean> {
        const updateData: Record<string, any> = {};
        const prevData: Record<string, any> = {};

        const setCampo = (campo: string, nuevo: any, previoRaw: any) => {
            updateData[campo] = nuevo;
            if (!(campo in prevData)) {
                prevData[campo] = previoRaw instanceof Date ? previoRaw.toISOString() : previoRaw ?? null;
            }
        };

        for (const op of cfg.operaciones) {
            switch (op.tipo) {
                case 'SET_SITUACION':
                case 'SET_GESTION':
                case 'SET_MOTIVO': {
                    const campo = op.tipo === 'SET_SITUACION' ? 'estadoSituacionId'
                        : op.tipo === 'SET_GESTION' ? 'estadoGestionId' : 'motivoNoPagoId';
                    const pid = await this.resolveParametroId(op, row, db);
                    if (pid == null) { this.logger.warn(`Deudor ${d.id}: no se resolvió el parámetro de ${op.tipo}`); break; }
                    if (d[campo] !== pid) setCampo(campo, pid, d[campo]);
                    break;
                }
                case 'SET_CAMPO': {
                    const val = this.valorTexto(op, row);
                    if (!val) break;
                    let nuevo: any = val;
                    if (op.campo === 'montoTotal') { const n = this.parseFloatSafe(val); if (n == null) break; nuevo = n; }
                    else if (op.campo === 'fechaVencimiento') { const dt = this.parseDateSafe(val); if (!dt) break; nuevo = dt; }
                    const actual = d[op.campo];
                    const igual = op.campo === 'fechaVencimiento'
                        ? (actual && nuevo && new Date(actual).getTime() === (nuevo as Date).getTime())
                        : actual === nuevo;
                    if (!igual) setCampo(op.campo, nuevo, actual);
                    break;
                }
                case 'SET_ADICIONALES': {
                    const nuevos: Record<string, any> = {};
                    for (const c of (op.columnas ?? [])) {
                        const v = this.raw(row, c.fromIndex);
                        if (v) nuevos[c.nombre] = v;
                    }
                    if (Object.keys(nuevos).length) {
                        const merged = mergeAdicionales(d.camposAdicionales, nuevos);
                        setCampo('camposAdicionales', merged, d.camposAdicionales ?? null);
                    }
                    break;
                }
                case 'ADD_COMENTARIO': {
                    const texto = this.valorTexto(op, row);
                    if (!texto) break;
                    const c = await db.comentario.create({
                        data: { deudorId: d.id, usuarioId: ctx.usuarioId ?? null, texto, origen: 'ACCION_MASIVA' },
                        select: { id: true },
                    });
                    buf.snapshots.push({ remesaId: ctx.remesaId, deudorId: d.id, entidad: 'comentario', entidadId: c.id, accion: 'INSERT' });
                    buf.comentarios++;
                    buf.toco = true;
                    break;
                }
                case 'DELETE_CONTACTO': {
                    const valor = this.valorTexto(op, row);
                    const candidatos = this.valoresCandidatos(op.contactoTipo, valor);
                    if (!candidatos.length) break;
                    const where: any = { deudorId: d.id, valor: { in: candidatos } };
                    if (op.contactoTipo !== 'cualquiera') where.tipo = op.contactoTipo;
                    const borrados = await this.eliminarContactos(where, ctx, db, buf);
                    if (borrados > 0) buf.toco = true;
                    break;
                }
            }
        }

        if (Object.keys(updateData).length) {
            await db.deudor.update({ where: { id: d.id }, data: updateData });
            buf.snapshots.push({ remesaId: ctx.remesaId, deudorId: d.id, entidad: 'deudor', entidadId: d.id, accion: 'UPDATE', datosPrevios: prevData });
            buf.toco = true;
        }
        return buf.toco;
    }

    async afterAll(ctx: ProcessContext): Promise<void> {
        // Una ACCIONES de C3b no puede terminar con `errorPostProceso` por la auditoría: lo aplicado ya tiene sus
        // snapshots (se escribieron con cada caso), así que un fallo acá no le quita nada a Revertir.
        try {
            await this.auditar(ctx);
        } catch (e: any) {
            this.logger.warn(`ACCIONES remesa=${ctx.remesaId}: no se pudo registrar la auditoría: ${e?.message}`);
        }

        this.logger.log(
            `ACCIONES remesa=${ctx.remesaId}: ${this.deudoresAfectados.size} deudores afectados, ` +
            `${this.comentariosCreados} comentarios, ${this.contactosEliminados} contactos eliminados, ` +
            `${this.saltadosCancelados} cancelados salteados, ${this.sinMatch} filas sin match.`,
        );
        this.informarResumen(ctx);
        this.reset();
    }

    private async auditar(ctx: ProcessContext): Promise<void> {
        await ctx.auditoria.log({
            modulo: AuditModulo.IMPORT,
            entidad: 'acciones_masivas',
            tipo: AuditTipo.IMPORT_OK,
            severidad: AuditSeveridad.INFO,
            estado: AuditEstado.OK,
            usuarioId: ctx.usuarioId ?? null,
            empresaId: ctx.empresaId,
            entidadId: ctx.remesaId,
            resumen: ctx.accionesConfig?.matchMode === 'CONTACTO'
                ? `Acciones masivas: ${this.contactosEliminados} contactos eliminados`
                : `Acciones masivas: ${this.deudoresAfectados.size} deudores afectados`,
            data: {
                matchMode: ctx.accionesConfig?.matchMode,
                operaciones: (ctx.accionesConfig?.operaciones ?? []).map((o: AccionOperacion) => o.tipo),
                deudoresAfectados: this.deudoresAfectados.size,
                comentariosCreados: this.comentariosCreados,
                contactosEliminados: this.contactosEliminados,
                saltadosCancelados: this.saltadosCancelados,
                filasSinMatch: this.sinMatch,
            },
        });
    }
}
