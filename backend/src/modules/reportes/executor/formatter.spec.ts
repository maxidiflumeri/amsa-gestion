process.env.TZ = 'America/Argentina/Buenos_Aires';

import { Formatter } from './formatter';

// Los cuatro patrones que trae el catálogo (`seed-formatos-tel.ts`), con el ejemplo que declara
// cada uno en su descripción. El ejemplo es la especificación: si el patrón no devuelve algo con
// esa forma, el formato está mal.
const CATALOGO = {
  whatsapp: '549{numero}',
  nacionalCon0: '0{numero}',
  soloNumero: '{numero}',
  internacional: '+549{numero}',
};

describe('Formatter — teléfonos', () => {
  const f = new Formatter();

  // Un celular de CABA tal como lo guarda el importador: E.164, con el 9 de móvil.
  const CELULAR = '+5491163525026';
  // Un fijo de CABA: mismo formato, sin el 9.
  const FIJO = '+541142407390';

  describe('celular (el caso que estaba roto)', () => {
    it('sin patrón devuelve el número nacional, sin el 54 ni el 9 de móvil', () => {
      expect(f.formatTelefono(CELULAR)).toBe('1163525026');
    });

    it('cada patrón del catálogo devuelve lo que promete su descripción', () => {
      expect(f.formatTelefono(CELULAR, CATALOGO.whatsapp)).toBe('5491163525026');
      expect(f.formatTelefono(CELULAR, CATALOGO.nacionalCon0)).toBe('01163525026');
      expect(f.formatTelefono(CELULAR, CATALOGO.soloNumero)).toBe('1163525026');
      expect(f.formatTelefono(CELULAR, CATALOGO.internacional)).toBe('+5491163525026');
    });

    it('no deja dos nueves: el 9 de móvil no es parte del número', () => {
      expect(f.formatTelefono(CELULAR, CATALOGO.whatsapp)).not.toContain('5499');
    });
  });

  describe('fijo', () => {
    it('sin patrón devuelve los 10 dígitos nacionales', () => {
      expect(f.formatTelefono(FIJO)).toBe('1142407390');
    });

    it('el patrón nacional con 0 le antepone el 0 y nada más', () => {
      expect(f.formatTelefono(FIJO, CATALOGO.nacionalCon0)).toBe('01142407390');
    });
  });

  describe('características de más de dos dígitos', () => {
    // Bariloche: área 294, abonado de 7. El nacional siempre suma 10 dígitos, pero el área ocupa
    // 2, 3 o 4 según la zona — por eso se resuelve contra la tabla de ENACOM y no por posición.
    it('resuelve un celular del interior', () => {
      expect(f.formatTelefono('+5492944422222', CATALOGO.soloNumero)).toBe('2944422222');
    });

    it('resuelve un fijo del interior', () => {
      expect(f.formatTelefono('+542944422222', CATALOGO.nacionalCon0)).toBe('02944422222');
    });

    it('parte el área donde corresponde, no a los dos dígitos', () => {
      expect(f.formatTelefono('+542944422222', '{area}-{abonado}')).toBe('294-4422222');
      expect(f.formatTelefono('+541142407390', '{area}-{abonado}')).toBe('11-42407390');
    });
  });

  // El discado local de celular que pide Neotel para las tramas de IPLAN. No se puede expresar con
  // un solo `{numero}`: el `15` va en el medio, entre la característica y el abonado.
  describe('local con 15 — 0{area}{15}{abonado}', () => {
    const LOCAL = '0{area}{15}{abonado}';

    it('al celular le mete el 15 entre el área y el abonado', () => {
      expect(f.formatTelefono(CELULAR, LOCAL)).toBe('0111563525026');
    });

    it('al fijo no: un fijo con 15 no se puede marcar', () => {
      expect(f.formatTelefono(FIJO, LOCAL)).toBe('01142407390');
    });

    it('reconoce el celular guardado sin el 9 por los rangos de ENACOM', () => {
      expect(f.formatTelefono('+541155775452', LOCAL)).toBe('0111555775452');
    });

    it('reconoce el celular que trae el 9 aunque no esté en ningún rango de ENACOM', () => {
      expect(f.formatTelefono('+5492944422222', LOCAL)).toBe('0294154422222');
    });

    it('respeta el área del interior', () => {
      expect(f.formatTelefono('+542944422222', LOCAL)).toBe('02944422222');
    });

    it('si no se puede sacar la característica degrada a 0{numero}, no inventa una', () => {
      expect(f.formatTelefono('12345', LOCAL)).toBe('012345');
    });
  });

  describe('valores que no vienen normalizados', () => {
    it('acepta el número sin el +', () => {
      expect(f.formatTelefono('5491163525026', CATALOGO.soloNumero)).toBe('1163525026');
    });

    it('acepta el nacional con 0 y el 15 local', () => {
      expect(f.formatTelefono('01115-6352-5026', CATALOGO.whatsapp)).toBe('5491163525026');
    });

    it('acepta el número escrito con separadores', () => {
      expect(f.formatTelefono('+54 9 11 6352-5026', CATALOGO.soloNumero)).toBe('1163525026');
    });
  });

  describe('bordes', () => {
    it('vacío / null / undefined devuelven cadena vacía', () => {
      expect(f.formatTelefono('')).toBe('');
      expect(f.formatTelefono(null)).toBe('');
      expect(f.formatTelefono(undefined)).toBe('');
    });

    it('un valor que no se puede interpretar se imprime igual, no se pierde', () => {
      // Mejor un teléfono raro en la celda que una celda vacía: el gestor ve que hay algo.
      expect(f.formatTelefono('12345')).toBe('12345');
    });

    it('el patrón se aplica tal cual, sin mirar si la línea es fija o móvil', () => {
      // Un patrón de móvil sobre un fijo devuelve un número con el 9. Es decisión de la plantilla.
      expect(f.formatTelefono(FIJO, CATALOGO.whatsapp)).toBe('5491142407390');
    });
  });

  describe('formatValue enruta por tipo', () => {
    it('tipo telefono formatea', () => {
      expect(f.formatValue(CELULAR, 'telefono')).toBe('1163525026');
    });

    it('tipo texto devuelve el valor crudo de la base', () => {
      expect(f.formatValue(CELULAR, 'texto')).toBe(CELULAR);
    });
  });
});


