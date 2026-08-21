/**
 * Guardas de la wiki de ayuda. Se corre a mano o en CI:
 *
 *   node frontend/scripts/verificar-ayuda.mjs
 *
 * Existe porque la documentación se pudre en silencio: nadie se entera de que un enlace dejó de
 * resolver o de que una pantalla nueva quedó sin ayuda hasta que un usuario se choca con eso.
 * Todo lo que se puede verificar sin leer el texto, se verifica acá.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOCS = join(RAIZ, 'docs', 'ayuda')
const NAV = join(RAIZ, 'frontend', 'src', 'components', 'layout', 'AppShell', 'navConfig.ts')

/** Pantallas que todavía no tienen página, a propósito. Sacar de acá al escribirlas. */
const SIN_AYUDA_TODAVIA = new Set(['/dashboards', '/admin/neotel-test', '/ayuda'])

const errores = []
const avisos = []

// ── Cargar las páginas ────────────────────────────────────────────────────────
const paginas = []
for (const carpeta of readdirSync(DOCS)) {
    const dir = join(DOCS, carpeta)
    if (!statSync(dir).isDirectory()) continue
    for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
        const crudo = readFileSync(join(dir, archivo), 'utf8')
        const m = /^\s*<!--([\s\S]*?)-->/.exec(crudo)
        const meta = {}
        if (m) {
            for (const linea of m[1].split('\n')) {
                const i = linea.indexOf(':')
                if (i < 0) continue
                meta[linea.slice(0, i).trim()] = linea.slice(i + 1).trim()
            }
        }
        const cuerpo = m ? crudo.slice(m[0].length) : crudo
        const sinPrefijo = (s) => s.replace(/^\d+-/, '')
        const lista = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean)
        paginas.push({
            ruta: `docs/ayuda/${carpeta}/${archivo}`,
            slug: `${sinPrefijo(carpeta)}/${sinPrefijo(archivo.replace(/\.md$/, ''))}`,
            meta,
            cuerpo,
            rutas: lista(meta.rutas),
            principales: lista(meta.rutaPrincipal),
        })
    }
}
const slugs = new Set(paginas.map((p) => p.slug))

// ── 1. Metadatos obligatorios ─────────────────────────────────────────────────
for (const p of paginas) {
    for (const campo of ['seccion', 'resumen', 'revisado']) {
        if (!p.meta[campo]) errores.push(`${p.ruta}: le falta "${campo}" en los metadatos`)
    }
    if (!/^#\s+.+/m.test(p.cuerpo)) errores.push(`${p.ruta}: no tiene título "# ..."`)
}

// ── 2. Los enlaces internos tienen que resolver ───────────────────────────────
for (const p of paginas) {
    for (const [, href] of p.cuerpo.matchAll(/\]\((\/ayuda\/[^)\s]+)\)/g)) {
        const destino = href.slice('/ayuda/'.length)
        if (!slugs.has(destino)) errores.push(`${p.ruta}: enlace roto a /ayuda/${destino}`)
    }
}

// ── 3. Exactamente una principal por ruta declarada ───────────────────────────
const porRuta = new Map()
for (const p of paginas) for (const r of p.rutas) (porRuta.get(r) ?? porRuta.set(r, []).get(r)).push(p)

for (const [ruta, lista] of porRuta) {
    const principales = lista.filter((p) => p.principales.includes(ruta))
    if (principales.length === 0) {
        errores.push(
            `La pantalla ${ruta} la declaran ${lista.length} página(s) y ninguna es la principal. ` +
            `Agregá "rutaPrincipal: ${ruta}" a la que tenga que abrir el botón "?".`,
        )
    } else if (principales.length > 1) {
        errores.push(
            `La pantalla ${ruta} tiene ${principales.length} páginas marcadas como principales: ` +
            principales.map((p) => p.ruta).join(', '),
        )
    }
}

// ── 4. Una rutaPrincipal sin la ruta declarada no la encuentra nadie ──────────
for (const p of paginas) {
    for (const r of p.principales) {
        if (!p.rutas.includes(r)) {
            errores.push(`${p.ruta}: es principal de ${r} pero no lo declara en "rutas"`)
        }
    }
}

// ── 5. Cada pantalla del menú tiene que tener ayuda ───────────────────────────
const nav = readFileSync(NAV, 'utf8')
const rutasMenu = [...nav.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
for (const ruta of new Set(rutasMenu)) {
    if (SIN_AYUDA_TODAVIA.has(ruta)) {
        avisos.push(`La pantalla ${ruta} sigue sin página de ayuda (está en la lista de pendientes)`)
        continue
    }
    const cubierta = [...porRuta.keys()].some((r) => ruta === r || ruta.startsWith(`${r}/`))
    if (!cubierta) errores.push(`La pantalla ${ruta} está en el menú y no la documenta ninguna página`)
}

// ── 6. Qué abre el "?" en cada pantalla ───────────────────────────────────────
// Misma regla que `paginasParaRuta` en contenido.ts: gana el prefijo más largo.
function resolver(ruta) {
    let mejor = ''
    for (const r of porRuta.keys()) {
        const aplica = r === '/' ? ruta === '/' : ruta === r || ruta.startsWith(`${r}/`)
        if (aplica && r.length > mejor.length) mejor = r
    }
    if (!mejor) return null
    const lista = porRuta.get(mejor)
    const principal = lista.find((p) => p.principales.includes(mejor))
    return { ruta: mejor, principal, hermanas: lista.length - 1 }
}

const resoluciones = []
for (const ruta of [...new Set(rutasMenu)].sort()) {
    if (SIN_AYUDA_TODAVIA.has(ruta)) continue
    const r = resolver(ruta)
    if (!r) continue
    resoluciones.push(
        `  ${ruta.padEnd(26)} → ${r.principal.slug}` + (r.hermanas ? ` (+${r.hermanas} hermana(s))` : ''),
    )
}

// Una ruta con parámetros tiene que caer en la ayuda de su pantalla, no quedarse sin nada.
if (porRuta.has('/gestion') && !resolver('/gestion/12345')) {
    errores.push('Una ruta con parámetros como /gestion/12345 se queda sin ayuda: revisá el match por prefijo')
}

// ── Resultado ─────────────────────────────────────────────────────────────────
console.log(`${paginas.length} páginas · ${porRuta.size} pantallas documentadas\n`)
console.log('Lo que abre el botón "?":')
for (const r of resoluciones) console.log(r)
console.log('')
for (const a of avisos) console.log(`  aviso  ${a}`)
for (const e of errores) console.log(`  ERROR  ${e}`)
console.log(`\n${errores.length === 0 ? 'OK' : `${errores.length} error(es)`}`)
process.exit(errores.length === 0 ? 0 : 1)
