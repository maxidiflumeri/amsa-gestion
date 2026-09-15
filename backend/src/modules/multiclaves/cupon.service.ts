/**
 * `CuponService` — generar cupón (spec §8). Fase 3: `ENVIAR`/`DESCARGAR_Y_ENVIAR` mandan el cupón
 * por mail, con plantilla de Sender OPCIONAL (si no se elige una, mensaje por defecto armado acá —
 * ver `utils/cupon-mail.ts`. Esto corrige el spec original, que exigía plantilla sí o sí: no es
 * cierto, Sender acepta `html` propio, ver CHANGELOG fase 3).
 *
 * Orden de `generar()` (§8.1): valida caso/clave → bloqueo → vencida/reemplazada → si ENVIAR, arma y
 * valida TODO el plan de mail (permiso, destinatarios, SMTP, variables de la plantilla) ANTES de
 * generar el PDF → PDF ANTES de escribir nada (si falla, no queda un convenio sin cupón) →
 * transacción interactiva con `SELECT … FOR UPDATE` sobre las claves del trámite → reusa o crea el
 * convenio → cambia la gestión → intenta el mail (si falla, el convenio queda: es un `warn`, no se
 * revierte nada) → comenta (siempre, con el resultado del mail si corresponde) → consolida.
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
import { EmailSenderService } from '../email-sender/email-sender.service';
import { CATALOG, normalizar } from '../email-sender/variables-mapper';
import { ContactosService } from '../contactos/contactos.service';
import { esPosibleEmail, normalizarEmail } from '../../common/utils/email-utils';
import { obfuscateEmail } from '../../common/logger/sanitize';
import { CuponPdfService, DatosCupon, calcularVtoImpreso, esClaveVencida } from './cupon-pdf.service';
import { centavosDeTexto } from './utils/clave-pago';
import { importeEnLetras } from './utils/importe-en-letras';
import { mensajeCuponDefault, renderVariables, variablesPropiasCupon } from './utils/cupon-mail';
import { ConfigMulticlaves, resolverConfigMulticlaves } from './utils/config-multiclaves';
import { GenerarCuponDto } from './dto/generar-cupon.dto';

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
    /** `null` si por lo que sea no se pudo dejar el comentario (hallazgo bloqueante de la auditoría
     * de esta fase: el convenio ya está escrito en ese punto, así que un fallo acá jamás puede
     * traducirse en un 500 — se loguea `error` y se responde igual). */
    comentarioId: number | null;
    envio: null | {
        envioId: number | null;
        ok: boolean;
        enviados: number;
        /** Destinatarios que Sender no mandó a propósito (dados de baja), no un error. */
        omitidos?: Array<{ email: string; motivo: string }>;
        errores?: Array<{ email?: string; error: string }>;
    };
    /** Solo si la acción incluye DESCARGAR (spec §9.2). */
    descargaUrl: string | null;
}

/** Plan de envío ya validado (permiso, destinatarios, SMTP, variables) — armado ANTES del PDF y de
 * la transacción, para poder cortar con 400 sin haber escrito ni generado nada. */
interface PlanEnvioCupon {
    destinatarios: string[];
    subject: string;
    templateId?: number;
    html?: string;
    variables?: Record<string, string>;
}

/** Resultado de `ejecutarEnvio`, ya clasificado (§8.1, hallazgo de la auditoría): Sender responde
 * `ok:true` aunque no le haya llegado a nadie, si todos los destinatarios estaban dados de baja
 * (`enviados:0`, `omitidos` con motivo) — eso NO es "enviado". Se usa tanto para el `envio` de la
 * respuesta como para el comentario. */
type ClasificacionEnvio =
    | { tipo: 'enviado'; enviados: number }
    | { tipo: 'parcial'; enviados: number; omitidos: number }
    | { tipo: 'omitido'; omitidos: number }
    | { tipo: 'fallo'; motivo: string };

