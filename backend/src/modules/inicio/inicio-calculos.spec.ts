process.env.TZ = 'America/Argentina/Buenos_Aires';

import { calcularAgenda, calcularGestiones, CuotaFila, DeudorAgenda, PromesaFila, recortarTexto } from './inicio-calculos';

// Viernes 16/10/2026 10:30 hora de Argentina.
const AHORA = new Date('2026-10-16T13:30:00.000Z');
/** Fecha local de Argentina (UTC−3) a partir de día y hora. */
const local = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`);
const fila = (dia: string, hhmm: string, deudorId = 1) => ({ fecha: local(dia, hhmm), deudorId });

describe('calcularGestiones', () => {
    it('una gestión a las 22:30 locales del 15/10 cae en el día 15, no en el 16', () => {
        const g = calcularGestiones([fila('2026-10-15', '22:30')], AHORA, false);
        expect(g.hoy).toBe(0);
        expect(g.serie.find((d) => d.dia === '2026-10-15')?.gestiones).toBe(1);
        expect(g.serie.find((d) => d.dia === '2026-10-16')?.gestiones).toBe(0);
    });

    it('la serie tiene 14 días consecutivos sin huecos, del 03/10 al 16/10', () => {
        const g = calcularGestiones([], AHORA, false);
        expect(g.serie).toHaveLength(14);
        expect(g.serie[0].dia).toBe('2026-10-03');
        expect(g.serie[13].dia).toBe('2026-10-16');
        const dias = g.serie.map((d) => d.dia);
        expect(new Set(dias).size).toBe(14);
    });

    it('"a esta hora": ayer con 5 antes de las 10:30 y 7 después → 5', () => {
        const antes = Array.from({ length: 5 }, (_, i) => fila('2026-10-15', `0${i + 5}:00`, i + 1));
        const despues = Array.from({ length: 7 }, (_, i) => fila('2026-10-15', `1${i + 1}:00`, i + 1));
        const g = calcularGestiones([...antes, ...despues], AHORA, false);
        expect(g.ayerALaMismaHora).toEqual({ gestiones: 5, casos: 5 });
    });

    it('el promedio ignora los días sin gestión (sábado y domingo) y toma como mucho 7 días', () => {
        const filas = [];
        // 13 días anteriores: 02..15/10. Sábado 03, domingo 04, sábado 10, domingo 11 sin nada.
        for (let d = 2; d <= 15; d++) {
            const dia = `2026-10-${String(d).padStart(2, '0')}`;
            if (['2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11'].includes(dia)) continue;
            filas.push(fila(dia, '09:00'), fila(dia, '09:30', 2));
        }
        const g = calcularGestiones(filas, AHORA, false);
        expect(g.diasBase).toBe(7);
        expect(g.promedioALaMismaHora).toBe(2);
    });

    it('con menos de 7 días con gestión usa los que hay', () => {
        const g = calcularGestiones([fila('2026-10-14', '09:00'), fila('2026-10-13', '09:00'), fila('2026-10-13', '09:10')], AHORA, false);
        expect(g.diasBase).toBe(2);
        expect(g.promedioALaMismaHora).toBe(1.5);
    });

    it('sin días anteriores → null y diasBase = 0', () => {
        const g = calcularGestiones([fila('2026-10-16', '09:00')], AHORA, false);
        expect(g.promedioALaMismaHora).toBeNull();
        expect(g.diasBase).toBe(0);
        expect(g.hoy).toBe(1);
    });

    it('un día anterior con gestiones solo después de esta hora entra en la base con 0', () => {
        const g = calcularGestiones([fila('2026-10-15', '18:00')], AHORA, false);
        expect(g.diasBase).toBe(1);
        expect(g.promedioALaMismaHora).toBe(0);
    });

    it('la semana arranca el lunes 12/10', () => {
        const g = calcularGestiones([fila('2026-10-11', '10:00'), fila('2026-10-12', '10:00'), fila('2026-10-14', '10:00', 2)], AHORA, false);
        expect(g.semana).toEqual({ desde: '2026-10-12', gestiones: 2, casos: 2, diasConGestion: 2 });
    });

    it('un domingo la semana arranca 6 días antes', () => {
        const domingo = new Date('2026-10-18T13:30:00.000Z');
        const g = calcularGestiones([], domingo, false);
        expect(g.semana.desde).toBe('2026-10-12');
    });

    it('"casos" cuenta deudores distintos', () => {
        const g = calcularGestiones([fila('2026-10-16', '08:00', 7), fila('2026-10-16', '08:10', 7), fila('2026-10-16', '08:20', 8)], AHORA, false);
        expect(g.hoy).toBe(3);
        expect(g.casosHoy).toBe(2);
    });

    it('propaga el aviso de truncado', () => {
        expect(calcularGestiones([], AHORA, true).truncado).toBe(true);
    });
});

describe('calcularAgenda', () => {
    const deudores = new Map<number, DeudorAgenda>([[1, { nombre: 'Ana Pérez', documento: '123', empresa: 'AYSA' }]]);
    const todo = { promesas: true, cuotas: true };
    const prom = (id: number, dia: string, estado: string, monto: number | null = 1000): PromesaFila => ({
        id, deudorId: 1, fechaPromesa: new Date(`${dia}T00:00:00.000Z`), monto, estado, cerradaEn: null, observacion: null,
    });
    const cuota = (id: number, dia: string, estado: string): CuotaFila => ({
        id, deudorId: 1, fechaVencimiento: new Date(`${dia}T00:00:00.000Z`), importe: 500, estado, fechaPago: null, nroCuota: 1, cantCuotas: 3,
    });

    it('una VIGENTE de ayer va a "sin cumplir" con su estado real', () => {
        const a = calcularAgenda([prom(1, '2026-10-15', 'VIGENTE')], [], deudores, AHORA, todo);
        expect(a.sinCumplir.map((i) => i.estado)).toEqual(['VIGENTE']);
        expect(a.hoy).toHaveLength(0);
    });

    it('una CUMPLIDA de hoy está en "hoy" con estado CUMPLIDA', () => {
        const a = calcularAgenda([prom(1, '2026-10-16', 'CUMPLIDA')], [], deudores, AHORA, todo);
        expect(a.hoy[0].estado).toBe('CUMPLIDA');
    });

    it('una CUMPLIDA de ayer no entra en ninguna lista, ni una cuota PAGADA', () => {
        const a = calcularAgenda([prom(1, '2026-10-15', 'CUMPLIDA')], [cuota(2, '2026-10-15', 'PAGADA')], deudores, AHORA, todo);
        expect(a.totales).toEqual({ hoy: 0, proximos: 0, sinCumplir: 0 });
    });

    it('el día de una promesa guardada a las 2026-10-16T00:00:00Z es 2026-10-16 (no el 15 en hora local)', () => {
        const a = calcularAgenda([prom(1, '2026-10-16', 'VIGENTE')], [], deudores, AHORA, todo);
        expect(a.hoy[0].dia).toBe('2026-10-16');
    });

    it('más de 50 ítems → 50 en la lista y totales con el real', () => {
        const muchas = Array.from({ length: 60 }, (_, i) => prom(i + 1, '2026-10-16', 'VIGENTE', i));
        const a = calcularAgenda(muchas, [], deudores, AHORA, todo);
        expect(a.hoy).toHaveLength(50);
        expect(a.totales.hoy).toBe(60);
        expect(a.limite).toBe(50);
    });

    it('próximos: dentro de 7 días, solo abiertos y por día ascendente', () => {
        const a = calcularAgenda(
            [prom(1, '2026-10-20', 'VIGENTE'), prom(2, '2026-10-17', 'VIGENTE'), prom(3, '2026-10-23', 'VIGENTE'), prom(4, '2026-10-24', 'VIGENTE')],
            [cuota(5, '2026-10-18', 'PENDIENTE')],
            deudores, AHORA, todo,
        );
        expect(a.proximos.map((i) => `${i.tipo}${i.id}`)).toEqual(['PROMESA2', 'CUOTA5', 'PROMESA1', 'PROMESA3']);
    });

    it('hoy: abiertas primero, y por monto descendente', () => {
        const a = calcularAgenda(
            [prom(1, '2026-10-16', 'CUMPLIDA', 9000), prom(2, '2026-10-16', 'VIGENTE', 100), prom(3, '2026-10-16', 'VIGENTE', 500)],
            [], deudores, AHORA, todo,
        );
        expect(a.hoy.map((i) => i.id)).toEqual([3, 2, 1]);
    });

    it('sin cumplir: INCUMPLIDA y VENCIDA, por día descendente, solo la última semana', () => {
        const a = calcularAgenda(
            [prom(1, '2026-10-12', 'INCUMPLIDA'), prom(2, '2026-10-09', 'INCUMPLIDA'), prom(3, '2026-10-01', 'INCUMPLIDA')],
            [cuota(4, '2026-10-14', 'VENCIDA')],
            deudores, AHORA, todo,
        );
        expect(a.sinCumplir.map((i) => i.id)).toEqual([4, 1, 2]);
    });

    it('arma los datos de la cuota y la observación recortada', () => {
        const p = { ...prom(1, '2026-10-16', 'VIGENTE'), observacion: 'x '.repeat(100) };
        const a = calcularAgenda([p], [cuota(2, '2026-10-16', 'PENDIENTE')], deudores, AHORA, todo);
        const c = a.hoy.find((i) => i.tipo === 'CUOTA')!;
        expect([c.nroCuota, c.cantCuotas, c.nombre, c.documento]).toEqual([1, 3, 'Ana Pérez', '123']);
        expect(a.hoy.find((i) => i.tipo === 'PROMESA')!.observacion!.length).toBeLessThanOrEqual(81);
    });
});

describe('recortarTexto', () => {
    it('120 caracteres + … y saltos de línea a espacio', () => {
        const largo = ('palabra\n' as string).repeat(40);
        const r = recortarTexto(largo, 120);
        expect(r.endsWith('…')).toBe(true);
        expect(r.length).toBeLessThanOrEqual(121);
        expect(r).not.toMatch(/\n/);
    });
    it('un texto corto queda igual', () => {
        expect(recortarTexto('hola\nmundo', 120)).toBe('hola mundo');
    });
    it('sin espacios corta en seco', () => {
        expect(recortarTexto('a'.repeat(200), 120)).toBe(`${'a'.repeat(120)}…`);
    });
});
