// Doble de `PrismaService` para los specs de LECTURAS del módulo de imports (historial, errores, confirmar pendientes).
// Filtra de verdad: honra `where` (igualdad, `in`, `not`, `gt`, `contains` y `startsWith` sin distinguir mayúsculas, como la
// collation de la base; `AND`, `OR`, `NOT`, la relación `progreso.is`), `orderBy`, `skip` y `take`. Un doble que devuelve una lista
// fija deja pasar un `where` mal escrito, que en un listado es mostrar de más o de menos en silencio.

type Fila = Record<string, any>;

function igual(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return a === b;
}

function cumpleCampo(valor: any, cond: any): boolean {
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return igual(valor ?? null, cond);
    return Object.entries(cond).every(([op, esperado]: [string, any]) => {
        switch (op) {
            case 'equals': return igual(valor ?? null, esperado);
            case 'in': return (esperado as unknown[]).some((e) => igual(valor, e));
            case 'not': return !cumpleCampo(valor, esperado);
            case 'gt': return valor != null && valor > esperado;
            case 'gte': return valor != null && valor >= esperado;
            case 'lt': return valor != null && valor < esperado;
            case 'contains': return typeof valor === 'string' && valor.toLowerCase().includes(String(esperado).toLowerCase());
            case 'startsWith': return typeof valor === 'string' && valor.toLowerCase().startsWith(String(esperado).toLowerCase());
            case 'is': return valor != null && cumple(valor, esperado);
            default: throw new Error(`El doble no soporta el operador ${op}`);
        }
    });
}

export function cumple(fila: Fila, where: Fila | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, cond]) => {
        if (k === 'AND') return (Array.isArray(cond) ? cond : [cond]).every((c: Fila) => cumple(fila, c));
        if (k === 'OR') return (cond as Fila[]).some((c) => cumple(fila, c));
        if (k === 'NOT') return !(Array.isArray(cond) ? cond : [cond]).some((c: Fila) => cumple(fila, c));
        return cumpleCampo(fila[k], cond);
    });
}

function ordenar(filas: Fila[], orderBy: any): Fila[] {
    const lista: Array<Record<string, 'asc' | 'desc'>> = !orderBy ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    if (lista.length === 0) return [...filas];
    return [...filas].sort((a, b) => {
        for (const o of lista) {
            const [campo, dir] = Object.entries(o)[0];
            const x = a[campo];
            const y = b[campo];
            if (x === y) continue;
            const cmp = x == null ? -1 : y == null ? 1 : x < y ? -1 : 1;
            return dir === 'desc' ? -cmp : cmp;
        }
        return 0;
    });
}

function paginar(filas: Fila[], args: Fila): Fila[] {
    const desde = args.skip ?? 0;
    return filas.slice(desde, args.take != null ? desde + args.take : undefined);
}

export interface DobleLecturas {
    prisma: any;
    /** Cada llamada a la base, en orden: `remesa.findMany`, `importerror.count`… */
    llamadas: string[];
    /** `where` de cada `importerror.findMany`, con su `skip` y `take`. */
    lecturasDeErrores: Array<{ where: Fila; skip?: number; take?: number }>;
    remesas: Fila[];
    errores: Fila[];
}

export function dobleLecturas(datos: { remesas?: Fila[]; errores?: Fila[]; nombresDeUsuario?: Record<number, string> } = {}): DobleLecturas {
    const remesas = datos.remesas ?? [];
    const errores = datos.errores ?? [];
    const llamadas: string[] = [];
    const lecturasDeErrores: DobleLecturas['lecturasDeErrores'] = [];

    const conInclude = (r: Fila, args: Fila): Fila => {
        const out: Fila = { ...r };
        if (args.include?.usuarioCreador || args.select?.usuarioCreador) {
            out.usuarioCreador = r.usuarioCreadorId != null ? { id: r.usuarioCreadorId, nombre: datos.nombresDeUsuario?.[r.usuarioCreadorId] ?? 'Maxi' } : null;
        }
        if (args.include?.plantilla || args.select?.plantilla) out.plantilla = r.plantilla ?? null;
        out.progreso = r.progreso ? { ...r.progreso, remesaId: r.id } : null;
        out._count = { deudor: r.casos ?? 0 };
        return out;
    };
    // `progreso` se filtra como relación: `{ progreso: { is: {...} } }` mira la fila de progreso de la remesa.
    const filtrar = (where: Fila | undefined) => remesas.filter((r) => cumple({ ...r, progreso: r.progreso }, where));

    const prisma = {
        remesa: {
            count: async (args: Fila = {}) => {
                llamadas.push('remesa.count');
                return filtrar(args.where).length;
            },
            findMany: async (args: Fila = {}) => {
                llamadas.push('remesa.findMany');
                return paginar(ordenar(filtrar(args.where), args.orderBy), args).map((r) => conInclude(r, args));
            },
            findUnique: async (args: Fila) => {
                llamadas.push('remesa.findUnique');
                const r = remesas.find((x) => x.id === args.where.id);
                return r ? conInclude(r, args) : null;
            },
        },
        import_progreso: {
            findMany: async (args: Fila = {}) => {
                llamadas.push('import_progreso.findMany');
                const filas = remesas.filter((r) => r.progreso).map((r) => ({ ...r.progreso, remesaId: r.id }));
                return ordenar(filas.filter((f) => cumple(f, args.where)), args.orderBy);
            },
        },
        importerror: {
            findMany: async (args: Fila = {}) => {
                llamadas.push('importerror.findMany');
                lecturasDeErrores.push({ where: args.where, skip: args.skip, take: args.take });
                return paginar(ordenar(errores.filter((e) => cumple(e, args.where)), args.orderBy), args);
            },
            count: async (args: Fila = {}) => {
                llamadas.push('importerror.count');
                return errores.filter((e) => cumple(e, args.where)).length;
            },
        },
    };
    return { prisma, llamadas, lecturasDeErrores, remesas, errores };
}
