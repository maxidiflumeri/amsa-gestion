import * as fs from 'fs';
import * as path from 'path';
import { ArchivosMultiarchivo, parseMultiarchivo } from './multiarchivo-parser';
import { TOYOTA_TCFA_MULTIARCHIVO as CFG } from '../plantillas/toyota-tcfa';

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers: arman los buffers del paquete con los headers reales del cedente.
 * ──────────────────────────────────────────────────────────────────────────── */

const H_DEUDORES =
    'IdAsignacion;cliente;nombre;calle;numero;piso;departamento;codpostal;ciudad;codprovincia;' +
    'provincia;tipopersona;tipocodfiscal;codfiscal;ivacond;email;ddd;telefono1;telefono2;' +
    'FechaAsignacion;CuotasVencidas;TotalDeuda;DiasMoraMax';

const H_DETALLE =
    '"IdAsignacion";"cliente";"contrato";"cuota";"FehcaVto";"capital";"interes";"gastos";"gas_even";' +
    '"itf";"seg";"sev";"iva";"int_mor";"int_pun";"iva_mor_pun";"saldocontrato";"Debito";' +
    '"IdNameScore";"Reverso"';

const H_BAJAS = 'IdAsignacion;cliente;contrato;cuota;FechaFinGestion;IDMotivo;Motivo';

const H_CODEUDORES =
    'IdAsignacion;ClienteTitular;ClienteCoDeudor;nombre;calle;numero;piso;departamento;codpostal;' +
    'ciudad;CodProvincia;Provincia;TipoPersona;TipoCodFiscal;CodFiscal;ivacond;email;ddd;' +
    'telefono1;telefono2';

/** Junta header + filas en un buffer Latin-1 con CRLF, como los manda el cedente. */
const buf = (header: string, ...filas: string[]) =>
    Buffer.from([header, ...filas].join('\r\n'), 'latin1');

/**
 * Fila de Deudores. Los campos vienen paddeados a ancho fijo en el archivo real; acá se paddean
 * algunos a propósito para verificar que el parser los trimee.
 */
const deudor = (o: {
    asig: string; cli: string; nombre?: string; cuit?: string; email?: string;
    ddd?: string; tel1?: string; tel2?: string; total?: string; cuotas?: string;
}) =>
    [
        o.asig, o.cli, o.nombre ?? 'PEREZ JUAN', 'AV SIEMPREVIVA    ', '742       ', '', '',
        '3600      ', 'FORMOSA                 ', '09 ', 'FORMOSA          ', 'F   ',
        'CUIT', o.cuit ?? '20123456789 ', 'RI ', o.email ?? '', o.ddd ?? '370     ',
        o.tel1 ?? '', o.tel2 ?? '', '29/5/2026 00:00:00', o.cuotas ?? '1', o.total ?? '1000.00', '10',
    ].join(';');

/** Fila de DetalleDeuda. Los conceptos se pasan en el orden en que los suma el parser. */
const cuota = (o: {
    asig: string; cli: string; ctr: string; cuota: string; vto?: string;
    capital?: string; interes?: string; iva?: string; saldo?: string; score?: string;
}) =>
    [
        o.asig, `"${o.cli}"`, `"${o.ctr}"`, o.cuota, o.vto ?? '8/5/2026 00:00:00',
        o.capital ?? '0.00', o.interes ?? '0.00', '0.00', '0.00', '0.00', '0.00', '0.00',
        o.iva ?? '0.00', '0.00', '0.00', '0.00', o.saldo ?? '0.00', '"N"', o.score ?? '3', '0',
    ].join(';');

const baja = (o: { asig?: string; cli: string; ctr: string; cuota: string; motivoId: string; motivo: string }) =>
    [o.asig ?? '1', o.cli, o.ctr, o.cuota, '29/5/2026 00:00:00', o.motivoId, o.motivo].join(';');

