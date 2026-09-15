/**
 * `CuponService` — generar cupón (spec §8), sólo la acción DESCARGAR en esta fase 2. El envío por
 * mail (`ENVIAR`/`DESCARGAR_Y_ENVIAR`, variables propias, chequeo de variables vacías, guardar
 * contacto) es la fase 3: acá esas dos acciones cortan con 400 `ACCION_NO_DISPONIBLE` — ver el
 * desvío anotado en el CHANGELOG de la fase 2.
 *
 * Orden de `generar()` (§8.1): valida caso/clave → bloqueo → vencida/reemplazada → genera el PDF
 * ANTES de escribir nada (si falla, no queda un convenio sin cupón) → transacción interactiva con
 * `SELECT … FOR UPDATE` sobre las claves del trámite (serializa dos clics/operadores) → reusa o crea
 * el convenio → cambia la gestión → comenta → consolida.
 */
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DeudorBloqueoService } from '../deudores/utils/deudor-bloqueo';
import { ConsolidacionSituacionService } from '../consolidacion/consolidacion.service';
import { CuponPdfService, DatosCupon, calcularVtoImpreso, esClaveVencida } from './cupon-pdf.service';
import { centavosDeTexto, formatoImporteCupon } from './utils/clave-pago';
import { ConfigMulticlaves, resolverConfigMulticlaves } from './utils/config-multiclaves';
import { AccionCupon, GenerarCuponDto } from './dto/generar-cupon.dto';

/** Lo que el guard de permisos ya adjuntó al request (`request['usuario']`, ver `PermisosGuard`). */
export interface UsuarioJwt {
    sub: number;
    email?: string;
    permisos: string[];
}

export interface GenerarCuponRespuesta {
    convenioId: number;
    convenioReusado: boolean;
    convenioAnuladoId: number | null;
    gestionCambiada: boolean;
    comentarioId: number;
    /** Fase 3: siempre `null` hasta que exista el envío por mail. */
    envio: null;
    descargaUrl: string;
}

const ORIGEN_CLAVE_PAGO = 'CLAVE_PAGO';
const TIMEOUT_TRANSACCION_MS = 10_000;