// ─── Extensiones del motor: E2 (días desde), E3 (decimales y separadores) ─────────────────────

describe('Formatter — sin las propiedades nuevas la salida no cambia (snapshot)', () => {
  const f = new Formatter();
  const fecha = new Date(2026, 2, 5, 10, 0, 0);

  // Valores fijados con lo que devolvía el formatter antes de E2/E3. Si alguno cambia, una plantilla
  // guardada empieza a salir distinta.
  const CASOS: Array<[string, any, string | undefined, string | undefined, any]> = [
    ['numero sin formato', 1234.5, 'numero', undefined, '1234.5'],
    ['numero con formato', 1234.5, 'numero', '0,0.00', '1.234,5'],
    ['numero entero con formato', 1234567, 'numero', '#', '1.234.567'],
    ['numero grande sin formato', 1234567.891, 'numero', undefined, '1234567.891'],
    ['sin tipo, un número', 42.5, undefined, undefined, '42.5'],
    ['sin tipo, un número con formato', 12345.678, undefined, 'x', '12.345,678'],
    ['moneda', 1500.5, 'moneda', undefined, f.formatValue(1500.5, 'moneda')],
    ['fecha por defecto', fecha, 'fecha', undefined, '05/03/2026'],
    ['fecha con formato', fecha, 'fecha', 'YYYY-MM-DD HH:mm', '2026-03-05 10:00'],
    ['boolean', true, 'boolean', undefined, 'Sí'],
    ['texto', 'hola', 'texto', undefined, 'hola'],
    ['null', null, 'numero', undefined, ''],
    ['undefined', undefined, 'fecha', undefined, ''],
    ['número como texto sin tipo numérico', '1234.5', 'texto', undefined, '1234.5'],
  ];

  it.each(CASOS)('%s', (_n, valor, tipo, formato, esperado) => {
    expect(f.formatValue(valor, tipo, formato)).toBe(esperado);
  });

  it('con las opciones vacías (lo que arma formatFila para una columna común) da lo mismo', () => {
    for (const [, valor, tipo, formato, esperado] of CASOS) {
      expect(f.formatValue(valor, tipo, formato, {})).toBe(esperado);
      expect(f.formatFila({ C: valor }, [{ label: 'C', tipo, formato }])).toEqual({ C: esperado });
    }
  });

  it('decimales o separadores en una columna que no es numero no hacen nada', () => {
    expect(f.formatValue(1234.5, 'texto', undefined, { decimales: 2, separadorDecimal: ',' })).toBe('1234.5');
    expect(f.formatValue(1234.5, 'moneda', undefined, { decimales: 0 })).toBe(f.formatValue(1234.5, 'moneda'));
  });
});