const codeudor = (o: {
    titular: string; codeudor: string; nombre?: string; cuit?: string;
    email?: string; ddd?: string; tel1?: string;
}) =>
    [
        '1', o.titular, o.codeudor, o.nombre ?? 'GOMEZ ANA', 'MITRE        ', '100 ', '', '',
        '3600      ', 'FORMOSA           ', '09 ', 'FORMOSA         ', 'F   ', 'CUIL',
        o.cuit ?? '27987654321 ', 'CF ', o.email ?? '', o.ddd ?? '370     ', o.tel1 ?? '', '',
    ].join(';');

/** Paquete mínimo: Deudores + DetalleDeuda. */
const paquete = (
    deudores: string[],
    detalle: string[],
    bajas?: string[],
    codeudores?: string[],
): ArchivosMultiarchivo => ({
    deudores: buf(H_DEUDORES, ...deudores),
    detalle: buf(H_DETALLE, ...detalle),
    ...(bajas ? { bajas: buf(H_BAJAS, ...bajas) } : {}),
    ...(codeudores ? { codeudores: buf(H_CODEUDORES, ...codeudores) } : {}),
});

const facturasDe = (fila: any) => (fila._blocks ?? []).filter((b: any) => b.entity === 'FACTURA');
const contactosDe = (fila: any) =>
    (fila._blocks ?? []).filter((b: any) => b.entity === 'CONTACTO' && b.data.tipo !== 'direccion');
const direccionesDe = (fila: any) =>
    (fila._blocks ?? []).filter((b: any) => b.entity === 'CONTACTO' && b.data.tipo === 'direccion');

/* ────────────────────────────────────────────────────────────────────────── */