function clasificarEnvio(r: {
    ok: boolean;
    enviados: number;
    omitidos?: Array<{ email: string; motivo: string }>;
    errores?: Array<{ email?: string; error: string }>;
}): ClasificacionEnvio {
    if (!r.ok) return { tipo: 'fallo', motivo: r.errores?.[0]?.error ?? 'error desconocido' };
    const omitidos = r.omitidos?.length ?? 0;
    if (r.enviados === 0 && omitidos > 0) return { tipo: 'omitido', omitidos };
    if (omitidos > 0) return { tipo: 'parcial', enviados: r.enviados, omitidos };
    return { tipo: 'enviado', enviados: r.enviados };
}

const ORIGEN_CLAVE_PAGO = 'CLAVE_PAGO';
const TIMEOUT_TRANSACCION_MS = 10_000;
/** Tope para `ContactosService.create` en el camino de "guardar como contacto" del cupón — su
 * `dns.resolveMx` no tiene timeout propio y puede tardar ~28s con un DNS caído (hallazgo de la
 * auditoría). Solo aplica acá; el alta manual de contactos no se toca. */
const GUARDAR_CONTACTO_TIMEOUT_MS = 3_000;

/** Canónicos del mapeo general (`variables-mapper.ts#CATALOG`) marcados `esMontoDelCaso: true` —
 * resuelven a la DEUDA DEL CASO (`montoTotal`/`saldo`/`deudaActualizada`), no al importe del cupón.
 * Derivado del catálogo, no a mano (hallazgo de la auditoría — la lista original se había olvidado
 * `deuda_actualizada`): agregar un nuevo canónico de monto en `variables-mapper.ts` alcanza para que
 * este aviso lo cubra solo, sin tocar acá. Una plantilla que use `{{saldo}}`, `{{importe}}`,
 * `{{monto}}`, `{{total}}` o `{{deuda_actualizada}}` (sinónimos de esos canónicos) le manda al deudor
 * el total de la deuda en vez de la quita — sin que nada lo avise. */
const CANONES_RIESGOSOS = new Set(CATALOG.filter((e) => e.esMontoDelCaso).map((e) => e.canon));

/** Variables de una plantilla que matchean esos canónicos riesgosos — para avisar en la vista previa
 * (§8.4/§20). No bloquea el envío: es una alerta, el operador decide. */