describe('Formatter — E3 decimales y separadores', () => {
  const f = new Formatter();
  const num = (v: any, o: any) => f.formatValue(v, 'numero', undefined, o);

  it.each([
    [0, '1.235'],
    [1, '1.234,6'],
    [2, '1.234,57'],
    [3, '1.234,568'],
    [4, '1.234,5678'],
  ])('%i decimales, defaults: coma decimal y punto de miles', (d, esperado) => {
    expect(num(1234.5678, { decimales: d })).toBe(esperado);
  });

  it('completa con ceros hasta los decimales pedidos', () => {
    expect(num(5, { decimales: 2 })).toBe('5,00');
    expect(num(0.5, { decimales: 3 })).toBe('0,500');
    expect(num(1234, { decimales: 2 })).toBe('1.234,00');
  });

  it('separadores de los dos estilos y sin miles', () => {
    expect(num(1234567.891, { decimales: 2, separadorDecimal: '.', separadorMiles: ',' })).toBe('1,234,567.89');
    expect(num(1234567.891, { decimales: 2, separadorDecimal: ',', separadorMiles: '' })).toBe('1234567,89');
    expect(num(1234567.891, { decimales: 2, separadorDecimal: '.', separadorMiles: '' })).toBe('1234567.89');
    expect(num(1234567.891, { decimales: 0, separadorMiles: '' })).toBe('1234568');
  });

  it('solo un separador: el otro se acomoda para no chocar', () => {
    expect(num(1234.5, { separadorDecimal: '.' })).toBe('1,234.5');
    expect(num(1234.5, { separadorMiles: ',' })).toBe('1,234.5');
    expect(num(1234.5, { separadorMiles: '.' })).toBe('1.234,5');
  });

  it('sin decimales deja los que tiene el número', () => {
    expect(num(1234.5, { separadorMiles: '.' })).toBe('1.234,5');
    expect(num(1234, { separadorMiles: '.' })).toBe('1.234');
    expect(num(0.125, { separadorDecimal: ',' })).toBe('0,125');
  });

  it('no usa notación científica', () => {
    expect(num(1e21, { separadorMiles: '' })).toBe('1000000000000000000000');
    expect(num(0.0000001, { separadorDecimal: ',' })).toBe('0,0000001');
  });

  it('los miles en los bordes: 999, 1.000, 999.999, 1.000.000', () => {
    expect(num(999, { decimales: 0 })).toBe('999');
    expect(num(1000, { decimales: 0 })).toBe('1.000');
    expect(num(999999, { decimales: 0 })).toBe('999.999');
    expect(num(1000000, { decimales: 0 })).toBe('1.000.000');
  });

  it('negativos, y un negativo que redondea a cero no deja "-0,00"', () => {
    expect(num(-1234.5, { decimales: 2 })).toBe('-1.234,50');
    expect(num(-0.001, { decimales: 2 })).toBe('0,00');
    expect(num(-0.006, { decimales: 2 })).toBe('-0,01');
  });

  it('redondea como lo espera quien mira el número (1.005 → 1,01, no 1,00)', () => {
    expect(num(1.005, { decimales: 2 })).toBe('1,01');
    expect(num(2.5, { decimales: 0 })).toBe('3');
  });

  it('acepta el número como texto o bigint; lo que no es un número sale tal cual', () => {
    expect(num('1234.5', { decimales: 2 })).toBe('1.234,50');
    expect(num(BigInt(1234567), { decimales: 0 })).toBe('1.234.567');
    expect(num('abc', { decimales: 2 })).toBe('abc');
    expect(num('', { decimales: 2 })).toBe('');
    expect(num(NaN, { decimales: 2 })).toBeNaN();
  });

  it('null sale vacío', () => {
    expect(num(null, { decimales: 2 })).toBe('');
  });

  it('formatFila lo aplica por columna y no toca a las demás', () => {
    const fila = { Saldo: 1234.5, Otro: 1234.5 };
    expect(
      f.formatFila(fila, [
        { label: 'Saldo', tipo: 'numero', decimales: 2 },
        { label: 'Otro', tipo: 'numero' },
      ]),
    ).toEqual({ Saldo: '1.234,50', Otro: '1234.5' });
  });
});