describe('multiarchivo-parser — casos base', () => {
    it('arma un caso con su cuota, sumando los conceptos del detalle', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '368366', cli: '488744', nombre: 'SINCHICAY YMELDA', total: '344483.87' })],
                [cuota({ asig: '368366', cli: '488744', ctr: '1127530', cuota: '13', capital: '143394.21', interes: '85963.89', iva: '115125.77' })],
            ),
            CFG,
        );

        expect(r.resumen.casos).toBe(1);
        expect(r.resumen.facturas).toBe(1);

        const caso = r.filas[0];
        expect(caso._tipo).toBe('CASO');
        expect(caso.nroCliente).toBe('488744');
        expect(caso.nombre).toBe('SINCHICAY YMELDA');
        expect(caso.documento).toBe('20123456789');
        expect(caso.montoTotalDeclarado).toBeCloseTo(344483.87, 2);

        const f = facturasDe(caso);
        expect(f).toHaveLength(1);
        expect(f[0].data.importe).toBeCloseTo(344483.87, 2);
        expect(f[0].data.nroFactura).toBe('1127530-13');
        expect(f[0].data.contrato).toBe('1127530');
        expect(f[0].data.vencimiento).toEqual(new Date(2026, 4, 8));
    });

    it('joinea el detalle por IdAsignacion y NO por cliente', () => {
        // El mismo cliente con una asignación vigente (368376, cuota 10) y una vieja que el cedente
        // sigue mandando (367074, cuota 9). Joineando por cliente se le sumarían las dos: es el bug
        // que inflaba un caso real de $2.199.415 a $6.878.743.
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '368376', cli: '495434', total: '1163802.28' })],
                [
                    cuota({ asig: '368376', cli: '495434', ctr: '1130131', cuota: '10', capital: '1163802.28' }),
                    cuota({ asig: '367074', cli: '495434', ctr: '1130131', cuota: '9', capital: '999999.99' }),
                ],
            ),
            CFG,
        );

        const f = facturasDe(r.filas[0]);
        expect(f).toHaveLength(1);
        expect(f[0].data.nroFactura).toBe('1130131-10');
        expect(f[0].data.importe).toBeCloseTo(1163802.28, 2);

        expect(r.resumen.cuotasDescartadas).toBe(1);
        expect(r.advertencias.join()).toContain('367074');
        expect(r.advertencias.join()).toMatch(/ya no están vigentes/);
    });

    it('emite una factura por cuota, con nroFactura compuesto contrato-cuota', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '368256', cli: '510761', cuotas: '4' })],
                [
                    cuota({ asig: '368256', cli: '510761', ctr: '1134108', cuota: '4', capital: '100.00' }),
                    cuota({ asig: '368256', cli: '510761', ctr: '1134109', cuota: '4', capital: '200.00' }),
                    cuota({ asig: '368256', cli: '510761', ctr: '1134111', cuota: '4', capital: '300.00' }),
                ],
            ),
            CFG,
        );

        const f = facturasDe(r.filas[0]);
        expect(f).toHaveLength(3);
        expect(f.map((x: any) => x.data.nroFactura)).toEqual(['1134108-4', '1134109-4', '1134111-4']);
    });

    it('el desglose omite los conceptos en cero y agrega los informativos al final', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '1' })],
                [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1000.00', iva: '210.00', saldo: '50.00', score: '5' })],
            ),
            CFG,
        );

        const d = facturasDe(r.filas[0])[0].data.detalle;
        expect(d).toBe('Capital: 1000.00 | IVA: 210.00 | Saldo contrato: 50.00 | Débito: N | Score: 5');
        expect(d).not.toContain('Gastos');
        expect(d).not.toContain('Seguro');
    });

    it('ignora los rellenos del cedente en el domicilio', () => {
        // El archivo usa "0", "S/N" y "S/C" como "no aplica". Sin filtrarlos quedaba
        // "Barrio 7 de mayo mz 10 casa 25 0 Dpto 0", que además arruina el matcheo con Georef.
        const conRelleno = [
            '1', '1', 'PEREZ JUAN', 'Barrio 7 de mayo mz 10 casa 25', '0', '', '0',
            '3600', 'FORMOSA', '09', 'FORMOSA', 'F', 'CUIT', '20123456789', 'RI', '',
            '370', '', '', '29/5/2026 00:00:00', '1', '1000.00', '10',
        ].join(';');
        const r = parseMultiarchivo(
            paquete([conRelleno], [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })]),
            CFG,
        );

        expect(direccionesDe(r.filas[0])[0].data).toEqual({
            tipo: 'direccion',
            direccion_calle: 'Barrio 7 de mayo mz 10 casa 25',
            direccion_cp: '3600',
            direccion_localidad: 'FORMOSA',
            direccion_provincia: 'FORMOSA',
        });
    });

    it('no crea dirección si el caso no tiene calle ni número reales', () => {
        // 4 casos del archivo real vienen con calle "S/C" y número "0": no tienen domicilio.
        const sinDomicilio = [
            '1', '1', 'GUZMAN JORGE', 'S/C', '0', '', '', '4743', 'ACONQUIJA', '03', 'CATAMARCA',
            'F', 'CUIL', '20300061320', 'CF', '', '383', '4354155', '', '29/5/2026 00:00:00', '1', '1.00', '10',
        ].join(';');
        const r = parseMultiarchivo(
            paquete([sinDomicilio], [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })]),
            CFG,
        );

        expect(direccionesDe(r.filas[0])).toHaveLength(0);
    });

    it('arma los contactos anteponiendo el código de área a cada teléfono', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '1', ddd: '341     ', tel1: '6693578        ', tel2: '4818748        ', email: 'juan@mail.com' })],
                [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })],
            ),
            CFG,
        );

        expect(contactosDe(r.filas[0])).toEqual([
            { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '3416693578' } },
            { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '3414818748' } },
            { entity: 'CONTACTO', data: { tipo: 'email', valor: 'juan@mail.com' } },
        ]);
    });

    it('carga el domicilio como contacto de tipo direccion, no como dato adicional', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '1', total: '5000.00' })],
                [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })],
            ),
            CFG,
        );

        // Va por partes para que Georef pueda filtrar por localidad/provincia, y para que la ficha
        // lo muestre en la sección de Direcciones en vez de en el cajón de datos adicionales.
        expect(direccionesDe(r.filas[0])).toEqual([
            {
                entity: 'CONTACTO',
                data: {
                    tipo: 'direccion',
                    direccion_calle: 'AV SIEMPREVIVA',
                    direccion_numero: '742',
                    direccion_cp: '3600',
                    direccion_localidad: 'FORMOSA',
                    direccion_provincia: 'FORMOSA',
                },
            },
        ]);
        expect(r.filas[0].camposAdicionales).not.toHaveProperty('domicilio');

        expect(r.filas[0].camposAdicionales).toMatchObject({
            cp: '3600',
            localidad: 'FORMOSA',
            tipo_persona: 'F',
            tipo_documento: 'CUIT',
            cond_iva: 'RI',
            cuotas_vencidas: '1',
            dias_mora_max: '10',
            total_declarado: '5000.00',
        });
    });
});

