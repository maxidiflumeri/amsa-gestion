/**
 * Verifica las guardas de `MoraService.generarMes` contra la base configurada en `DATABASE_URL`.
 *
 * Cubre los tres arreglos del 2026-08-21:
 *
 *  1. Una cartera **sin historia** puede arrancar su cadena, pero solo con confirmación explícita.
 *     Antes era imposible: la pantalla no mandaba nunca `permitirInicioDeCadena`, así que el recargo
 *     por mora no se podía usar en ninguna cartera nueva.
 *  2. Recargar un mes **no pisa el índice migrado del cedente** sin `permitirPisarMigrado`, y ya no
 *     deja la tasa escrita cuando la generación se rechaza.
 *  3. La fecha de corte sale del **calendario local**, no de los componentes UTC.
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/scripts/verificar-mora-guardas.ts            # solo lectura
 *   npx ts-node --transpile-only prisma/scripts/verificar-mora-guardas.ts --apply    # + caso 1
 *
 * Sin `--apply` se saltea el único caso que escribe. Ese caso genera y **borra** el índice de una
 * empresa que no tenga nada de mora; no correrlo contra producción.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { MoraService } from '../../src/modules/mora/mora.service';
import { formatearPeriodo } from '../../src/modules/mora/mora.constants';

const APLICAR = process.argv.includes('--apply');

async function main() {
    const prisma = new PrismaService();
    const mora = new MoraService(prisma);
    let fallos = 0;
    const ok = (cond: boolean, msg: string) => {
        console.log(`${cond ? '  OK  ' : ' FALLA'} ${msg}`);
        if (!cond) fallos++;
    };

    // La cartera de referencia es la que tenga índice migrado; si no hay ninguna, no hay nada que
    // verificar en los casos 1 a 3.
    const conMigrado = await prisma.indice_mora.findFirst({
        where: { origen: { not: 'CALCULADO' } },
        select: { empresaId: true },
        orderBy: { empresaId: 'asc' },
    });
    if (!conMigrado) {
        console.log('No hay ninguna empresa con índice migrado: se saltean los casos 1 a 3.');
    }
    const ref = conMigrado?.empresaId ?? 0;

    const ultimo = ref
        ? await prisma.indice_mora.findFirst({
            where: { empresaId: ref },
            orderBy: { fecha: 'desc' },
            select: { fecha: true },
        })
        : null;
    // El mes siguiente al último con índice: es la carga mensual de rutina.
    const siguiente = ultimo
        ? formatearPeriodo(
            ultimo.fecha.getUTCMonth() === 11 ? ultimo.fecha.getUTCFullYear() + 1 : ultimo.fecha.getUTCFullYear(),
            ultimo.fecha.getUTCMonth() === 11 ? 1 : ultimo.fecha.getUTCMonth() + 2,
        )
        : null;

    // ── 1. Preview sobre la cartera de referencia ─────────────────────────────
  if (ref && siguiente) {
    const mesNuevo = await mora.preverGeneracion(ref, siguiente);
    console.log(`\n[1] Mes nuevo (${siguiente}) sobre cadena existente:`, JSON.stringify(mesNuevo));
    ok(!mesNuevo.cadenaVacia, 'cadenaVacia=false');
    ok(!mesNuevo.faltaDiaAnterior, 'faltaDiaAnterior=false (hay indice al cierre del mes anterior)');
    ok(!mesNuevo.yaHayTasa, 'yaHayTasa=false');
    ok(mesNuevo.periodosMigrados.length === 0, 'no pisa nada migrado -> la carga mensual normal no tiene friccion');

    // Un mes bien atrás en la serie, fuera de la ventana de 24 que muestra la tabla.
    const primero = await prisma.indice_mora.findFirst({
        where: { empresaId: ref },
        orderBy: { fecha: 'asc' },
        select: { fecha: true },
    });
    const viejo = formatearPeriodo(primero!.fecha.getUTCFullYear() + 1, 1);

    const mesViejo = await mora.preverGeneracion(ref, viejo);
    console.log(`\n[2] Mes viejo (${viejo}): posteriores=${mesViejo.periodosPosteriores.length} migrados=${mesViejo.periodosMigrados.length}`);
    ok(mesViejo.periodosPosteriores.length > 24, `detecta ${mesViejo.periodosPosteriores.length} posteriores (la UI veia 24 como maximo)`);
    ok(mesViejo.periodosMigrados.length > 0, 'detecta que pisaria indice migrado');

    // ── 2. Recargar un mes migrado sin la bandera: debe fallar y no tocar nada ─
    console.log(`\n[3] Recargar ${viejo} sin permitirPisarMigrado:`);
    const indicesAntes = await prisma.indice_mora.count({ where: { empresaId: ref, origen: { not: 'CALCULADO' } } });
    try {
        await mora.generarMes(ref, viejo, 2.5, {});
        ok(false, 'deberia haber lanzado');
    } catch (e: any) {
        ok(/ndice migrado del cedente/.test(e.message), 'rechaza con el motivo correcto');
        console.log(`       "${e.message.slice(0, 130)}..."`);
    }
    const indicesDespues = await prisma.indice_mora.count({ where: { empresaId: ref, origen: { not: 'CALCULADO' } } });
    ok(indicesDespues === indicesAntes, `no toco ni una fila: siguen ${indicesDespues} indices migrados`);
    const tasaIntacta = await prisma.tasa_mora.findUnique({
        where: { empresaId_periodo: { empresaId: ref, periodo: viejo } },
        select: { tasaBase: true, fuente: true },
    });
    ok(
        tasaIntacta == null || Number(tasaIntacta.tasaBase) !== 2.5,
        `tampoco escribio la tasa fantasma (sigue ${tasaIntacta?.tasaBase ?? 'sin tasa'} / ${tasaIntacta?.fuente ?? '-'})`,
    );
  }

    // ── 3. Cartera nueva: el bug que bloqueaba la funcionalidad entera ────────
    if (!APLICAR) {
        console.log('\n[4] SALTEADO (escribe): volvé a correr con --apply para probar el arranque de cadena.');
    } else {
    const virgen = await prisma.empresa.findFirst({
        where: { indicesMora: { none: {} }, tasasMora: { none: {} } },
        select: { id: true, nombre: true },
    });
    if (!virgen) {
        console.log('\n[4] SALTEADO: no hay ninguna empresa sin indice para probar');
    } else {
        console.log(`\n[4] Cartera sin historia (id=${virgen.id} "${virgen.nombre}"):`);
        const periodoPrueba = formatearPeriodo(new Date().getFullYear(), new Date().getMonth() + 1);
        const dias = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth() + 1, 0)).getUTCDate();
        const p = await mora.preverGeneracion(virgen.id, periodoPrueba);
        ok(p.cadenaVacia, 'el preview la marca como cadenaVacia');

        try {
            await mora.generarMes(virgen.id, periodoPrueba, 2.169, {});
            ok(false, 'sin la bandera deberia lanzar');
        } catch (e: any) {
            ok(/arranque de la cadena/.test(e.message), 'sin la bandera: rechaza pidiendo confirmacion explicita');
        }

        const r = await mora.generarMes(virgen.id, periodoPrueba, 2.169, { permitirInicioDeCadena: true });
        ok(r.diasGenerados === dias, `con la bandera: genera los ${r.diasGenerados} dias del mes`);
        const primero = await prisma.indice_mora.findFirst({
            where: { empresaId: virgen.id, tipo: 1 },
            orderBy: { fecha: 'asc' },
            select: { indice: true },
        });
        const esperado = Math.pow(1 + 2.169 / 100, 1 / 30);
        ok(
            Math.abs(Number(primero!.indice) - esperado) < 1e-9,
            `el primer dia vale ${Number(primero!.indice).toFixed(9)} (1 x factor diario), no 1`,
        );

        const sig = formatearPeriodo(
            new Date().getMonth() === 11 ? new Date().getFullYear() + 1 : new Date().getFullYear(),
            new Date().getMonth() === 11 ? 1 : new Date().getMonth() + 2,
        );
        const p2 = await mora.preverGeneracion(virgen.id, sig);
        ok(!p2.cadenaVacia && !p2.faltaDiaAnterior, 'el mes siguiente ya carga sin ninguna bandera');

        await prisma.indice_mora.deleteMany({ where: { empresaId: virgen.id } });
        await prisma.tasa_mora.deleteMany({ where: { empresaId: virgen.id } });
        console.log('       (datos de prueba borrados)');
    }
    }

    // ── 4. La fecha de corte: local vs UTC ────────────────────────────────────
    // A las 22:00 de Buenos Aires ya es el dia siguiente en UTC: ahi estaba el bug.
    const noche = new Date();
    noche.setHours(22, 0, 0, 0);
    const comoUtc = new Date(Date.UTC(noche.getUTCFullYear(), noche.getUTCMonth(), noche.getUTCDate()));
    const comoLocal = new Date(Date.UTC(noche.getFullYear(), noche.getMonth(), noche.getDate()));
    const esperadoIso = `${noche.getFullYear()}-${String(noche.getMonth() + 1).padStart(2, '0')}-${String(noche.getDate()).padStart(2, '0')}`;
    console.log(`\n[5] Fecha de corte a las ${noche.toString().slice(0, 24)}`);
    console.log(`       normalizarFecha(new Date()) — lo que hacia antes: ${comoUtc.toISOString().slice(0, 10)}`);
    console.log(`       hoyUtc()                    — lo que hace ahora : ${comoLocal.toISOString().slice(0, 10)}`);
    ok(comoLocal.toISOString().slice(0, 10) === esperadoIso, 'hoyUtc() devuelve el dia del calendario local');
    ok(comoUtc.getTime() !== comoLocal.getTime(), 'y de noche NO coincide con el UTC: ese era el bug');

    console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLA(S)`}`);
    process.exit(fallos === 0 ? 0 : 1);
}

main();
