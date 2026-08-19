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