describe('multiarchivo-parser — codeudores', () => {
    it('suma los contactos del codeudor marcados con relacion y guarda su ficha', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '433700', tel1: '4702246        ' })],
                [cuota({ asig: '1', cli: '433700', ctr: 'C1', cuota: '1', capital: '1.00' })],
                undefined,
                [codeudor({ titular: '433700', codeudor: '398673', nombre: 'BOBADILLA PASCUAL CESAR', tel1: '4006898        ', email: 'co@mail.com' })],
            ),
            CFG,
        );

        const contactos = contactosDe(r.filas[0]);
        // Los del titular no llevan `relacion`; los del codeudor sí, para que el gestor sepa a quién
        // llama. Y van después: si comparten teléfono, el unique deja el del titular (ver parser).
        expect(contactos).toEqual([
            { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '3704702246' } },
            { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '3704006898', relacion: 'CODEUDOR' } },
            { entity: 'CONTACTO', data: { tipo: 'email', valor: 'co@mail.com', relacion: 'CODEUDOR' } },
        ]);

        expect(r.resumen.codeudores).toBe(1);
        expect(r.filas[0].camposAdicionales!.codeudores).toEqual([
            expect.objectContaining({
                nro_cliente: '398673',
                nombre: 'BOBADILLA PASCUAL CESAR',
                documento: '27987654321',
            }),
        ]);

        // El domicilio del codeudor también va como contacto, marcado, para poder visitarlo.
        const dirs = direccionesDe(r.filas[0]);
        expect(dirs).toHaveLength(2);
        expect(dirs[1].data).toMatchObject({ direccion_calle: 'MITRE', relacion: 'CODEUDOR' });
    });

    it('soporta más de un codeudor por titular', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '407559' })],
                [cuota({ asig: '1', cli: '407559', ctr: 'C1', cuota: '1', capital: '1.00' })],
                undefined,
                [
                    codeudor({ titular: '407559', codeudor: '259585', nombre: 'SEBASTIANO JUAN', tel1: '69749495' }),
                    codeudor({ titular: '407559', codeudor: '307346', nombre: 'SEBASTIANO HORACIO', tel1: '60426255' }),
                ],
            ),
            CFG,
        );

        expect(r.resumen.codeudores).toBe(2);
        expect(r.filas[0].camposAdicionales!.codeudores).toHaveLength(2);
    });

    it('avisa y omite el codeudor cuyo titular no vino en Deudores', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '111' })],
                [cuota({ asig: '1', cli: '111', ctr: 'C1', cuota: '1', capital: '1.00' })],
                undefined,
                [codeudor({ titular: '999', codeudor: '888' })],
            ),
            CFG,
        );

        expect(r.resumen.codeudores).toBe(0);
        expect(r.advertencias.join()).toContain('999');
        // Solo queda la dirección del titular; nada del codeudor huérfano.
        expect(contactosDe(r.filas[0])).toHaveLength(0);
        expect(direccionesDe(r.filas[0])).toHaveLength(1);
    });
});