function esAr(monto: number): string {
    return monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nombreLegible(deudor: { nombre: string; apellido: string }): string {
    return `${deudor.apellido ?? ''} ${deudor.nombre ?? ''}`.replace(/\s+/g, ' ').trim();
}

function centavosDeClave(importe: unknown): number {
    // `importe` es un `Decimal` de Prisma (schema §4.1): se pasa por texto, nunca por
    // `Number(...) * 100` — la misma regla que el parser (evita el float de 1988000.9999...).
    const centavos = centavosDeTexto(String(importe));
    if (centavos === null) {
        throw new BadRequestException({
            code: 'CLAVE_IMPORTE_INVALIDO',
            message: 'El importe de la clave tiene un formato inesperado.',
        });
    }
    return centavos;
}

type ClaveConEmpresa = {
    id: number;
    empresaId: number;
    nroTramite: string;
    nroConvenio: string;
    tipo: string;
    importe: unknown;
    saldoTramite: unknown;
    fechaVencimiento: Date;
    clavePago: string;
    codigoBarras: string;
    estado: string;
};

type DeudorParaCupon = {
    id: number;
    empresaId: number;
    nroCliente: string | null;
    nombre: string;
    apellido: string;
    estadoSituacionId: number | null;
    estadoGestionId: number | null;
};

@Injectable()
export class CuponService {
    private readonly logger = new Logger(CuponService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly bloqueo: DeudorBloqueoService,
        private readonly cuponPdf: CuponPdfService,
        private readonly consolidacion: ConsolidacionSituacionService,
    ) {}

    // ─── Carga y validaciones comunes ──────────────────────────────────────────

    private async cargarClave(claveId: number): Promise<ClaveConEmpresa> {
        const clave = await this.prisma.clave_pago.findUnique({ where: { id: claveId } });
        if (!clave) {
            throw new NotFoundException({ code: 'CLAVE_NO_ENCONTRADA', message: `Clave de pago ${claveId} no encontrada.` });
        }
        return clave;
    }

    private async cargarDeudor(deudorId: number): Promise<DeudorParaCupon> {
        const deudor = await this.prisma.deudor.findUnique({
            where: { id: deudorId },
            select: {
                id: true,
                empresaId: true,
                nroCliente: true,
                nombre: true,
                apellido: true,
                estadoSituacionId: true,
                estadoGestionId: true,
            },
        });
        if (!deudor) {
            throw new NotFoundException({ code: 'DEUDOR_NO_ENCONTRADO', message: `Deudor ${deudorId} no encontrado.` });
        }
        return deudor;
    }

    private asegurarCorrespondencia(clave: ClaveConEmpresa, deudor: DeudorParaCupon): void {
        const tramiteDeudor = (deudor.nroCliente ?? '').trim();
        if (clave.empresaId !== deudor.empresaId || clave.nroTramite !== tramiteDeudor) {
            this.logger.warn(
                `CLAVE_NO_CORRESPONDE claveId=${clave.id} deudorId=${deudor.id} (nroTramite clave=${clave.nroTramite})`,
            );
            throw new BadRequestException({
                code: 'CLAVE_NO_CORRESPONDE',
                message: 'La clave no corresponde al trámite de este caso.',
            });
        }
    }

    private async cargarConfig(empresaId: number): Promise<ConfigMulticlaves> {
        const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { configuracion: true } });
        return resolverConfigMulticlaves(empresa?.configuracion);
    }

    private datosCupon(clave: ClaveConEmpresa, deudor: DeudorParaCupon, cfg: ConfigMulticlaves, vistaPrevia: boolean): DatosCupon {
        return {
            importeCentavos: centavosDeClave(clave.importe),
            codigoBarras: clave.codigoBarras,
            nroConvenio: clave.nroConvenio,
            fechaVencimiento: clave.fechaVencimiento.toISOString().slice(0, 10),
            nombre: nombreLegible(deudor),
            nroTramite: clave.nroTramite,
            vtoImpreso: calcularVtoImpreso(clave.fechaVencimiento),
            referencia: String(deudor.id),
            leyendaTalonCedente: cfg.leyendaTalonCedente,
            mediosDePago: cfg.mediosDePago,
            vistaPrevia,
        };
    }

    /** Convenio `CLAVE_PAGO` ACTIVO de esta clave puntual, para saber si una `REEMPLAZADA` se puede
     * seguir usando (R8) y para armar la vista previa. */
    private async convenioActivoDeClave(claveId: number) {
        return this.prisma.convenio.findFirst({
            where: { origen: ORIGEN_CLAVE_PAGO, estado: 'ACTIVO', clavePagoId: claveId },
            select: { id: true, deudorId: true, createdAt: true },
        });
    }

    // ─── Vista previa (§8.3) — nada de esto escribe ────────────────────────────

    async preview(claveId: number, deudorId: number) {
        const t0 = Date.now();
        const clave = await this.cargarClave(claveId);
        const deudor = await this.cargarDeudor(deudorId);
        this.asegurarCorrespondencia(clave, deudor);

        const cfg = await this.cargarConfig(clave.empresaId);
        const vencida = esClaveVencida(clave.fechaVencimiento);
        const cancelada = this.bloqueo.estaBloqueado(deudor.estadoSituacionId);
        const convenioDeEstaClave = await this.convenioActivoDeClave(claveId);
        const reemplazadaSinConvenio = clave.estado === 'REEMPLAZADA' && !convenioDeEstaClave;

        const otroActivo = await this.prisma.convenio.findFirst({
            where: {
                origen: ORIGEN_CLAVE_PAGO,
                estado: 'ACTIVO',
                clavePagoId: { not: claveId },
                clavePago: { empresaId: clave.empresaId, nroTramite: clave.nroTramite },
            },
            select: { id: true, deudorId: true, montoTotal: true, clavePago: { select: { tipo: true } } },
        });

        // La clave de este mismo código ya tiene un convenio activo, pero en OTRO caso: generar acá
        // terminaría en 409 CONVENIO_CLAVE_EN_OTRO_CASO. Antes de este fix la vista previa no lo
        // avisaba — el operador se enteraba recién al confirmar (hallazgo de la auditoría, §11.2.5).
        const claveEnOtroCaso = !!convenioDeEstaClave && convenioDeEstaClave.deudorId !== deudorId;

        const avisos: string[] = [];
        if (cancelada) avisos.push('La cuenta está cancelada: no se puede generar ni reimprimir un cupón.');
        if (vencida) avisos.push('La clave está vencida: no se puede generar el cupón.');
        if (reemplazadaSinConvenio) avisos.push('Esta clave fue reemplazada por una carga posterior y no tiene convenio: no se puede generar.');
        if (claveEnOtroCaso) {
            avisos.push(`Esta clave ya tiene un convenio activo en el caso ${convenioDeEstaClave!.deudorId}; no se puede generar acá.`);
        }
        if (otroActivo && otroActivo.deudorId === deudorId) {
            avisos.push(
                `Ya hay un cupón emitido por ${otroActivo.clavePago?.tipo === 'TOTAL' ? 'el saldo total' : 'la quita'} ` +
                    `($ ${esAr(otroActivo.montoTotal)}). Generar este anula ese convenio.`,
            );
        }
        if (otroActivo && otroActivo.deudorId !== deudorId) {
            avisos.push('Hay un convenio de clave activo de este trámite en otro caso.');
        }

        const puedeGenerar = !cancelada && !vencida && !reemplazadaSinConvenio && !claveEnOtroCaso;

        this.logger.debug(`Preview cupón claveId=${claveId} deudorId=${deudorId} puedeGenerar=${puedeGenerar} en ${Date.now() - t0}ms`);

        return {
            clave: {
                id: clave.id,
                tipo: clave.tipo,
                importe: String(clave.importe),
                saldoTramite: String(clave.saldoTramite),
                nroConvenio: clave.nroConvenio,
                fechaVencimiento: clave.fechaVencimiento.toISOString().slice(0, 10),
                // NUNCA los 22 dígitos completos acá (D6): con eso alcanza para armar un cupón
                // cobrable sin pasar por el convenio. Solo los últimos 4, para identificarla en la
                // UI. Hallazgo de la auditoría — ver también `claves.service.ts#clavesDelCaso`.
                clavePagoUltimos4: clave.clavePago.slice(-4),
                estado: clave.estado,
            },
            deudor: { nombre: nombreLegible(deudor), nroTramite: clave.nroTramite },
            vtoImpreso: calcularVtoImpreso(clave.fechaVencimiento),
            puedeGenerar,
            avisos,
            convenioActivo: convenioDeEstaClave
                ? { id: convenioDeEstaClave.id, deudorId: convenioDeEstaClave.deudorId, esEsteCaso: convenioDeEstaClave.deudorId === deudorId, createdAt: convenioDeEstaClave.createdAt.toISOString() }
                : null,
            otroConvenioActivo: otroActivo
                ? { id: otroActivo.id, deudorId: otroActivo.deudorId, tipo: otroActivo.clavePago?.tipo ?? null, importe: otroActivo.montoTotal }
                : null,
            // Campos de la fase 3 (mail): se agregan cuando exista el envío. Hoy la ficha solo ofrece Descargar.
            plantilla: null as null,
            variablesSinValor: [] as string[],
            destinatariosDisponibles: [] as Array<{ id: number; valor: string; principal: boolean }>,
            cfg,
        };
    }

    async previewPdf(claveId: number, deudorId: number): Promise<Buffer> {
        const clave = await this.cargarClave(claveId);
        const deudor = await this.cargarDeudor(deudorId);
        this.asegurarCorrespondencia(clave, deudor);
        const cfg = await this.cargarConfig(clave.empresaId);
        return this.cuponPdf.generar(this.datosCupon(clave, deudor, cfg, true));
    }

    // ─── Generar (§8.1) ─────────────────────────────────────────────────────────

    async generar(claveId: number, dto: GenerarCuponDto, usuario: UsuarioJwt): Promise<GenerarCuponRespuesta> {
        const t0 = Date.now();
        this.logger.log(
            `Generando cupón claveId=${claveId} deudorId=${dto.deudorId} accion=${dto.accion} ` +
                `destinatarios=${dto.destinatarios?.length ?? 0}`,
        );

        this.asegurarAccionDisponible(dto.accion);

        const clave = await this.cargarClave(claveId);
        const deudor = await this.cargarDeudor(dto.deudorId);
        this.asegurarCorrespondencia(clave, deudor);

        await this.bloqueo.assertNoBloqueado(deudor.id, 'generar cupón de pago');

        if (esClaveVencida(clave.fechaVencimiento)) {
            this.logger.warn(`CLAVE_VENCIDA claveId=${claveId} deudorId=${deudor.id} vencimiento=${clave.fechaVencimiento.toISOString().slice(0, 10)}`);
            throw new BadRequestException({ code: 'CLAVE_VENCIDA', message: 'La clave está vencida; no se puede generar el cupón.' });
        }

        let convenioDeEstaClave: { id: number; deudorId: number } | null = null;
        if (clave.estado === 'REEMPLAZADA') {
            convenioDeEstaClave = await this.convenioActivoDeClave(claveId);
            if (!convenioDeEstaClave) {
                this.logger.warn(`CLAVE_REEMPLAZADA claveId=${claveId} deudorId=${deudor.id} sin convenio activo`);
                throw new BadRequestException({
                    code: 'CLAVE_REEMPLAZADA',
                    message: 'Esta clave fue reemplazada por una carga posterior y no tiene un convenio activo; no se puede generar un cupón nuevo.',
                });
            }
        }

        const cfg = await this.cargarConfig(clave.empresaId);

        // Paso 8: el PDF se genera ANTES de escribir nada. El buffer se descarta — la descarga real
        // (o la reimpresión) regenera desde la base con `obtenerPdf`, así el POST no viaja binario y
        // queda una sola fuente de verdad para el contenido del cupón.
        await this.cuponPdf.generar(this.datosCupon(clave, deudor, cfg, false));

        const resultado = await this.prisma.$transaction(
            async (tx) => {
                // Serializa dos clics o dos operadores sobre el mismo trámite (TOTAL y QUITA
                // incluidas): nadie más puede tocar las claves de este trámite hasta que termine.
                await tx.$queryRaw`SELECT id FROM clave_pago WHERE empresaId = ${clave.empresaId} AND nroTramite = ${clave.nroTramite} FOR UPDATE`;

                const activos = await tx.convenio.findMany({
                    where: {
                        origen: ORIGEN_CLAVE_PAGO,
                        estado: 'ACTIVO',
                        clavePago: { empresaId: clave.empresaId, nroTramite: clave.nroTramite },
                    },
                    include: { clavePago: true },
                });

                const mismo = activos.find((a) => a.clavePagoId === claveId);

                if (mismo) {
                    if (mismo.deudorId !== dto.deudorId) {
                        throw new ConflictException({
                            code: 'CONVENIO_CLAVE_EN_OTRO_CASO',
                            message: 'El convenio de esta clave ya está activo en otro caso.',
                            convenioId: mismo.id,
                            deudorId: mismo.deudorId,
                        });
                    }

                    const comentario = await tx.comentario.create({
                        data: {
                            deudorId: deudor.id,
                            usuarioId: usuario.sub,
                            texto: this.textoComentario(clave, cfg, { reuso: true, anuladoNroConvenio: null }),
                            origen: 'CUPON_CLAVE',
                        },
                    });

                    return {
                        convenioId: mismo.id,
                        convenioReusado: true,
                        convenioAnuladoId: null as number | null,
                        gestionCambiada: false,
                        comentarioId: comentario.id,
                    };
                }

                const otro = activos.find((a) => a.clavePagoId !== claveId) ?? null;
                let convenioAnuladoId: number | null = null;
                let anuladoNroConvenio: string | null = null;

                if (otro) {
                    if (!dto.reemplazarConvenioActivo) {
                        throw new ConflictException({
                            code: 'CONVENIO_OTRA_CLAVE_ACTIVO',
                            message: 'Ya hay un convenio activo generado con la otra clave de este trámite.',
                            convenioId: otro.id,
                            tipo: otro.clavePago?.tipo ?? null,
                            importe: otro.montoTotal,
                            deudorId: otro.deudorId,
                        });
                    }
                    if (!usuario.permisos.includes('convenios.cancelar')) {
                        throw new ForbiddenException('No tenés permiso para anular el convenio de la otra clave.');
                    }
                    if (otro.deudorId !== dto.deudorId) {
                        throw new ConflictException({
                            code: 'CONVENIO_CLAVE_EN_OTRO_CASO',
                            message: 'El convenio activo de la otra clave de este trámite está en otro caso.',
                            convenioId: otro.id,
                            deudorId: otro.deudorId,
                        });
                    }

                    anuladoNroConvenio = otro.clavePago?.nroConvenio ?? null;
                    // Nombra las dos claves con su propio tipo y número: la del cupón que se genera y
                    // la de este convenio. Con una sola, el texto se leía como si el cupón nuevo fuera
                    // de la clave anulada.
                    const otroTipoTexto = otro.clavePago?.tipo === 'TOTAL' ? 'TOTAL' : 'QUITA';
                    const anulado = await tx.convenio.update({
                        where: { id: otro.id },
                        data: {
                            estado: 'ANULADO',
                            observaciones: [
                                otro.observaciones,
                                `Anulado: se generó el cupón de la clave ${clave.tipo} ${clave.nroConvenio} (este convenio era de la clave ${otroTipoTexto} ${anuladoNroConvenio})`,
                            ]
                                .filter(Boolean)
                                .join('\n'),
                        },
                    });
                    convenioAnuladoId = anulado.id;
                }

                const centavos = centavosDeClave(clave.importe);
                const importe = centavos / 100;
                const saldoTramite = Number(clave.saldoTramite);

                const nuevo = await tx.convenio.create({
                    data: {
                        deudorId: dto.deudorId,
                        usuarioId: usuario.sub,
                        tipo: ORIGEN_CLAVE_PAGO,
                        estado: 'ACTIVO',
                        origen: ORIGEN_CLAVE_PAGO,
                        clavePagoId: claveId,
                        montoTotal: importe,
                        cantCuotas: 1,
                        montoCuota: importe,
                        fechaInicio: new Date(),
                        montoOriginal: saldoTramite,
                        importeQuita: saldoTramite - importe,
                        observaciones:
                            `Clave ${clave.tipo === 'TOTAL' ? 'TOTAL' : 'QUITA'} ${clave.nroConvenio} · vto ${clave.fechaVencimiento.toISOString().slice(0, 10).split('-').reverse().join('/')}` +
                            (dto.observacion ? ` — ${dto.observacion}` : ''),
                        cuotas: {
                            create: [{ nroCuota: 1, fechaVencimiento: clave.fechaVencimiento, importe, estado: 'PENDIENTE' }],
                        },
                    },
                });

                let gestionCambiada = false;
                const gestion = await tx.parametro.findUnique({ where: { clave: cfg.gestionAlGenerar } });
                if (gestion) {
                    if (deudor.estadoGestionId !== gestion.id) {
                        await tx.deudor.update({ where: { id: deudor.id }, data: { estadoGestionId: gestion.id } });
                        gestionCambiada = true;
                    }
                } else {
                    this.logger.warn(
                        `Código de gestión "${cfg.gestionAlGenerar}" (configuracion.multiclaves.gestionAlGenerar) no existe en el catálogo; no se cambió la gestión del caso ${deudor.id}.`,
                    );
                }

                const comentario = await tx.comentario.create({
                    data: {
                        deudorId: deudor.id,
                        usuarioId: usuario.sub,
                        texto: this.textoComentario(clave, cfg, { reuso: false, anuladoNroConvenio }),
                        origen: 'CUPON_CLAVE',
                    },
                });

                return {
                    convenioId: nuevo.id,
                    convenioReusado: false,
                    convenioAnuladoId,
                    gestionCambiada,
                    comentarioId: comentario.id,
                };
            },
            { timeout: TIMEOUT_TRANSACCION_MS },
        );

        if (!resultado.convenioReusado) {
            await this.consolidacion.consolidar({ tipo: 'DEUDORES', deudorIds: [deudor.id] });
        }

        this.logger.log(
            `Cupón generado claveId=${claveId} convenio=${resultado.convenioId} reusado=${resultado.convenioReusado} ` +
                `anulado=${resultado.convenioAnuladoId ?? '-'} gestion=${resultado.gestionCambiada} en ${Date.now() - t0}ms`,
        );

        return {
            convenioId: resultado.convenioId,
            convenioReusado: resultado.convenioReusado,
            convenioAnuladoId: resultado.convenioAnuladoId,
            gestionCambiada: resultado.gestionCambiada,
            comentarioId: resultado.comentarioId,
            envio: null,
            descargaUrl: `/api/multiclaves/convenios/${resultado.convenioId}/cupon.pdf`,
        };
    }

    private asegurarAccionDisponible(accion: AccionCupon): void {
        if (accion !== 'DESCARGAR') {
            throw new BadRequestException({
                code: 'ACCION_NO_DISPONIBLE',
                message: 'El envío del cupón por mail todavía no está disponible; por ahora solo se puede descargar.',
            });
        }
    }

    private textoComentario(
        clave: ClaveConEmpresa,
        _cfg: ConfigMulticlaves,
        opts: { reuso: boolean; anuladoNroConvenio: string | null },
    ): string {
        const tipoTexto = clave.tipo === 'TOTAL' ? 'Con saldo total' : 'Con quita';
        const importe = esAr(centavosDeClave(clave.importe) / 100);
        const vto = clave.fechaVencimiento.toISOString().slice(0, 10).split('-').reverse().join('/');
        let texto = opts.reuso ? 'Cupón de pago reenviado — ' : 'Cupón de pago generado — ';
        texto += `${tipoTexto} ($ ${importe}, vto ${vto}, convenio Telecom ${clave.nroConvenio}).`;
        if (opts.anuladoNroConvenio) {
            texto += ` Se anuló el convenio de la clave ${opts.anuladoNroConvenio}.`;
        }
        return texto;
    }

    // ─── Reimpresión (§8.2) — no escribe ────────────────────────────────────────

    async obtenerPdfDeConvenio(convenioId: number): Promise<{ buffer: Buffer; nroTramite: string; tipo: string }> {
        const convenio = await this.prisma.convenio.findUnique({
            where: { id: convenioId },
            include: {
                clavePago: true,
                deudor: {
                    select: { id: true, empresaId: true, nombre: true, apellido: true, nroCliente: true, estadoSituacionId: true, estadoGestionId: true },
                },
            },
        });

        if (!convenio || convenio.origen !== ORIGEN_CLAVE_PAGO || !convenio.clavePago) {
            throw new NotFoundException({ code: 'CONVENIO_NO_ENCONTRADO', message: `Convenio ${convenioId} no encontrado o no es un convenio de clave de pago.` });
        }
        if (convenio.estado !== 'ACTIVO') {
            throw new BadRequestException({ code: 'CONVENIO_NO_ACTIVO', message: `El convenio está ${convenio.estado}; no se puede reimprimir su cupón.` });
        }

        await this.bloqueo.assertNoBloqueado(convenio.deudorId, 'reimprimir cupón de pago');

        if (esClaveVencida(convenio.clavePago.fechaVencimiento)) {
            this.logger.warn(`CLAVE_VENCIDA (reimpresión) convenioId=${convenioId} claveId=${convenio.clavePagoId}`);
            throw new BadRequestException({ code: 'CLAVE_VENCIDA', message: 'La clave está vencida; no se puede reimprimir el cupón.' });
        }

        const cfg = await this.cargarConfig(convenio.deudor.empresaId);
        const buffer = await this.cuponPdf.generar(this.datosCupon(convenio.clavePago, convenio.deudor, cfg, false));

        return { buffer, nroTramite: convenio.clavePago.nroTramite, tipo: convenio.clavePago.tipo };
    }
}
