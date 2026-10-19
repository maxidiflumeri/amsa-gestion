import { SemaforoReportes } from './semaforo';

describe('SemaforoReportes', () => {
    afterEach(() => jest.useRealTimers());

    it('deja pasar a 2 a la vez; el 3.º espera y entra cuando se libera uno', async () => {
        const s = new SemaforoReportes(2);
        const a = await s.adquirir(1000);
        const b = await s.adquirir(1000);
        expect(a && b).toBeTruthy();
        let entro = false;
        const c = s.adquirir(1000).then((x) => {
            entro = true;
            return x;
        });
        await Promise.resolve();
        expect(entro).toBe(false);
        a!();
        const liberar = await c;
        expect(liberar).toBeTruthy();
    });

    it('el 3.º se rinde a los 30 s si nadie libera', async () => {
        jest.useFakeTimers();
        const s = new SemaforoReportes(2);
        await s.adquirir(30_000);
        await s.adquirir(30_000);
        const c = s.adquirir(30_000);
        jest.advanceTimersByTime(30_001);
        await expect(c).resolves.toBeNull();
    });

    it('liberar dos veces no suma lugares', async () => {
        const s = new SemaforoReportes(1);
        const a = await s.adquirir(10);
        a!();
        a!();
        const b = await s.adquirir(10);
        expect(b).toBeTruthy();
        await expect(s.adquirir(10)).resolves.toBeNull();
    });
});