describe('multiarchivo-parser — bajas', () => {
    it('emite una fila BAJA por cuota, con el nroFactura compuesto y el código de motivo', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '368366', cli: '488744' })],
                [cuota({ asig: '368366', cli: '488744', ctr: '1127530', cuota: '13', capital: '344483.87' })],
                [baja({ cli: '488744', ctr: '1127530', cuota: '12', motivoId: '1', motivo: 'Pago de Cuota' })],
            ),
            CFG,
        );

        expect(r.resumen.bajas).toBe(1);
        const b = r.filas.find((f) => f._tipo === 'BAJA')!;
        expect(b).toMatchObject({
            _tipo: 'BAJA',
            nroCliente: '488744',
            nroFactura: '1127530-12',
            contrato: '1127530',
            cuota: '12',
            motivoId: '1',
            motivo: 'Pago de Cuota',
        });
        expect(b.fecha).toEqual(new Date(2026, 4, 29));
    });

    it('el caso sigue vivo con las cuotas que no se dieron de baja', () => {
        // Es el escenario de pago parcial: baja la cuota 12, la 13 sigue en el detalle de hoy.
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '368366', cli: '488744' })],
                [cuota({ asig: '368366', cli: '488744', ctr: '1127530', cuota: '13', capital: '344483.87' })],
                [baja({ cli: '488744', ctr: '1127530', cuota: '12', motivoId: '1', motivo: 'Pago de Cuota' })],
            ),
            CFG,
        );

        const caso = r.filas.find((f) => f._tipo === 'CASO')!;
        expect(facturasDe(caso)).toHaveLength(1);
        expect(facturasDe(caso)[0].data.nroFactura).toBe('1127530-13');
    });

    it('distingue los motivos que son pago de los que son retiro del cedente', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '1' })],
                [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })],
                [
                    baja({ cli: '1', ctr: 'C1', cuota: '1', motivoId: '1', motivo: 'Pago de Cuota' }),
                    baja({ cli: '2', ctr: 'C2', cuota: '2', motivoId: '4', motivo: 'Envio a Gestion Especial' }),
                    baja({ cli: '3', ctr: 'C3', cuota: '3', motivoId: '3', motivo: 'Contrato Finalizado/Terminado' }),
                ],
            ),
            CFG,
        );

        const bajas = r.filas.filter((f) => f._tipo === 'BAJA');
        expect(bajas.map((b) => b.motivoId)).toEqual(['1', '4', '3']);
        // La decisión de cuál es pago la toma el processor con `motivosPagoIds` de la plantilla.
        expect(CFG.bajas!.motivosPagoIds).toEqual(['1']);
    });

    it('omite y avisa la baja incompleta', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '1' })],
                [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })],
                ['1;;C1;1;29/5/2026 00:00:00;1;Pago de Cuota'],
            ),
            CFG,
        );

        expect(r.resumen.bajas).toBe(0);
        expect(r.advertencias.join()).toMatch(/Baja incompleta/);
    });
});