describe('Formatter — E2 días desde la fecha', () => {
  const f = new Formatter();
  const HOY = '2026-10-17';
  const dias = (v: any, tipoFecha?: 'calendario' | 'instante', hoyYmd = HOY) => f.formatValue(v, 'dias', undefined, { tipoFecha, hoyYmd });

  it('una fecha calendario de hace 90 días da 90', () => {
    expect(dias(new Date('2026-07-19T00:00:00.000Z'), 'calendario')).toBe(90);
  });

  it('una fecha calendario guardada a las 00:00Z o a las 03:00Z es el mismo día', () => {
    expect(dias(new Date('2026-10-10T00:00:00.000Z'), 'calendario')).toBe(7);
    expect(dias(new Date('2026-10-10T03:00:00.000Z'), 'calendario')).toBe(7);
    expect(dias(new Date('2026-10-10T02:00:00.000Z'), 'calendario')).toBe(7);
  });

  it('un instante usa el día local: 23:30 AR del 10 (= 02:30Z del 11) es el 10', () => {
    expect(dias(new Date('2026-10-11T02:30:00.000Z'), 'instante')).toBe(7);
    expect(dias(new Date('2026-10-11T03:10:00.000Z'), 'instante')).toBe(6); // 00:10 AR del 11
  });

  it('sin clasificar se trata como instante', () => {
    expect(dias(new Date('2026-10-11T02:30:00.000Z'))).toBe(7);
  });

  it('el mismo día es 0', () => {
    expect(dias(new Date('2026-10-17T00:00:00.000Z'), 'calendario')).toBe(0);
    expect(dias(new Date(2026, 9, 17, 23, 59, 59), 'instante')).toBe(0);
  });

  it('una fecha futura da negativo', () => {
    expect(dias(new Date('2026-10-24T00:00:00.000Z'), 'calendario')).toBe(-7);
  });

  it('cruza fin de mes, de año y bisiesto', () => {
    expect(dias(new Date('2026-09-30T00:00:00.000Z'), 'calendario', '2026-10-02')).toBe(2);
    expect(dias(new Date('2025-12-31T00:00:00.000Z'), 'calendario', '2026-01-01')).toBe(1);
    expect(dias(new Date('2028-02-28T00:00:00.000Z'), 'calendario', '2028-03-01')).toBe(2);
  });

  it('null y undefined salen vacíos; lo que no es una fecha también', () => {
    expect(dias(null)).toBe('');
    expect(dias(undefined)).toBe('');
    expect(dias('no es una fecha')).toBe('');
    expect(dias(new Date('nada'))).toBe('');
    expect(dias(42)).toBe('');
  });

  it('un YYYY-MM-DD de texto (dato adicional) cuenta como día calendario', () => {
    expect(dias('2026-10-10')).toBe(7);
    expect(dias('2026-13-40')).toBe('');
  });

  it('es un número (no un texto), así sum y avg de los totales andan', () => {
    expect(typeof dias(new Date('2026-07-19T00:00:00.000Z'), 'calendario')).toBe('number');
  });

  it('sin hoyYmd usa el día de hoy en hora local', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-17T02:59:00.000Z')); // 23:59 AR del 16
    try {
      expect(f.formatValue(new Date('2026-10-10T00:00:00.000Z'), 'dias', undefined, { tipoFecha: 'calendario' })).toBe(6);
      jest.setSystemTime(new Date('2026-10-17T03:00:00.000Z')); // 00:00 AR del 17
      expect(f.formatValue(new Date('2026-10-10T00:00:00.000Z'), 'dias', undefined, { tipoFecha: 'calendario' })).toBe(7);
    } finally {
      jest.useRealTimers();
    }
  });
});
