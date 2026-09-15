/**
 * Mensaje por mail del cupón de pago (spec §8.4, fase 3). Funciones puras, sin Nest ni Prisma:
 * arman las variables propias del cupón (para una plantilla de Sender) y el mensaje por defecto
 * (asunto + HTML) cuando el operador no elige plantilla.
 *
 * NUNCA loguear el resultado de `mensajeCuponDefault` (el HTML) — política de logging, CLAUDE.md.
 */

/** Escapa texto para HTML — nunca interpolar el nombre del cliente (u otro dato) sin pasar por acá. */
export function escapeHtml(s: string): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Reemplaza `{{variable}}` por su valor — mismo patrón (`/\{\{\s*(\w+)\s*\}\}/g`) que
 * `manual-email.service.ts#extractVariables` de AMSA Sender (repo hermano, solo lectura), para que
 * el asunto que mandamos ya resuelto sea un no-op cuando Sender lo vuelva a pasar por su propio
 * `renderTemplate`. Una variable sin valor en el mapa se reemplaza por cadena vacía, igual que hace
 * Sender — acá nunca debería pasar porque `prepararEnvio` ya cortó con `PLANTILLA_CON_VARIABLES_VACIAS`
 * antes de llegar a esto.
 */
export function renderVariables(texto: string, variables: Record<string, string>): string {
    return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => variables[key] ?? '');
}

/** `["A", "B", "C"] → "A, B o C"`; con uno solo, ese; con ninguno, cadena vacía. */
export function formatearListaOr(items: string[]): string {
    const limpios = items.map((i) => i.trim()).filter(Boolean);
    if (limpios.length === 0) return '';
    if (limpios.length === 1) return limpios[0];
    return `${limpios.slice(0, -1).join(', ')} o ${limpios[limpios.length - 1]}`;
}

export interface VariablesPropiasCuponInput {
    /** `$ 19.880,01` ya formateado en `es-AR`, con el `$` incluido. */
    importeConSigno: string;
    /** Centavos enteros del importe de la clave — para pasarlo por `importeEnLetras`. */
    importeCentavos: number;
    /** `DD/MM/AAAA` (D12, `calcularVtoImpreso`). */
    vtoImpreso: string;
    tipo: 'TOTAL' | 'QUITA';
    nroTramite: string;
    /** Ya armado (`nombreLegible`), sin escapar — quien arma el HTML es responsable de escapar. */
    nombreCliente: string;
    importeEnLetrasFn: (centavos: number) => string;
}

/**
 * Variables propias del cupón para una plantilla de Sender (§8.4): pisan a las automáticas del
 * mapeo general si el nombre coincide. Deliberadamente **no** incluye la clave de pago de 22
 * dígitos ni el código de barras (D6): esos solo existen dentro del PDF adjunto — una plantilla de
 * mail es contenido libre que un operador puede reenviar o filtrar sin que el sistema lo controle,
 * así que no es el lugar para el dato completo que arma un cupón cobrable.
 */
export function variablesPropiasCupon(input: VariablesPropiasCuponInput): Record<string, string> {
    return {
        importe_cupon: input.importeConSigno,
        importe_cupon_letras: input.importeEnLetrasFn(input.importeCentavos),
        vencimiento_cupon: input.vtoImpreso,
        tipo_cupon: input.tipo === 'TOTAL' ? 'Saldo total' : 'Con quita 50%',
        nro_tramite: input.nroTramite,
        nombre_cliente: input.nombreCliente,
    };
}

export interface MensajeCuponDefaultInput {
    nombreCliente: string;
    importeConSigno: string;
    vtoImpreso: string;
    mediosDePago: string[];
    /** Nombre comercial para el asunto — `cfg` de la empresa o "Personal" por default (§9.5). */
    nombreComercial?: string;
}

/**
 * Mensaje por defecto cuando el operador no elige una plantilla de Sender (§8.4, decisión de esta
 * fase 3: la plantilla es opcional). Texto y HTML fijos, en español rioplatense — el nombre del
 * cliente es el único dato variable que puede traer caracteres raros, así que se escapa.
 */
export function mensajeCuponDefault(input: MensajeCuponDefaultInput): { subject: string; html: string } {
    const nombreComercial = input.nombreComercial?.trim() || 'Personal';
    const nombre = escapeHtml(input.nombreCliente);
    const importe = escapeHtml(input.importeConSigno);
    const vto = escapeHtml(input.vtoImpreso);
    const medios = escapeHtml(formatearListaOr(input.mediosDePago));

    const subject = `Cupón de pago - ${nombreComercial}`;
    const html =
        `<p>Hola ${nombre}:</p>` +
        `<p>Te enviamos adjunto el cupón de pago que solicitaste, por <strong>${importe}</strong>, ` +
        `con vencimiento el <strong>${vto}</strong>.</p>` +
        `<p>Podés abonarlo en ${medios}.</p>` +
        `<p>Ante cualquier consulta, respondé este correo.</p>`;

    return { subject, html };
}
