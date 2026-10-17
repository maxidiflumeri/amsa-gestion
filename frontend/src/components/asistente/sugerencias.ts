// Las preguntas que el panel ofrece según la pantalla (docs/asistente-spec.md §12.2). Se elige por prefijo más largo,
// igual que la ayuda contextual, y se filtran por los permisos de la persona: no se sugiere algo que no puede hacer.

interface Sugerencia {
    texto: string;
    /** Permiso que hace falta para que la sugerencia tenga sentido. Sin permiso, se muestra siempre. */
    permiso?: string;
}

const POR_RUTA: Record<string, Sugerencia[]> = {
    '/': [
        { texto: 'Es mi primer día, ¿por dónde empiezo?' },
        { texto: '¿Qué muestra Inicio?' },
    ],
    '/gestion': [
        { texto: '¿Cómo cargo una promesa de pago?', permiso: 'promesas.crear' },
        { texto: '¿Cómo genero un cupón?', permiso: 'convenios.generar_cupon' },
        { texto: '¿Qué diferencia hay entre situación y gestión?' },
    ],
    '/carga': [
        { texto: '¿Qué miro en la vista previa antes de confirmar?' },
        { texto: '¿Qué categoría uso?' },
    ],
    '/historial-importaciones': [
        { texto: '¿Cómo veo los errores de una carga?' },
    ],
    '/plantillas': [
        { texto: '¿Cómo creo una plantilla de importación?' },
    ],
    '/reportes': [
        { texto: '¿Cómo armo un reporte?' },
        { texto: '¿De dónde bajo el archivo?' },
    ],
};

const GENERICA: Sugerencia[] = [{ texto: '¿Qué puedo hacer en esta pantalla?' }];

/** Hasta 3 sugerencias para la pantalla `pathname`, ya filtradas por permiso. Siempre devuelve al menos una. */
export function sugerenciasPara(pathname: string, tienePermiso: (key: string) => boolean): string[] {
    let mejor = '';
    for (const r of Object.keys(POR_RUTA)) {
        const coincide = r === '/' ? pathname === '/' : pathname === r || pathname.startsWith(`${r}/`);
        if (coincide && r.length > mejor.length) mejor = r;
    }
    const lista = (mejor ? POR_RUTA[mejor] : GENERICA).filter((s) => !s.permiso || tienePermiso(s.permiso));
    const textos = lista.map((s) => s.texto);
    return (textos.length > 0 ? textos : GENERICA.map((s) => s.texto)).slice(0, 3);
}