describe('multiarchivo-parser — bordes', () => {
    it('carga el caso sin cuotas con el total declarado y avisa', () => {
        const r = parseMultiarchivo(
            paquete([deudor({ asig: '265709', cli: '104458', total: '70836.00' })], []),
            CFG,
        );

        expect(r.resumen.casos).toBe(1);
        expect(r.resumen.casosSinDetalle).toBe(1);
        expect(facturasDe(r.filas[0])).toHaveLength(0);
        expect(r.filas[0].montoTotalDeclarado).toBeCloseTo(70836, 2);
        expect(r.advertencias.join()).toMatch(/no traen ninguna cuota/);
    });

    it('decodifica Latin-1 (en UTF-8 las Ñ y los acentos se rompen)', () => {
        const archivos = paquete(
            [deudor({ asig: '1', cli: '1', nombre: 'ACUÑA HAEDO IVÁN' })],
            [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })],
        );
        expect(parseMultiarchivo(archivos, CFG).filas[0].nombre).toBe('ACUÑA HAEDO IVÁN');
        expect(parseMultiarchivo(archivos, { ...CFG, encoding: 'utf8' }).filas[0].nombre)
            .not.toBe('ACUÑA HAEDO IVÁN');
    });

    it('no duplica el cliente repetido: conserva la primera ficha', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '7', nombre: 'PRIMERA' }), deudor({ asig: '2', cli: '7', nombre: 'SEGUNDA' })],
                [cuota({ asig: '1', cli: '7', ctr: 'C1', cuota: '1', capital: '1.00' })],
            ),
            CFG,
        );

        expect(r.resumen.casos).toBe(1);
        expect(r.filas[0].nombre).toBe('PRIMERA');
        expect(r.advertencias.join()).toMatch(/repetido/);
    });

    it('omite y avisa la fila de deudor sin número de cliente', () => {
        const r = parseMultiarchivo(paquete([deudor({ asig: '1', cli: '' })], []), CFG);
        expect(r.resumen.casos).toBe(0);
        expect(r.advertencias.join()).toMatch(/sin número de cliente/);
    });

    it('falla nombrando las columnas si la plantilla declara una que el archivo no trae', () => {
        const archivos = paquete([deudor({ asig: '1', cli: '1' })], []);
        const roto = { ...CFG, deudores: { ...CFG.deudores, nroCliente: 'nro_cliente' } };
        // Un typo en la plantilla, si se ignorara, cargaría toda la bajada con el campo vacío.
        expect(() => parseMultiarchivo(archivos, roto)).toThrow(/"nro_cliente"/);
        expect(() => parseMultiarchivo(archivos, roto)).toThrow(/archivo de deudores/);
    });

    it('encuentra las columnas sin distinguir mayúsculas', () => {
        // El cedente escribe `codprovincia` en Deudores y `CodProvincia` en CoDeudores.
        const archivos = paquete(
            [deudor({ asig: '1', cli: '1' })],
            [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })],
        );
        const cfg = { ...CFG, deudores: { ...CFG.deudores, nroCliente: 'CLIENTE' } };
        expect(parseMultiarchivo(archivos, cfg).filas[0].nroCliente).toBe('1');
    });

    it('funciona sin los archivos opcionales de bajas y codeudores', () => {
        const r = parseMultiarchivo(
            paquete(
                [deudor({ asig: '1', cli: '1' })],
                [cuota({ asig: '1', cli: '1', ctr: 'C1', cuota: '1', capital: '1.00' })],
            ),
            CFG,
        );
        expect(r.resumen.bajas).toBe(0);
        expect(r.resumen.codeudores).toBe(0);
        expect(r.filas).toHaveLength(1);
    });
});

/**
 * Verificación contra el paquete real del cedente. Es la prueba que importa: valida el parser contra
 * el formato de verdad, no contra el que creemos que es. Si el paquete no está presente (otra
 * máquina, CI) el bloque se saltea en vez de fallar.
 */
const DIR_REAL = '/home/maxi/Documentos/Ana Maya SA/IO_20260529';
const hayPaquete = ['Deudores.txt', 'DetalleDeuda.txt', 'Bajas.txt', 'CoDeudores.txt']
    .every((f) => fs.existsSync(path.join(DIR_REAL, f)));

