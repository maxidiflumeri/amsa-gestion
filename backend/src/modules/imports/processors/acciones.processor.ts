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

const CLAVE_SIT_CANCELADO = 'SIT-050';

type SnapshotRow = {
    remesaId: number;
    entidad: string;
    entidadId: number;
    accion: string;
    datosPrevios?: Record<string, any>;
};

export class AccionesProcessor implements ICategoryProcessor {
    readonly category = 'ACCIONES';
    private readonly logger = new Logger(AccionesProcessor.name);

    private snapshots: SnapshotRow[] = [];
    private deudoresAfectados = new Set<number>();
    private comentariosCreados = 0;
    private contactosEliminados = 0;
    private saltadosCancelados = 0;
    private sinMatch = 0;
    /** cache clave de parámetro → id (para SET_* por columna). */
    private paramCache = new Map<string, number | null>();

    private reset(): void {
        this.snapshots = [];
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

    /** Borra los contactos que matchean `where`, grabando snapshot de cada uno (para el undo). */
    private async eliminarContactos(where: any, ctx: ProcessContext): Promise<number> {
        const contactos = await ctx.prisma.contacto.findMany({ where });
        if (!contactos.length) return 0;
        for (const c of contactos) {
            this.snapshots.push({
                remesaId: ctx.remesaId, entidad: 'contacto', entidadId: c.id, accion: 'DELETE',
                datosPrevios: {
                    deudorId: c.deudorId, tipo: c.tipo, valor: c.valor, subtipo: c.subtipo,
                    prioridad: c.prioridad, validado: c.validado, whatsapp: c.whatsapp,
                },
            });
        }
        await ctx.prisma.contacto.deleteMany({ where: { id: { in: contactos.map(c => c.id) } } });
        this.contactosEliminados += contactos.length;
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

    private async resolveParametroId(op: any, row: MappedRow, ctx: ProcessContext): Promise<number | null> {
        if (op.modo === 'ESTATICO') return op.parametroId ?? null;
        const clave = this.raw(row, op.fromIndex);
        if (!clave) return null;
        if (this.paramCache.has(clave)) return this.paramCache.get(clave)!;
        const p = await ctx.prisma.parametro.findUnique({ where: { clave }, select: { id: true } });
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
        const cfg = ctx.accionesConfig;
        if (!cfg) throw new Error('ACCIONES sin configuración (mappingJson.acciones)');

        // ── Modo CONTACTO: limpieza global de un teléfono/email de toda la base ──
        if (cfg.matchMode === 'CONTACTO') {
            const cv = cfg.contactoValor;
            if (!cv) return;
            const valor = this.raw(row, cv.fromIndex);
            const candidatos = this.valoresCandidatos(cv.tipo, valor);
            if (!candidatos.length) return;
            const deudorWhere: any = { empresaId: ctx.empresaId };
            if (ctx.remesaOrigenId) deudorWhere.remesaId = ctx.remesaOrigenId;
            const borrados = await this.eliminarContactos(
                { tipo: cv.tipo, valor: { in: candidatos }, deudor: deudorWhere }, ctx,
            );
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
                estadoSituacion: { select: { clave: true } },
            },
        });

        if (!deudores.length) { this.sinMatch++; return; }

        for (const d of deudores) {
            if (cfg.saltearCanceladas && d.estadoSituacion?.clave === CLAVE_SIT_CANCELADO) {
                this.saltadosCancelados++;
                continue;
            }
            await this.aplicarOperaciones(d, row, cfg, ctx);
        }
    }

    private async aplicarOperaciones(d: any, row: MappedRow, cfg: AccionesConfig, ctx: ProcessContext): Promise<void> {
        const updateData: Record<string, any> = {};
        const prevData: Record<string, any> = {};
        let toco = false;

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
                    const pid = await this.resolveParametroId(op, row, ctx);
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
                    const c = await ctx.prisma.comentario.create({
                        data: { deudorId: d.id, usuarioId: ctx.usuarioId ?? null, texto, origen: 'ACCION_MASIVA' },
                        select: { id: true },
                    });
                    this.snapshots.push({ remesaId: ctx.remesaId, entidad: 'comentario', entidadId: c.id, accion: 'INSERT' });
                    this.comentariosCreados++;
                    toco = true;
                    break;
                }
                case 'DELETE_CONTACTO': {
                    const valor = this.valorTexto(op, row);
                    const candidatos = this.valoresCandidatos(op.contactoTipo, valor);
                    if (!candidatos.length) break;
                    const where: any = { deudorId: d.id, valor: { in: candidatos } };
                    if (op.contactoTipo !== 'cualquiera') where.tipo = op.contactoTipo;
                    const borrados = await this.eliminarContactos(where, ctx);
                    if (borrados > 0) toco = true;
                    break;
                }
            }
        }

        if (Object.keys(updateData).length) {
            await ctx.prisma.deudor.update({ where: { id: d.id }, data: updateData });
            this.snapshots.push({ remesaId: ctx.remesaId, entidad: 'deudor', entidadId: d.id, accion: 'UPDATE', datosPrevios: prevData });
            toco = true;
        }
        if (toco) this.deudoresAfectados.add(d.id);
    }

    async afterAll(ctx: ProcessContext): Promise<void> {
        // Flush de snapshots (para el undo).
        const CHUNK = 500;
        for (let i = 0; i < this.snapshots.length; i += CHUNK) {
            const chunk = this.snapshots.slice(i, i + CHUNK);
            await ctx.prisma.accion_masiva_snapshot.createMany({
                data: chunk.map(s => ({
                    remesaId: s.remesaId,
                    entidad: s.entidad,
                    entidadId: s.entidadId,
                    accion: s.accion,
                    datosPrevios: s.datosPrevios === undefined ? Prisma.JsonNull : (s.datosPrevios as Prisma.InputJsonValue),
                })),
            });
        }

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

        this.logger.log(
            `ACCIONES remesa=${ctx.remesaId}: ${this.deudoresAfectados.size} deudores afectados, ` +
            `${this.comentariosCreados} comentarios, ${this.contactosEliminados} contactos eliminados, ` +
            `${this.saltadosCancelados} cancelados salteados, ${this.sinMatch} filas sin match.`,
        );
        this.reset();
    }
}
