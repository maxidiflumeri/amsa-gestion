// src/import/mapping.types.ts
export type ImportCategoria = 'DEUDORES' | 'FACTURAS' | 'PAGOS' | 'CONTACTOS' | 'ENRIQUECIMIENTO';

export interface MappingColumn {
    fromIndex: number;          // índice de columna del archivo (0-based)
    transforms?: string[];      // ej: ["trim","toNumber:es-AR"]
}

export interface RepetitiveBlock {
    entity: string;                 // ej: "FACTURA" o "CONTACTO"
    columns: Record<string, MappingColumn>;
}

/**
 * Modo de cálculo del importe (`montoTotal`) del deudor a partir de la suma de
 * sus facturas. Aplica a las categorías FACTURAS y DEUDORES_Y_FACTURAS.
 * - `NO`: no se toca `montoTotal` (lo trae el archivo de deudores).
 * - `SI_VACIO`: se completa con Σfacturas solo si el deudor quedó en null/0 (default).
 * - `SIEMPRE`: `montoTotal = Σfacturas`, pisando cualquier valor previo.
 */
export type MontoDeudorMode = 'NO' | 'SI_VACIO' | 'SIEMPRE';

/**
 * Modo del import de ACTUALIZACIONES:
 * - `RECONCILIAR` (default): comportamiento clásico — reconcilia deuda (pagos automáticos,
 *   nuevas facturas) y marca como "pagó todo" a los deudores ausentes del archivo.
 * - `SOLO_DATOS`: solo actualiza identidad (DNI) y datos adicionales de deudores existentes.
 *   NO reconcilia deuda, NO marca ausentes como pagados y NO crea deudores nuevos.
 *   Se usa para completar el DNI + adicionales de asignaciones cargadas sin DNI.
 */
export type ModoActualizacion = 'RECONCILIAR' | 'SOLO_DATOS';

/**
 * Comportamiento de ACTUALIZACIONES (Modo B / saldo) cuando el saldo informado es
 * MAYOR al actual del deudor (la deuda creció):
 * - `FACTURA_NUEVA` (default): genera una factura de ajuste por la diferencia y sube el saldo.
 * - `ACTUALIZAR_SALDO`: no genera facturas nuevas; si el deudor tiene una única factura pendiente,
 *   le actualiza el importe al saldo informado, y sube el saldo. Pensado para intereses diarios.
 */
export type ComportamientoDeudaMayor = 'FACTURA_NUEVA' | 'ACTUALIZAR_SALDO';

/**
 * Acción sobre los deudores de la remesa origen que NO aparecen en el archivo de ACTUALIZACIONES.
 * - `PAGO_TODO` (default): comportamiento clásico. Todas sus facturas → PAGADA, pago por el total,
 *   la consolidación posterior los deja en SIT-050 (cancelado/pagó todo).
 * - `DESASIGNAR`: se les setea `estadoGestionId = GES-094` (guardando el previo en
 *   `estadoGestionPrevioAId` para poder revertir). NO toca deuda, pagos, facturas ni situación.
 *   Los deudores cancelados (SIT-050) se ignoran. Pensado para archivos diarios de gestión
 *   (Fiat MT / Prelegal): el que no viene hoy no pagó, simplemente sale de la gestión del día.
 * - `IGNORAR`: no se hace nada con los ausentes (archivos parciales o pruebas).
 */
export type AccionAusenteActualizacion = 'PAGO_TODO' | 'DESASIGNAR' | 'IGNORAR';

// ─────────────────────────────────────────────────────────────────────────────
// Categoría ACCIONES (acciones masivas): matcheo + catálogo cerrado de operaciones.
// ─────────────────────────────────────────────────────────────────────────────

/** Origen del valor de una operación: el mismo para todos, o por columna del archivo. */
export type OrigenValor = 'ESTATICO' | 'COLUMNA';

export type CampoPrincipal = 'nombre' | 'apellido' | 'montoTotal' | 'fechaVencimiento' | 'nroCliente';
export type TipoContactoAccion = 'telefono' | 'email' | 'cualquiera';

