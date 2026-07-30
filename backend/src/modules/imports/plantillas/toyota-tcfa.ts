import { MultiarchivoConfig } from '../mapping-types';

/**
 * Layout del paquete diario de Toyota TCFA (`IO_YYYYMMDD/{Deudores,DetalleDeuda,Bajas,CoDeudores}.txt`).
 *
 * Es el `mappingJson.multiarchivo` de la plantilla. Vive en código como **referencia** para poder
 * crear la plantilla y testear contra los archivos reales, pero lo que manda en producción es lo que
 * quede guardado en la plantilla: si el cedente mueve o renombra una columna se corrige ahí, sin
 * deploy.
 *
 * Verificado sobre la bajada del 2026-05-29 (854 deudores, 981 cuotas, 85 bajas, 55 codeudores).
 * Análisis completo en `docs/imports-toyota-tcfa-spec.md`.
 *
 *   Deudores.txt      IdAsignacion;cliente;nombre;calle;numero;piso;departamento;codpostal;ciudad;
 *                     codprovincia;provincia;tipopersona;tipocodfiscal;codfiscal;ivacond;email;
 *                     ddd;telefono1;telefono2;FechaAsignacion;CuotasVencidas;TotalDeuda;DiasMoraMax
 *   DetalleDeuda.txt  IdAsignacion;cliente;contrato;cuota;FehcaVto;capital;interes;gastos;gas_even;
 *                     itf;seg;sev;iva;int_mor;int_pun;iva_mor_pun;saldocontrato;Debito;IdNameScore;Reverso
 *   Bajas.txt         IdAsignacion;cliente;contrato;cuota;FechaFinGestion;IDMotivo;Motivo
 *   CoDeudores.txt    IdAsignacion;ClienteTitular;ClienteCoDeudor;nombre;calle;numero;piso;
 *                     departamento;codpostal;ciudad;CodProvincia;Provincia;TipoPersona;
 *                     TipoCodFiscal;CodFiscal;ivacond;email;ddd;telefono1;telefono2
 */
export const TOYOTA_TCFA_MULTIARCHIVO: MultiarchivoConfig = {
    // Deudores.txt y CoDeudores.txt traen acentos y Ñ en los nombres: leídos como UTF-8 se rompen.
    encoding: 'latin1',
    tieneHeader: true,

    archivos: {
        deudores: '^Deudores',
        detalle: '^DetalleDeuda',
        bajas: '^Bajas',
        codeudores: '^CoDeudores',
    },

    deudores: {
        // Joinea con el detalle DENTRO de esta bajada. No sirve como clave del deudor entre días:
        // cuando el cedente reasigna un caso le cambia el IdAsignacion (verificado en 3 de las 6
        // bajas que cruzan con la cartera del 29/05).
        claveAsignacion: 'IdAsignacion',
        nroCliente: 'cliente',
        nombre: 'nombre',
        // CUIT/CUIL, presente y único en los 854 casos: no hacen falta placeholders acá.
        documento: 'codfiscal',
        // Va como contacto de tipo `direccion`. Declarado por partes para que Georef pueda
        // filtrar por localidad y provincia si la remesa pide validar domicilios.
        domicilio: {
            calle: 'calle',
            numero: 'numero',
            piso: 'piso',
            departamento: 'departamento',
            cp: 'codpostal',
            localidad: 'ciudad',
            provincia: 'provincia',
        },
        email: 'email',
        codArea: 'ddd',
        telefonos: ['telefono1', 'telefono2'],
        montoTotal: 'TotalDeuda',
        adicionales: {
            cp: 'codpostal',
            localidad: 'ciudad',
            provincia: 'provincia',
            tipo_persona: 'tipopersona',
            tipo_documento: 'tipocodfiscal',
            cond_iva: 'ivacond',
            fecha_asignacion: 'FechaAsignacion',
            cuotas_vencidas: 'CuotasVencidas',
            dias_mora_max: 'DiasMoraMax',
            // Deuda vigente según el cedente. Se guarda aparte para poder conciliar contra el
            // `montoTotal` que calculamos (Σ facturas, que incluye lo ya cobrado).
            total_declarado: 'TotalDeuda',
        },
    },

    detalle: {
        claveAsignacion: 'IdAsignacion',
        contrato: 'contrato',
        cuota: 'cuota',
        // El header trae el typo del cedente ("FehcaVto"). Se declara tal cual viene.
        vencimiento: 'FehcaVto',
        // La suma de estos 11 conceptos da EXACTAMENTE el TotalDeuda del deudor en los 788 casos
        // que traen detalle. `saldocontrato` NO es el importe (es el saldo del contrato) — sumarlo
        // da mal en el 100% de los casos, va como dato informativo.
        conceptosImporte: {
            Capital: 'capital',
            Interés: 'interes',
            Gastos: 'gastos',
            'Gastos eventuales': 'gas_even',
            ITF: 'itf',
            Seguro: 'seg',
            'Seguro de vida': 'sev',
            IVA: 'iva',
            'Interés moratorio': 'int_mor',
            'Interés punitorio': 'int_pun',
            'IVA mora/punitorios': 'iva_mor_pun',
        },
        adicionales: {
            'Saldo contrato': 'saldocontrato',
            Débito: 'Debito',
            Score: 'IdNameScore',
        },
    },

    // ⚠️ Apagado a propósito. TCFA manda un snapshot completo, así que lo correcto es DESASIGNAR,
    // pero eso saca de gestión a todos los casos que dejen de venir: si un día el archivo llega
    // parcial, se va media cartera. Activarlo recién cuando el cedente confirme que siempre manda
    // la cartera entera. Ver docs/imports-toyota-tcfa-spec.md §D1.
    accionAusente: 'IGNORAR',

    bajas: {
        nroCliente: 'cliente',
        contrato: 'contrato',
        cuota: 'cuota',
        fecha: 'FechaFinGestion',
        motivo: 'Motivo',
        motivoId: 'IDMotivo',
        // Motivos observados en la bajada del 29/05: 1 = Pago de Cuota (65), 4 = Envio a Gestion
        // Especial (18), 3 = Contrato Finalizado/Terminado (2). SOLO el 1 es plata que entró; los
        // otros dos son retiros del cedente y registrar un pago ahí inventaría cobranza.
        motivosPagoIds: ['1'],
        motivosPago: ['Pago de Cuota'],
    },

    codeudores: {
        titular: 'ClienteTitular',
        nroCodeudor: 'ClienteCoDeudor',
        nombre: 'nombre',
        documento: 'CodFiscal',
        domicilio: {
            calle: 'calle',
            numero: 'numero',
            piso: 'piso',
            departamento: 'departamento',
            cp: 'codpostal',
            localidad: 'ciudad',
            provincia: 'Provincia',
        },
        email: 'email',
        codArea: 'ddd',
        telefonos: ['telefono1', 'telefono2'],
        adicionales: {
            cp: 'codpostal',
            localidad: 'ciudad',
            provincia: 'Provincia',
            tipo_persona: 'TipoPersona',
            tipo_documento: 'TipoCodFiscal',
            cond_iva: 'ivacond',
        },
    },
};

/**
 * `mappingJson` completo de la plantilla. Las categorías multiarchivo no usan `columns`/`blocks`
 * (el parser arma las filas), pero el campo es obligatorio en el tipo.
 */
export const TOYOTA_TCFA_MAPPING_JSON = {
    entity: 'MIXTO' as const,
    matchKeys: ['empresaId', 'nroCliente'],
    columns: {},
    multiarchivo: TOYOTA_TCFA_MULTIARCHIVO,
};
