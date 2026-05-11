export class ProgressEmitter {
    private ultimoEmitMs = 0;
    private ultimoProgreso = -1;

    constructor(
        private readonly emit: (progreso: number, okFilas: number, errFilas: number) => void,
        private readonly throttleMs = 2000,
        private readonly stepPct = 5,
    ) {}

    tick(progresoActual: number, okFilas: number, errFilas: number, forzar = false): void {
        const ahora = Date.now();
        const dt = ahora - this.ultimoEmitMs;
        const dp = Math.abs(progresoActual - this.ultimoProgreso);

        if (
            forzar ||
            this.ultimoProgreso === -1 ||
            dt >= this.throttleMs ||
            dp >= this.stepPct
        ) {
            this.emit(progresoActual, okFilas, errFilas);
            this.ultimoEmitMs = ahora;
            this.ultimoProgreso = progresoActual;
        }
    }
}