export type AccionOperacion =
    | { tipo: 'SET_SITUACION' | 'SET_GESTION' | 'SET_MOTIVO'; modo: OrigenValor; parametroId?: number; fromIndex?: number }
    | { tipo: 'SET_CAMPO'; campo: CampoPrincipal; modo: OrigenValor; valor?: string; fromIndex?: number }
    | { tipo: 'SET_ADICIONALES'; columnas: Array<{ nombre: string; fromIndex: number }> }
    // ADD_COMENTARIO: texto fijo (ESTATICO), una columna (COLUMNA + fromIndex), o una PLANTILLA
    // de texto libre con variables `{{colN}}` (N = índice de columna 0-based) que se reemplazan
    // por el valor de esa columna en cada fila. La plantilla permite concatenar y maquetar libre.
    | { tipo: 'ADD_COMENTARIO'; modo: 'ESTATICO' | 'COLUMNA' | 'PLANTILLA'; texto?: string; fromIndex?: number; plantilla?: string }
    | { tipo: 'DELETE_CONTACTO'; contactoTipo: TipoContactoAccion; modo: OrigenValor; valor?: string; fromIndex?: number };

export interface AccionesConfig {
    /** DEUDOR: acciones sobre deudores matcheados por listado. CONTACTO: limpieza global de contactos. */
    matchMode: 'DEUDOR' | 'CONTACTO';
    /** Columna de match para matchMode DEUDOR (id = ID interno del deudor). */
    matchColumn?: { field: 'nro_cliente' | 'documento' | 'id'; fromIndex: number };
    /** Valor de contacto a borrar para matchMode CONTACTO (limpieza global). */
    contactoValor?: { tipo: 'telefono' | 'email'; fromIndex: number };
    /** Si true, no se tocan los deudores cancelados (SIT-050). */
    saltearCanceladas?: boolean;
    /** Operaciones a aplicar en orden. */
    operaciones: AccionOperacion[];
}