(hayPaquete ? describe : describe.skip)('multiarchivo-parser — paquete real de Toyota TCFA (2026-05-29)', () => {
    let r: ReturnType<typeof parseMultiarchivo>;

    beforeAll(() => {
        const leer = (f: string) => fs.readFileSync(path.join(DIR_REAL, f));
        r = parseMultiarchivo(
            {
                deudores: leer('Deudores.txt'),
                detalle: leer('DetalleDeuda.txt'),
                bajas: leer('Bajas.txt'),
                codeudores: leer('CoDeudores.txt'),
            },
            CFG,
        );
    });

    it('lee los cuatro archivos completos', () => {
        expect(r.resumen.lineas).toEqual({ deudores: 854, detalle: 981, bajas: 85, codeudores: 55 });
    });

    it('arma 854 casos, 920 facturas, 85 bajas y 55 codeudores', () => {
        expect(r.resumen.casos).toBe(854);
        // 981 cuotas del archivo − 61 de asignaciones que ya no están vigentes.
        expect(r.resumen.facturas).toBe(920);
        expect(r.resumen.bajas).toBe(85);
        expect(r.resumen.codeudores).toBe(55);
    });

    it('descarta las 61 cuotas de asignaciones no vigentes', () => {
        expect(r.resumen.cuotasDescartadas).toBe(61);
        expect(r.resumen.casosSinDetalle).toBe(66);
    });

    it('la suma de las cuotas coincide EXACTO con el TotalDeuda del cedente', () => {
        // Es la verificación central: si el join se hiciera por cliente en vez de por asignación,
        // acá fallarían dos casos con diferencias de $193.110 y $4.679.327.
        const totales = new Map<string, number>();
        const filas = fs.readFileSync(path.join(DIR_REAL, 'Deudores.txt'), 'latin1').split(/\r?\n/).slice(1);
        for (const l of filas) {
            if (!l.trim()) continue;
            const c = l.split(';');
            totales.set(c[1].trim(), Number(c[21]));
        }

        let comparados = 0;
        for (const caso of r.filas.filter((f) => f._tipo === 'CASO')) {
            const facturas = facturasDe(caso);
            if (facturas.length === 0) continue;   // los 66 sin detalle no tienen con qué comparar
            const suma = facturas.reduce((a: number, b: any) => a + b.data.importe, 0);
            expect(suma).toBeCloseTo(totales.get(caso.nroCliente as string)!, 2);
            comparados++;
        }
        expect(comparados).toBe(788);
    });

    it('la cantidad de cuotas coincide con las CuotasVencidas que declara el cedente', () => {
        let comparados = 0;
        for (const caso of r.filas.filter((f) => f._tipo === 'CASO')) {
            const facturas = facturasDe(caso);
            if (facturas.length === 0) continue;
            expect(facturas).toHaveLength(Number(caso.camposAdicionales!.cuotas_vencidas));
            comparados++;
        }
        expect(comparados).toBe(788);
    });

    it('el nroFactura es único dentro de cada caso', () => {
        for (const caso of r.filas.filter((f) => f._tipo === 'CASO')) {
            const nros = facturasDe(caso).map((f: any) => f.data.nroFactura);
            expect(new Set(nros).size).toBe(nros.length);
        }
    });

    it('todos los casos traen CUIT/CUIL real: no hacen falta placeholders', () => {
        const casos = r.filas.filter((f) => f._tipo === 'CASO');
        expect(casos.every((c) => /^\d{11}$/.test(String(c.documento)))).toBe(true);
        expect(new Set(casos.map((c) => c.documento)).size).toBe(854);
    });

    it('parsea todos los vencimientos (ninguno queda en null)', () => {
        const vtos = r.filas
            .filter((f) => f._tipo === 'CASO')
            .flatMap((c) => facturasDe(c).map((f: any) => f.data.vencimiento));
        expect(vtos).toHaveLength(920);
        expect(vtos.every((v) => v instanceof Date)).toBe(true);
    });

    it('parsea la fecha de todas las bajas', () => {
        const bajas = r.filas.filter((f) => f._tipo === 'BAJA');
        expect(bajas.every((b) => b.fecha instanceof Date)).toBe(true);
        // 65 pagos de cuota, 18 envíos a gestión especial, 2 contratos finalizados.
        const porMotivo = bajas.reduce<Record<string, number>>((a, b) => {
            a[b.motivoId as string] = (a[b.motivoId as string] ?? 0) + 1;
            return a;
        }, {});
        expect(porMotivo).toEqual({ '1': 65, '3': 2, '4': 18 });
    });

    it('respeta los acentos y las Ñ de los nombres', () => {
        const nombres = r.filas.filter((f) => f._tipo === 'CASO').map((f) => f.nombre as string).join();
        expect(nombres).toContain('CAÑICUL');
        expect(nombres).not.toContain('�');
    });

    it('solo advierte de las cuotas huérfanas y de los casos sin detalle', () => {
        expect(r.advertencias).toHaveLength(2);
        expect(r.advertencias[0]).toMatch(/^61 cuota\(s\) del detalle/);
        expect(r.advertencias[1]).toMatch(/^66 caso\(s\) no traen ninguna cuota/);
    });
});