function variablesRiesgosas(variables: string[]): string[] {
    return variables.filter((v) => {
        const norm = normalizar(v);
        return CATALOG.some((e) => CANONES_RIESGOSOS.has(e.canon) && e.synonyms.includes(norm));
    });
}

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
        private readonly emailSender: EmailSenderService,
        private readonly contactos: ContactosService,
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

    /** Las seis variables propias del cupón (§8.4), listas para pisar a las automáticas del mapeo
     * general de `email-sender` o para el mensaje por defecto. Usado por `preview()` y por
     * `prepararEnvio()` — una sola fuente de verdad para no calcular el importe/vto dos veces con
     * criterios distintos. */
    private variablesPropiasDeClave(clave: ClaveConEmpresa, deudor: DeudorParaCupon): Record<string, string> {
        const importeCentavos = centavosDeClave(clave.importe);
        return variablesPropiasCupon({
            importeConSigno: `$ ${esAr(importeCentavos / 100)}`,
            importeCentavos,
            vtoImpreso: calcularVtoImpreso(clave.fechaVencimiento),
            tipo: clave.tipo === 'TOTAL' ? 'TOTAL' : 'QUITA',
            nroTramite: clave.nroTramite,
            nombreCliente: nombreLegible(deudor),
            importeEnLetrasFn: importeEnLetras,
        });
    }

    /** Emails del caso, para el paso "Destinatarios" del diálogo — igual criterio que
     * `EmailSenderService.previewVariables` (contactos `tipo: 'email'`, principal = prioridad 1). */
    private async destinatariosDelCaso(deudorId: number): Promise<Array<{ id: number; valor: string; principal: boolean }>> {
        const contactos = await this.prisma.contacto.findMany({
            where: { deudorId, tipo: 'email' },
            select: { id: true, valor: true, prioridad: true },
            orderBy: [{ prioridad: 'asc' }, { id: 'asc' }],
        });
        return contactos.map((c) => ({ id: c.id, valor: c.valor, principal: c.prioridad === 1 }));
    }

    // ─── Vista previa (§8.3) — nada de esto escribe ────────────────────────────

    /** `templateId` opcional: si se pasa, agrega `plantilla` y `variablesSinValor` para que el
     * diálogo deshabilite "Enviar" ANTES de que el operador confirme (§8.4). */
    async preview(claveId: number, deudorId: number, templateId?: number) {
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

        const destinatariosDisponibles = await this.destinatariosDelCaso(deudor.id);

        let plantilla: { id: number; nombre: string; asunto: string } | null = null;
        let variablesSinValor: string[] = [];
        let avisosPlantilla: string[] = [];
        // `null` mientras no se pidió ninguna plantilla; un mensaje cuando se pidió una y no se pudo
        // resolver (404/Sender caído) — el frontend usa esto para deshabilitar Enviar con esa
        // plantilla en vez de leer `variablesSinValor: []` como "está todo bien" (hallazgo de la
        // auditoría, §5: antes una plantilla inválida quedaba indistinguible de una sin variables).
        let plantillaError: string | null = null;
        if (templateId) {
            try {
                const { template, sugerencias } = await this.emailSender.previewVariables(deudorId, templateId);
                const valores: Record<string, string> = {};
                for (const s of sugerencias) valores[s.variable] = s.valor ?? '';
                Object.assign(valores, this.variablesPropiasDeClave(clave, deudor)); // pisan a las automáticas
                variablesSinValor = template.variables.filter((v) => !(valores[v] ?? '').trim());
                plantilla = { id: template.id, nombre: template.nombre, asunto: template.asunto };
                // Aviso, no bloqueo (§8.4/§20): {{saldo}}/{{importe}}/{{monto}}/{{total}} en la
                // plantilla resuelven a la deuda del CASO, no al importe del cupón.
                avisosPlantilla = variablesRiesgosas(template.variables).map(
                    (v) => `"{{${v}}}" se completa con la deuda del caso, no el importe del cupón: usá {{importe_cupon}}.`,
                );
            } catch (err) {
                // No corta la vista previa: el operador puede elegir otra plantilla o mandar sin
                // ninguna. El error real (plantilla borrada, Sender caído) ya quedó en `warn`.
                this.logger.warn(`No se pudo previsualizar la plantilla ${templateId} para el cupón claveId=${claveId}: ${(err as Error).message}`);
                plantillaError = 'La plantilla configurada ya no existe en Sender (o Sender no respondió); elegí otra o mandalo sin plantilla.';
            }
        }

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
            plantilla,
            variablesSinValor,
            avisosPlantilla,
            plantillaError,
            destinatariosDisponibles,
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

    // ─── Envío por mail (§8.4, fase 3) ──────────────────────────────────────────

    /**
     * Arma y valida TODO lo necesario para mandar el cupón por mail, ANTES de generar el PDF y de
     * tocar la base (§8.1 paso 7): permiso, destinatarios, cuenta SMTP de la empresa y — si hay
     * plantilla elegida — que ninguna de sus variables quede vacía. Nunca envía nada: eso lo hace
     * `ejecutarEnvio`, después de que el convenio ya está creado.
     */
    private async prepararEnvio(
        clave: ClaveConEmpresa,
        deudor: DeudorParaCupon,
        cfg: ConfigMulticlaves,
        dto: GenerarCuponDto,
        usuario: UsuarioJwt,
    ): Promise<PlanEnvioCupon> {
        if (!usuario.permisos.includes('email.enviar')) {
            this.logger.warn(`Envío de cupón sin permiso email.enviar claveId=${clave.id} deudorId=${deudor.id} usuarioId=${usuario.sub}`);
            throw new ForbiddenException('No tenés permiso para enviar emails.');
        }

        const destinatarios = [...new Set((dto.destinatarios ?? []).map((d) => d.trim()).filter(Boolean))];
        if (destinatarios.length === 0 || !destinatarios.every((d) => esPosibleEmail(d))) {
            throw new BadRequestException({
                code: 'DESTINATARIOS_INVALIDOS',
                message: 'Indicá al menos un destinatario de mail válido.',
            });
        }

        const { smtp } = await this.emailSender.smtpDeEmpresa(deudor.empresaId);
        if (!smtp) {
            throw new BadRequestException({
                code: 'EMPRESA_SIN_SMTP',
                message: 'La empresa no tiene una cuenta SMTP configurada; no se puede enviar el cupón por mail.',
            });
        }

        const propias = this.variablesPropiasDeClave(clave, deudor);

        if (dto.templateId) {
            let template: { asunto: string; variables: string[] };
            let sugerencias: Array<{ variable: string; valor: string | null }>;
            try {
                ({ template, sugerencias } = await this.emailSender.previewVariables(deudor.id, dto.templateId));
            } catch (err) {
                // La plantilla pasó la vista previa y después desapareció de Sender (o Sender está
                // caído) entre que el operador la eligió y confirmó: no puede ser un 500 — es un 400
                // de negocio, igual que el resto de las validaciones de este método (hallazgo de la
                // auditoría, §5).
                this.logger.warn(`Plantilla ${dto.templateId} inválida al confirmar el envío del cupón claveId=${clave.id}: ${(err as Error).message}`);
                throw new BadRequestException({
                    code: 'PLANTILLA_INVALIDA',
                    message: 'La plantilla elegida ya no existe en Sender (o Sender no respondió); elegí otra o mandalo sin plantilla.',
                });
            }

            const valores: Record<string, string> = {};
            for (const s of sugerencias) valores[s.variable] = s.valor ?? '';
            Object.assign(valores, propias); // las variables del cupón pisan a las automáticas (§8.4)

            const faltantes = template.variables.filter((v) => !(valores[v] ?? '').trim());
            if (faltantes.length > 0) {
                throw new BadRequestException({
                    code: 'PLANTILLA_CON_VARIABLES_VACIAS',
                    message: 'Hay variables de la plantilla sin valor; completalas o elegí otra plantilla.',
                    variables: faltantes,
                });
            }

            // El asunto se resuelve ACÁ, no en Sender: así `envio_email.asunto` (el historial de
            // Gestión) queda con el texto final, no con "{{nombre_cliente}}" literal (hallazgo de la
            // auditoría). Sender vuelve a pasar este `subject` por su propio `renderTemplate`, pero
            // como ya no quedan `{{...}}` sin resolver, es un no-op — el mail que sale es el mismo.
            const asuntoResuelto = renderVariables(template.asunto, valores);

            return { destinatarios, templateId: dto.templateId, subject: asuntoResuelto, variables: valores };
        }

        const { subject, html } = mensajeCuponDefault({
            nombreCliente: nombreLegible(deudor),
            importeConSigno: propias.importe_cupon,
            vtoImpreso: propias.vencimiento_cupon,
            mediosDePago: cfg.mediosDePago,
        });
        return { destinatarios, subject, html };
    }

    /** Manda el cupón ya generado. `EmailSenderService.enviar` devuelve `ok:false` (no lanza) en el
     * camino esperado de un SMTP que rechaza el envío — este `try/catch` es la red por si algo
     * explota ANTES de eso. En los dos casos, el convenio ya quedó creado: el envío es best-effort,
     * nunca revierte nada (spec §8.1: "si falla, el convenio queda; el reenvío lo reusa"). */
    private async ejecutarEnvio(
        deudor: DeudorParaCupon,
        clave: ClaveConEmpresa,
        plan: PlanEnvioCupon,
        pdf: Buffer,
        usuario: UsuarioJwt,
    ): Promise<{
        envioId: number | null;
        ok: boolean;
        enviados: number;
        omitidos?: Array<{ email: string; motivo: string }>;
        errores?: Array<{ email?: string; error: string }>;
    }> {
        const destinatariosLog = plan.destinatarios.map(obfuscateEmail).join(', ');
        try {
            const r = await this.emailSender.enviar({
                deudorId: deudor.id,
                usuarioId: usuario.sub,
                templateId: plan.templateId,
                html: plan.html,
                destinatarios: plan.destinatarios,
                asunto: plan.subject,
                variables: plan.variables ?? {},
                archivos: [{ originalname: `cupon-pago-${clave.nroTramite}.pdf`, buffer: pdf, mimetype: 'application/pdf' }],
            });
            if (!r.ok) {
                this.logger.warn(`Envío del cupón FALLÓ claveId=${clave.id} deudorId=${deudor.id} envioId=${r.envioId} destinatarios=${destinatariosLog}`);
            } else if (r.enviados === 0 && (r.omitidos?.length ?? 0) > 0) {
                // Sender dice `ok:true` (no hubo errores de SMTP), pero a nadie le llegó nada —
                // hallazgo de la auditoría: esto NO es un envío exitoso.
                this.logger.warn(`Envío del cupón OMITIDO (todos dados de baja) claveId=${clave.id} deudorId=${deudor.id} destinatarios=${destinatariosLog}`);
            }
            return { envioId: r.envioId, ok: r.ok, enviados: r.enviados, omitidos: r.omitidos, errores: r.errores };
        } catch (err: any) {
            this.logger.warn(`Envío del cupón explotó claveId=${clave.id} deudorId=${deudor.id} destinatarios=${destinatariosLog}: ${err?.message}`);
            return { envioId: null, ok: false, enviados: 0, errores: [{ error: String(err?.message ?? err) }] };
        }
    }

    // ─── Generar (§8.1) ─────────────────────────────────────────────────────────

    async generar(claveId: number, dto: GenerarCuponDto, usuario: UsuarioJwt): Promise<GenerarCuponRespuesta> {
        const t0 = Date.now();
        const incluyeEnvio = dto.accion === 'ENVIAR' || dto.accion === 'DESCARGAR_Y_ENVIAR';
        const incluyeDescarga = dto.accion === 'DESCARGAR' || dto.accion === 'DESCARGAR_Y_ENVIAR';

        this.logger.log(
            `Generando cupón claveId=${claveId} deudorId=${dto.deudorId} accion=${dto.accion} ` +
                `destinatarios=${incluyeEnvio ? (dto.destinatarios?.length ?? 0) : 0}`,
        );

        const clave = await this.cargarClave(claveId);
        const deudor = await this.cargarDeudor(dto.deudorId);
        this.asegurarCorrespondencia(clave, deudor);

        await this.bloqueo.assertNoBloqueado(deudor.id, 'generar cupón de pago');

        if (esClaveVencida(clave.fechaVencimiento)) {
            this.logger.warn(`CLAVE_VENCIDA claveId=${claveId} deudorId=${deudor.id} vencimiento=${clave.fechaVencimiento.toISOString().slice(0, 10)}`);
            throw new BadRequestException({ code: 'CLAVE_VENCIDA', message: 'La clave está vencida; no se puede generar el cupón.' });
        }

        if (clave.estado === 'REEMPLAZADA') {
            const convenioDeEstaClave = await this.convenioActivoDeClave(claveId);
            if (!convenioDeEstaClave) {
                this.logger.warn(`CLAVE_REEMPLAZADA claveId=${claveId} deudorId=${deudor.id} sin convenio activo`);
                throw new BadRequestException({
                    code: 'CLAVE_REEMPLAZADA',
                    message: 'Esta clave fue reemplazada por una carga posterior y no tiene un convenio activo; no se puede generar un cupón nuevo.',
                });
            }
        }

        const cfg = await this.cargarConfig(clave.empresaId);

        // Paso 7: TODO lo de ENVIAR se valida acá — antes del PDF y de la transacción — para poder
        // cortar con 400/403 sin haber escrito ni generado nada.
        const planEnvio = incluyeEnvio ? await this.prepararEnvio(clave, deudor, cfg, dto, usuario) : null;

        // Paso 8: el PDF se genera ANTES de escribir nada. Si la acción incluye ENVIAR, este mismo
        // buffer es el que se adjunta al mail — no hace falta regenerarlo después: los datos que
        // arma `datosCupon` no dependen del convenio (reuso o nuevo), solo de la clave/deudor/cfg.
        const pdf = await this.cuponPdf.generar(this.datosCupon(clave, deudor, cfg, false));

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

                    return {
                        convenioId: mismo.id,
                        convenioReusado: true,
                        convenioAnuladoId: null as number | null,
                        anuladoNroConvenio: null as string | null,
                        gestionCambiada: false,
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

                return {
                    convenioId: nuevo.id,
                    convenioReusado: false,
                    convenioAnuladoId,
                    anuladoNroConvenio,
                    gestionCambiada,
                };
            },
            { timeout: TIMEOUT_TRANSACCION_MS },
        );

        // Nada de lo que sigue puede terminar en un 500: el convenio (y la cuota, y la gestión) ya
        // están escritos en este punto. Un fallo acá es un "éxito parcial" — se loguea `error` y se
        // responde igual, nunca se relanza (hallazgo bloqueante de la auditoría de esta fase: antes
        // un `comentario.create` que tiraba P2000 por el texto largo dejaba el convenio ANULADO sin
        // ningún comentario, y el front recibía un 500 sin enterarse de que el cupón sí se generó).
        if (!resultado.convenioReusado) {
            try {
                await this.consolidacion.consolidar({ tipo: 'DEUDORES', deudorIds: [deudor.id] });
            } catch (err) {
                this.logger.error(
                    `Consolidación post-cupón falló claveId=${claveId} convenioId=${resultado.convenioId}: ${(err as Error).message}`,
                    (err as Error).stack,
                );
            }
        }

        // El mail se intenta DESPUÉS de que el convenio ya está escrito: si Sender falla, el cupón
        // sigue siendo válido y el reenvío reusa este mismo convenio (§8.1).
        let envio: GenerarCuponRespuesta['envio'] = null;
        let clasificacion: ClasificacionEnvio | null = null;
        if (incluyeEnvio && planEnvio) {
            const r = await this.ejecutarEnvio(deudor, clave, planEnvio, pdf, usuario);
            clasificacion = clasificarEnvio(r);
            envio = { envioId: r.envioId, ok: r.ok, enviados: r.enviados, omitidos: r.omitidos, errores: r.errores };

            // Solo tiene sentido guardar el contacto si a ESE destinatario le llegó algo — guardarlo
            // cuando todos rebotaron o se dieron de baja no aporta nada (hallazgo de la auditoría). En
            // un envío PARCIAL (`r.enviados > 0` con algunos omitidos) hay que excluir justo a los
            // omitidos: son destinatarios tipeados a mano a los que el mail NO les llegó (dados de
            // baja) — guardarlos como contacto igual fue otro hallazgo de la auditoría.
            if (dto.guardarEmailComoContacto && r.enviados > 0) {
                const omitidosSet = new Set((r.omitidos ?? []).map((o) => o.email));
                const destinatariosConEnvio = planEnvio.destinatarios.filter((d) => !omitidosSet.has(d));
                if (destinatariosConEnvio.length > 0) {
                    await this.guardarComoContacto(deudor.id, destinatariosConEnvio);
                }
            }
        }

        let comentarioId: number | null = null;
        try {
            const comentario = await this.prisma.comentario.create({
                data: {
                    deudorId: deudor.id,
                    usuarioId: usuario.sub,
                    texto: this.textoComentario(clave, {
                        reuso: resultado.convenioReusado,
                        anuladoNroConvenio: resultado.anuladoNroConvenio,
                        envio: clasificacion,
                    }),
                    origen: 'CUPON_CLAVE',
                },
            });
            comentarioId = comentario.id;
        } catch (err) {
            this.logger.error(
                `No se pudo crear el comentario del cupón claveId=${claveId} convenioId=${resultado.convenioId}: ${(err as Error).message}`,
                (err as Error).stack,
            );
        }

        this.logger.log(
            `Cupón generado claveId=${claveId} convenio=${resultado.convenioId} reusado=${resultado.convenioReusado} ` +
                `anulado=${resultado.convenioAnuladoId ?? '-'} gestion=${resultado.gestionCambiada} ` +
                `envio=${clasificacion ? clasificacion.tipo : '-'} en ${Date.now() - t0}ms`,
        );

        return {
            convenioId: resultado.convenioId,
            convenioReusado: resultado.convenioReusado,
            convenioAnuladoId: resultado.convenioAnuladoId,
            gestionCambiada: resultado.gestionCambiada,
            comentarioId,
            envio,
            descargaUrl: incluyeDescarga ? `/api/multiclaves/convenios/${resultado.convenioId}/cupon.pdf` : null,
        };
    }

    /** Best-effort (§8.1 paso 11): un destinatario que no exista como contacto email del caso queda
     * guardado — reusando `ContactosService.create` (minúsculas, trim, chequeo de MX, mismo
     * `validado` que un alta manual desde la ficha; hallazgo de la auditoría: antes se insertaba
     * directo por Prisma, sin esa validación). Nunca revierte ni frena el cupón — si falla (email sin
     * MX, ya existe con otra capitalización, lo que sea), `warn` y listo.
     *
     * `ContactosService.create` valida el email con `dns.resolveMx` (`common/utils/email-utils.ts`),
     * sin timeout propio — con un DNS caído, cada destinatario puede tardar ~28s en fallar (medido en
     * la auditoría). Acá, y SOLO acá, se lo corta a los `GUARDAR_CONTACTO_TIMEOUT_MS` de abajo: es un
     * "best-effort" que corre después de que el mail ya salió, no tiene sentido que la respuesta del
     * cupón quede colgada esperando un DNS que no responde. El alta manual de contactos
     * (`ContactosController`/`ContactosService`) no se toca — sigue esperando lo que tarde. */
    private async guardarComoContacto(deudorId: number, destinatarios: string[]): Promise<void> {
        for (const email of destinatarios) {
            try {
                const normalizado = normalizarEmail(email);
                const existe = await this.prisma.contacto.findFirst({ where: { deudorId, tipo: 'email', valor: normalizado } });
                if (!existe) {
                    await this.crearContactoConTimeout(deudorId, email);
                }
            } catch (err) {
                if ((err as Error).name === 'ContactoTimeout') {
                    this.logger.warn(`Guardar ${obfuscateEmail(email)} como contacto del caso ${deudorId} no terminó en ${GUARDAR_CONTACTO_TIMEOUT_MS}ms (DNS/MX lento): sigue en segundo plano`);
                } else {
                    this.logger.warn(`No se pudo guardar ${obfuscateEmail(email)} como contacto del caso ${deudorId}: ${(err as Error).message}`);
                }
            }
        }
    }

    /**
     * El timeout acota cuánto espera la respuesta, pero no cancela la creación: `Promise.race` no
     * frena `contactos.create`, que puede terminar después y guardar el contacto igual. Por eso el
     * desenlace tardío se loguea aparte, para que el log no diga "no se guardó" de algo que sí quedó.
     */
    private async crearContactoConTimeout(deudorId: number, email: string): Promise<void> {
        let vencio = false;
        const creacion = this.contactos.create({ deudorId, tipo: 'email', valor: email } as any);
        creacion.then(
            () => {
                if (vencio) this.logger.log(`Contacto ${obfuscateEmail(email)} guardado en el caso ${deudorId} después del timeout`);
            },
            (err) => {
                if (vencio) this.logger.warn(`Contacto ${obfuscateEmail(email)} no se guardó en el caso ${deudorId} (terminó después del timeout): ${(err as Error).message}`);
            },
        );
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                vencio = true;
                const e = new Error(`timeout de ${GUARDAR_CONTACTO_TIMEOUT_MS}ms validando el email (DNS/MX no respondió)`);
                e.name = 'ContactoTimeout';
                reject(e);
            }, GUARDAR_CONTACTO_TIMEOUT_MS);
        });
        try {
            await Promise.race([creacion, timeout]);
        } finally {
            clearTimeout(timer!);
        }
    }

    private textoComentario(
        clave: ClaveConEmpresa,
        opts: { reuso: boolean; anuladoNroConvenio: string | null; envio: ClasificacionEnvio | null },
    ): string {
        // `comentario.texto` es varchar(191) — NUNCA escribir más que eso (hallazgo bloqueante de la
        // auditoría: un `P2000` acá pasa DESPUÉS de que el convenio ya está escrito, así que no puede
        // tirar; ver el try/catch de `generar()`). Prioridad, de lo que nunca se corta a lo que cede
        // espacio primero: la acción y la clave (versión compacta si hace falta) → la anulación, si
        // hay → el resultado del mail, con el motivo técnico truncado al final.
        const MAX = 191;
        const tipoTexto = clave.tipo === 'TOTAL' ? 'Con saldo total' : 'Con quita';
        const importe = esAr(centavosDeClave(clave.importe) / 100);
        const vto = clave.fechaVencimiento.toISOString().slice(0, 10).split('-').reverse().join('/');
        const accion = opts.reuso ? 'Cupón de pago reenviado' : 'Cupón de pago generado';
        const anulacion = opts.anuladoNroConvenio ? ` Se anuló el convenio de la clave ${opts.anuladoNroConvenio}.` : '';

        const sufijoEnvio = (motivo?: string | null): string => {
            if (!opts.envio) return '';
            switch (opts.envio.tipo) {
                case 'enviado':
                    return ` Enviado a ${opts.envio.enviados} destinatario${opts.envio.enviados === 1 ? '' : 's'}.`;
                case 'parcial':
                    return ` Enviado a ${opts.envio.enviados}, ${opts.envio.omitidos} dado${opts.envio.omitidos === 1 ? '' : 's'} de baja.`;
                case 'omitido':
                    return ' No se envió: destinatario(s) dado(s) de baja.';
                case 'fallo': {
                    const m = motivo === undefined ? opts.envio.motivo : motivo;
                    return m ? ` El envío por mail FALLÓ: ${m}.` : ' El envío por mail FALLÓ.';
                }
            }
        };

        // Contar con `.length` cuenta unidades UTF-16, no caracteres — con un motivo que trae
        // emojis (fuera del BMP, dos unidades UTF-16 cada uno) eso desalinea el corte del límite real
        // de MySQL (que en `varchar(191)` cuenta CARACTERES) y, peor, `.slice()` puede partir un par
        // subrogado por la mitad y dejar una unidad suelta — UTF-16 inválido que el driver de MySQL
        // rechaza al insertar (hallazgo de la auditoría). `Array.from` itera por code point, nunca
        // por unidad UTF-16, así que contar y recortar con eso es seguro en los dos sentidos.
        const longitud = (s: string): number => Array.from(s).length;

        const rica = `${accion} — ${tipoTexto} ($ ${importe}, vto ${vto}, convenio Telecom ${clave.nroConvenio}).${anulacion}${sufijoEnvio()}`;
        if (longitud(rica) <= MAX) return rica;

        const compacta = `${accion} — Clave ${clave.tipo} ${clave.nroConvenio}.${anulacion}${sufijoEnvio()}`;
        if (longitud(compacta) <= MAX) return compacta;

        // Ni siquiera la versión compacta con el motivo completo entra: se recorta SOLO el motivo del
        // fallo, de a un carácter (code point, nunca una mitad de par subrogado), hasta que entre —
        // nunca la acción, la clave ni la anulación.
        if (opts.envio?.tipo === 'fallo') {
            let motivoChars = Array.from(opts.envio.motivo);
            while (motivoChars.length > 0) {
                const candidato = `${accion} — Clave ${clave.tipo} ${clave.nroConvenio}.${anulacion}${sufijoEnvio(`${motivoChars.join('')}…`)}`;
                if (longitud(candidato) <= MAX) return candidato;
                motivoChars = motivoChars.slice(0, -1);
            }
            const sinMotivo = `${accion} — Clave ${clave.tipo} ${clave.nroConvenio}.${anulacion}${sufijoEnvio(null)}`;
            if (longitud(sinMotivo) <= MAX) return sinMotivo;
        }

        // Failsafe absoluto: no debería llegar acá nunca (la compacta sin motivo es de largo fijo,
        // `nroConvenio` son 8 dígitos), pero un comentario jamás puede tirar con el convenio ya
        // escrito — mejor un texto cortado (por code point, nunca a mitad de un carácter) que un 500.
        const compactaChars = Array.from(compacta);
        return `${compactaChars.slice(0, MAX - 1).join('')}…`;
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
