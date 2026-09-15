import { ALTO_MM, MODULO_MM, QUIETA_MODULOS, construirBarraCode128 } from './codigo-barras-pdf';

const PT_POR_MM = 72 / 25.4;

// Fila real del archivo (spec, ya validada en clave-pago.spec.ts): convenio 96332206, 310 módulos
// totales (Start C + 25 símbolos de datos + checksum + Stop = 27 símbolos de 11 módulos + 1 símbolo
// de Stop de 13 módulos = 297 + 13 = 310).
const CODIGO_BARRAS = '49800019880012710202600000000000096332206000000007';

function contarRects(svg: string): number {
    return (svg.match(/<rect /g) ?? []).length;
}

describe('construirBarraCode128', () => {
    it('el código real del spec da exactamente 310 módulos (Start C + 25 datos + checksum + Stop)', () => {
        const b = construirBarraCode128(CODIGO_BARRAS);
        expect(b.totalModulos).toBe(310);
    });

    it('el módulo mide MODULO_MM (0,25 mm) en puntos', () => {
        const b = construirBarraCode128(CODIGO_BARRAS);
        expect(b.moduloPt).toBeCloseTo(MODULO_MM * PT_POR_MM, 6);
    });

    it('el alto es ALTO_MM (14 mm) en puntos', () => {
        const b = construirBarraCode128(CODIGO_BARRAS);
        expect(b.altoPt).toBeCloseTo(ALTO_MM * PT_POR_MM, 6);
    });

    it('el ancho total incluye la zona muda de QUIETA_MODULOS a cada lado', () => {
        const b = construirBarraCode128(CODIGO_BARRAS);
        const quietaPt = QUIETA_MODULOS * b.moduloPt;
        expect(b.anchoPt).toBeCloseTo(quietaPt * 2 + b.totalModulos * b.moduloPt, 6);
    });

    it('el primer rect empieza justo después de la zona muda izquierda, nunca en x=0', () => {
        const b = construirBarraCode128(CODIGO_BARRAS);
        const m = /<rect x="([\d.]+)"/.exec(b.svg);
        expect(m).not.toBeNull();
        const primerX = Number(m![1]);
        const quietaPt = QUIETA_MODULOS * b.moduloPt;
        expect(primerX).toBeCloseTo(quietaPt, 3);
        expect(primerX).toBeGreaterThan(0);
    });

    it('el último rect termina justo antes de la zona muda derecha', () => {
        const b = construirBarraCode128(CODIGO_BARRAS);
        const rects = [...b.svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)];
        const [, xStr, wStr] = rects[rects.length - 1];
        const finDeLaUltimaBarra = Number(xStr) + Number(wStr);
        // precisión 2 (no 3): el SVG redondea cada coordenada a 3 decimales, y con 85 rects el
        // arrastre de ese redondeo puede superar 0,0005pt — muy por debajo de lo que importa a
        // nivel físico (una diferencia de milésimas de punto es invisible impresa).
        expect(finDeLaUltimaBarra).toBeCloseTo(b.anchoPt - QUIETA_MODULOS * b.moduloPt, 2);
    });

    it('dibuja solo las barras (índices pares de sbs), nunca los espacios', () => {
        const b = construirBarraCode128(CODIGO_BARRAS);
        // 169 elementos bar/espacio alternados (Start+25 datos+checksum a 6 c/u = 27*6=162, + Stop
        // de 7 = 169) → ceil(169/2) = 85 barras.
        expect(contarRects(b.svg)).toBe(85);
    });

    it('el viewBox coincide exactamente con anchoPt x altoPt', () => {
        const b = construirBarraCode128(CODIGO_BARRAS);
        const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(b.svg);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeCloseTo(b.anchoPt, 3);
        expect(Number(m![2])).toBeCloseTo(b.altoPt, 3);
    });

    it('otro código real del archivo (convenio 96311343, TOTAL) también da 310 módulos', () => {
        const b = construirBarraCode128('49800039760032710202600000000000096311343000000009');
        expect(b.totalModulos).toBe(310);
    });

    it('el código del cupón viejo de referencia (46992372.pdf) también da 310 módulos', () => {
        const b = construirBarraCode128('49800043782691508202600000000000094674769000000004');
        expect(b.totalModulos).toBe(310);
    });

    it('rechaza una cantidad impar de dígitos (Code 128-C exige pares)', () => {
        expect(() => construirBarraCode128('123')).toThrow();
    });

    it('rechaza texto con caracteres no numéricos', () => {
        expect(() => construirBarraCode128('12AB')).toThrow();
    });

    it('rechaza una cadena vacía', () => {
        expect(() => construirBarraCode128('')).toThrow();
    });
});