export interface MappingJson {
    entity: 'DEUDOR' | 'FACTURA' | 'PAGO' | 'CONTACTO' | 'ENRIQ_MIXTO' | 'MIXTO';
    matchKeys: string[];        // ej: ["empresaId","documento"]
    columns: Record<string, MappingColumn>;  // campos principales
    extras?: Record<string, MappingColumn>;   // <-- campos adicionales (JSON)
    blocks?: RepetitiveBlock[];               // <-- bloques repetitivos (N-1)
    defaults?: Record<string, any>;
    validations?: Array<{ field: string; rule: string }>;
    dedup?: { strategy: 'keep-last' | 'keep-first'; orderBy?: string[] };
    /** Modo de cálculo de `deudor.montoTotal` desde las facturas (default `SI_VACIO`). */
    montoDeudorDesdeFacturas?: MontoDeudorMode;
    /** Modo del import de ACTUALIZACIONES (default `RECONCILIAR`). */
    modoActualizacion?: ModoActualizacion;
    /** Comportamiento ante deuda mayor en ACTUALIZACIONES (default `FACTURA_NUEVA`). */
    comportamientoDeudaMayor?: ComportamientoDeudaMayor;
    /**
     * ACTUALIZACIONES: qué hacer con los deudores de la remesa origen ausentes del archivo.
     * Default `PAGO_TODO` (comportamiento clásico). Ver {@link AccionAusenteActualizacion}.
     */
    accionAusente?: AccionAusenteActualizacion;
    /**
     * ACTUALIZACIONES: si `false`, NO se crean deudores nuevos cuando el registro no matchea
     * la remesa origen — solo se actualizan los existentes y se ignoran los no encontrados.
     * Útil cuando un mismo archivo cubre varias remesas y se aplica una por una.
     * Default `true` (comportamiento clásico: los no encontrados se cargan como caso nuevo).
     */
    crearNuevosCasos?: boolean;
    /** Config de la categoría ACCIONES (acciones masivas). */
    acciones?: AccionesConfig;
    /** Config de la categoría MULTIRREGISTRO (archivo con varios tipos de línea). */
    multirregistro?: MultirregistroConfig;
    /** Config de la categoría MULTIARCHIVO (paquete de varios archivos que se cargan juntos). */
    multiarchivo?: MultiarchivoConfig;
    /**
     * Cómo están separados los campos del archivo. Ausente o `DELIMITADO` = comportamiento clásico
     * (el separador de la plantilla, o las celdas si es un Excel). Aditivo: ninguna plantilla ya
     * guardada cambia de comportamiento.
     */
    formato?: FormatoArchivo;
    /** Layout de las columnas cuando `formato` es `ANCHO_FIJO`. Ver {@link AnchoFijoConfig}. */
    anchoFijo?: AnchoFijoConfig;
    /**
     * Condiciones que una fila del archivo tiene que cumplir para importarse. Ver {@link FiltroFila}.
     * Ausente o vacío = entran todas (comportamiento clásico).
     */
    filtroFilas?: FiltroFila[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * FILTRO DE FILAS — qué subconjunto del archivo se importa
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Comparadores del filtro de filas. Los de texto no distinguen mayúsculas; `MAYOR` y `MENOR`
 * comparan como número y descartan la fila si el valor no lo es.
 */
export type OperadorFiltro =
    | 'IGUAL' | 'DISTINTO' | 'CONTIENE'
    | 'MAYOR' | 'MENOR'
    | 'VACIO' | 'NO_VACIO';

/**
 * Una condición sobre una columna de la fila cruda. Las condiciones de `filtroFilas` se combinan
 * con **Y**: la fila se importa solo si las cumple todas.
 *
 * El caso que lo motivó: el archivo de novedades de AYSA mezcla los cobros con los cambios de
 * situación que no mueven plata. De 4.552 filas solo 1.997 traen importe cobrado; sin
 * `{ fromIndex: <Imp. cobrado>, operador: 'MAYOR', valor: '0' }` el import genera 2.555 pagos de $0.
 *
 * Las filas descartadas **no cuentan como error**: no van a `importerror` ni suman a `errFilas`.
 * Se informan por separado en el preview y en el log del worker.
 *
 * No aplica a MULTIRREGISTRO ni MULTIARCHIVO: esas categorías no tienen "una fila = un registro",
 * sus parsers cruzan los archivos antes de llegar al pipeline.
 */
export interface FiltroFila {
    /** Índice de columna del archivo (0-based), igual que en {@link MappingColumn}. */
    fromIndex: number;
    operador: OperadorFiltro;
    /** Valor de comparación. No se usa con `VACIO` ni `NO_VACIO`. */
    valor?: string;
}

/**
 * Formato de los archivos de texto que manda el cedente.
 * - `DELIMITADO` (default): campos separados por un carácter (`;`, `|`, tab…).
 * - `ANCHO_FIJO`: cada campo ocupa siempre las mismas posiciones y no hay separador. Es lo que
 *   exporta SAP (caso AYSA). El layout va en `mappingJson.anchoFijo`.
 */
export type FormatoArchivo = 'DELIMITADO' | 'ANCHO_FIJO';

/* ────────────────────────────────────────────────────────────────────────────
 * ANCHO FIJO — archivos sin separador, con los campos en posiciones fijas
 * ──────────────────────────────────────────────────────────────────────────── */

/** Una columna del layout de ancho fijo: dónde empieza (0-based) y cuántos caracteres ocupa. */
export interface ColumnaAnchoFijo {
    nombre: string;
    /** Posición inicial en la línea, 0-based. */
    inicio: number;
    /** Cantidad de caracteres, incluido el relleno de espacios del campo. */
    largo: number;
}

/**
 * Layout de un archivo de ancho fijo.
 *
 * Mismo criterio que {@link MultiarchivoConfig}: acá va solo dónde está cada dato, que es lo que el
 * cedente puede mover sin avisar y conviene poder corregir desde la plantilla sin deploy.
 *
 * El orden de `columnas` define el **índice** con el que la plantilla las referencia (`fromIndex`),
 * igual que las columnas de un CSV. `nombre` es solo la etiqueta que se muestra en el editor de
 * mapeo, no se usa para resolver nada.
 *
 * El parseo está en `utils/ancho-fijo.ts`.
 */
export interface AnchoFijoConfig {
    /**
     * Codificación del archivo. Los exports de SAP vienen en Latin-1; leerlos como UTF-8 rompe las
     * Ñ y los acentos. Default `latin1`, igual que MULTIRREGISTRO y MULTIARCHIVO.
     */
    encoding?: 'latin1' | 'utf8';
    columnas: ColumnaAnchoFijo[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * MULTIRREGISTRO — archivos con varios tipos de línea en el mismo archivo
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Config de la categoría MULTIRREGISTRO (caso Toyota cuenta 87).
 *
 * La ESTRUCTURA del archivo (qué tipo de línea es el deudor, cuál la factura, cómo se vinculan
 * entre sí) vive en el parser y el processor, porque es específica del formato y generalizarla
 * sería construir un ETL. Acá va solo el **layout**: qué índice de columna ocupa cada dato, que es
 * lo que puede moverse sin aviso y conviene poder corregir sin deploy.
 *
 * Spec: `docs/imports-actualizacion-diaria-y-multirregistro-spec.md` §B.
 *
 * Formato del archivo:
 *   CLI;<nroCliente>;<nombre>;<calle>;...        → deudor + contactos
 *   GES;...;<nroCliente>;<contrato>;...;<aviso>  → factura (una por aviso)
 *   DET;<aviso>;<concepto>;<importe>;...         → desglose del importe de la factura
 *   BAJ;<aviso>;<fecha>;<motivo>                 → baja del caso
 *
 * Vínculos (dos saltos, NO una clave única compartida):
 *   CLI.nroCliente ── GES.nroCliente     y     GES.aviso ── DET.aviso / BAJ.aviso
 */
export interface MultirregistroConfig {
    /** Índice de la columna que trae el código de tipo de línea (default 0). */
    discriminadorIndex?: number;
    /** Codificación del archivo. Toyota manda Latin-1; leerlo como UTF-8 rompe las Ñ y los acentos. */
    encoding?: 'latin1' | 'utf8';
    /** Layout de la línea del cliente → deudor + contactos. */
    cli: {
        codigo: string;
        nroCliente: number;
        nombre: number;
        /** Índices que se concatenan para armar el domicilio, en orden. */
        domicilio?: number[];
        email?: number;
        /** Índice del código de área, que se antepone a cada teléfono. */
        codArea?: number;
        telefonos?: number[];
        /** Índices que se guardan en `camposAdicionales`, con el nombre a usar como clave. */
        adicionales?: Record<string, number>;
    };
    /** Layout de la línea de aviso → factura. */
    ges: {
        codigo: string;
        nroCliente: number;
        contrato: number;
        aviso: number;
    };
    /** Layout de la línea de detalle → desglose de la factura. */
    det: {
        codigo: string;
        aviso: number;
        concepto: number;
        /** Importe que suma al total de la factura. Se toma CON su signo (hay negativos). */
        importe: number;
        /** Columna de cantidad de días (la usa el concepto de días de mora). */
        dias?: number;
        /** Conceptos que NO son cargos y no deben ir al desglose (match por "empieza con"). */
        conceptosIgnorados?: string[];
        /** Concepto que trae los días de mora; su valor se agrega al final del desglose. */
        conceptoDiasMora?: string;
    };
    /** Layout de la línea de baja. */
    baj: {
        codigo: string;
        aviso: number;
        fecha?: number;
        motivo?: number;
        /**
         * Motivos que significan que el aviso **se pagó** (match por "empieza con", sin distinguir
         * mayúsculas). Solo para éstos se registra un pago por el importe del aviso.
         *
         * El resto de los motivos —en el archivo de Toyota, 9 de cada 10 son "Días de Mora
         * Excedidos"— NO son pagos: el cedente retira el aviso de la gestión y la deuda deja de
         * reclamarse. Registrar un pago ahí inventaría plata que nunca entró (el mismo error que
         * causó el incidente del 2026-07-21).
         */
        motivosPago?: string[];
    };
}

/* ────────────────────────────────────────────────────────────────────────────
 * MULTIARCHIVO — un paquete de archivos que se cargan juntos como una sola remesa
 * ──────────────────────────────────────────────────────────────────────────── */

/** Rol de cada archivo dentro del paquete. `deudores` y `detalle` son obligatorios. */
export type RolArchivoMultiarchivo = 'deudores' | 'detalle' | 'bajas' | 'codeudores';

/**
 * Columnas que componen el domicilio. Se carga como **contacto de tipo `direccion`** —no como dato
 * adicional— para que aparezca en la sección de Direcciones de la ficha, se pueda editar y, si la
 * remesa pide validar domicilios, se normalice contra Georef.
 *
 * Declararlo por partes (y no como un texto ya concatenado) es lo que le permite a Georef filtrar
 * por localidad y provincia en vez de adivinar.
 */
export interface DomicilioMultiarchivo {
    calle?: string;
    numero?: string;
    piso?: string;
    departamento?: string;
    cp?: string;
    localidad?: string;
    provincia?: string;
}

/**
 * Config de la categoría MULTIARCHIVO (caso Toyota TCFA).
 *
 * Misma división que {@link MultirregistroConfig}: la ESTRUCTURA (qué archivo es el deudor, cómo se
 * vinculan entre sí, qué significa una baja) vive en el parser y el processor porque es la lógica de
 * negocio; acá va solo el **layout**, que es lo que el cedente puede mover sin avisar y conviene
 * poder corregir desde la plantilla sin deploy.
 *
 * A diferencia de MULTIRREGISTRO, los archivos traen **header**, así que el layout se declara por
 * **nombre de columna** (sin distinguir mayúsculas) en vez de por índice: es legible y no se rompe
 * si el cedente agrega una columna al final.
 *
 * Spec: `docs/imports-toyota-tcfa-spec.md`.
 *
 * Los archivos del paquete y cómo se vinculan:
 *
 *   Deudores.txt      IdAsignacion;cliente;nombre;...;codfiscal;...;TotalDeuda    → deudor + contactos
 *   DetalleDeuda.txt  IdAsignacion;cliente;contrato;cuota;FehcaVto;capital;...    → una factura por cuota
 *   Bajas.txt         IdAsignacion;cliente;contrato;cuota;...;IDMotivo;Motivo     → baja de una cuota
 *   CoDeudores.txt    IdAsignacion;ClienteTitular;ClienteCoDeudor;nombre;...      → contactos del titular
 *
 *   Deudores.IdAsignacion ──► Detalle.IdAsignacion       (join del día, ver aviso abajo)
 *   Deudores.cliente      ──► CoDeudores.ClienteTitular
 *   Bajas.(cliente, contrato, cuota) ──► factura ya cargada en una bajada anterior
 *
 * ⚠️ El detalle se joinea por **IdAsignacion**, NUNCA por cliente: el cedente sigue mandando cuotas
 * de asignaciones viejas y un cliente puede tener asignaciones anteriores en el mismo archivo.
 * Joineando por cliente, un caso del archivo real pasaba de $2.199.415 a $6.878.743 de deuda.
 */
export interface MultiarchivoConfig {
    /** Codificación de los archivos. TCFA manda Latin-1: en UTF-8 se rompen las Ñ y los acentos. */
    encoding?: 'latin1' | 'utf8';
    /** Si los archivos traen fila de encabezado (default `true` — el layout se declara por nombre). */
    tieneHeader?: boolean;
    /**
     * Patrón (regex, sin distinguir mayúsculas) que reconoce cada archivo del paquete por su nombre.
     * El operador sube los archivos sueltos y el rol de cada uno se resuelve con esto.
     */
    archivos: {
        deudores: string;
        detalle: string;
        bajas?: string;
        codeudores?: string;
    };
    /** Layout de Deudores.txt → deudor + contactos. Es el snapshot de la cartera vigente. */
    deudores: {
        /** Columna que joinea con el detalle del mismo paquete. NO es la clave del deudor. */
        claveAsignacion: string;
        /** Clave ESTABLE del deudor entre bajadas (el IdAsignacion cambia al reasignarse). */
        nroCliente: string;
        nombre: string;
        /** CUIT/CUIL. Si no viene, el processor cae a un placeholder derivado del nro de cliente. */
        documento?: string;
        /**
         * Domicilio del titular → contacto de tipo `direccion`. Acepta la forma estructurada
         * ({@link DomicilioMultiarchivo}) o, por compatibilidad con plantillas ya guardadas, un
         * array de columnas que se concatenan en un texto suelto.
         */
        domicilio?: DomicilioMultiarchivo | string[];
        email?: string;
        /** Código de área, que se antepone a cada teléfono. */
        codArea?: string;
        telefonos?: string[];
        /** Deuda vigente declarada por el cedente. Se usa si el caso no trae ninguna cuota. */
        montoTotal?: string;
        /** Columnas que se guardan en `camposAdicionales`, con el nombre a usar como clave. */
        adicionales?: Record<string, string>;
    };
    /** Layout de DetalleDeuda.txt → una factura por cuota vencida. */
    detalle: {
        /** Columna que joinea con `deudores.claveAsignacion`. */
        claveAsignacion: string;
        contrato: string;
        cuota: string;
        /** Vencimiento de la cuota (formato `D/M/YYYY`, con o sin hora). */
        vencimiento?: string;
        /**
         * Columnas que se SUMAN para dar el importe de la cuota, con la etiqueta a mostrar en el
         * desglose. El orden de las claves es el orden del desglose.
         * Verificado contra el archivo real: la suma da exactamente el `TotalDeuda` del deudor.
         */
        conceptosImporte: Record<string, string>;
        /** Columnas informativas que se agregan al final del desglose (score, débito, etc.). */
        adicionales?: Record<string, string>;
    };
    /** Layout de Bajas.txt. Cada fila baja UNA cuota, no el caso entero. */
    bajas?: {
        nroCliente: string;
        contrato: string;
        cuota: string;
        fecha?: string;
        motivo?: string;
        /** Código numérico del motivo. Más estable que el texto, que el cedente puede reescribir. */
        motivoId?: string;
        /**
         * Códigos de `motivoId` que significan que la cuota **se cobró**. Solo para ésos se registra
         * un pago. TCFA: `['1']` (Pago de Cuota). El resto —"Envio a Gestion Especial", "Contrato
         * Finalizado"— son retiros del cedente: la cuota deja de reclamarse pero NO entró plata.
         */
        motivosPagoIds?: string[];
        /** Fallback por texto (match por "empieza con") si el cedente no manda código. */
        motivosPago?: string[];
    };
    /**
     * Qué hacer con los casos de la cartera que **no vinieron** en el archivo de deudores.
     *
     * El archivo de TCFA es un snapshot completo de la cartera vigente (en la bajada del 29/05, solo
     * 120 de 854 casos eran del día; el resto son reasignaciones), así que un caso que deja de venir
     * es un caso que el cedente retiró de la gestión.
     *
     * - `IGNORAR` (**default**): no se toca a nadie. El caso se sigue gestionando aunque ya no venga.
     * - `DESASIGNAR`: se les pone `estadoGestionId = GES-094` guardando el previo en
     *   `estadoGestionPrevioAId`, para poder revertir si reaparecen. NO toca deuda, pagos, facturas
     *   ni situación. Se saltean los cancelados (SIT-050) y los ya dados de baja (GES-090).
     *
     * ⚠️ El default es `IGNORAR` a propósito: **desasignar es destructivo a escala**. Un archivo que
     * llegue parcial —o mal mapeado— saca de gestión media cartera de una. Ya pasó: el 2026-07-21 un
     * batch fallido desasignó 342.792 deudores de Toyota. Activarlo requiere haber confirmado con el
     * cedente que el archivo trae **siempre** la cartera completa.
     */
    accionAusente?: 'DESASIGNAR' | 'IGNORAR';
    /** Layout de CoDeudores.txt → contactos y datos adicionales del titular. */
    codeudores?: {
        /** Nro de cliente del titular, que joinea con `deudores.nroCliente`. */
        titular: string;
        nroCodeudor: string;
        nombre: string;
        documento?: string;
        /** Domicilio del codeudor → contacto `direccion` del titular, marcado como CODEUDOR. */
        domicilio?: DomicilioMultiarchivo | string[];
        email?: string;
        codArea?: string;
        telefonos?: string[];
        /** Columnas que se guardan dentro de cada entrada de `camposAdicionales.codeudores`. */
        adicionales?: Record<string, string>;
    };
}