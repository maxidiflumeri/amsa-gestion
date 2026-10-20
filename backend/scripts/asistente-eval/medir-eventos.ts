/**
 * Medición M-1 del detalle de la respuesta (docs/asistente-detalle-spec.md §15): cuándo manda Bedrock cada evento del stream.
 *
 * Decide el texto de la wiki, no el código: ¿el bloque `thinking` llega con el `content_block_start` al EMPEZAR a razonar, o
 * junto con el `stop` al terminar? Si dura más de 100 ms cuando tiene más de 100 tokens, el razonamiento se mide aparte; si
 * no, la wiki explica «incluye el razonamiento» (la regla de fusión, §7.3.5, cubre los dos casos sin cambiar código).
 *
 * Arma el MISMO cliente que el asistente (`AnthropicBedrock`, `maxRetries: 2`) y hace, por modelo y repetición, un
 * `messages.stream` con la forma real: `effort: 'low'`, sin `thinking`, una herramienta `anotar`. No escribe en la base.
 *
 *   cd backend
 *   AWS_PROFILE=amsa-gestion npx ts-node --transpile-only scripts/asistente-eval/medir-eventos.ts [--repeticiones=3]
 *
 * Costo estimado: menos de USD 0,05 (3 llamadas de Haiku 5.5 y 3 de Sonnet 5.5). Corta solo al llegar a USD 0,10.
 * Lo corre el usuario (gasta contra Bedrock): este archivo no se ejecutó al escribirlo.
 */
import { Logger } from '@nestjs/common';
import { AnthropicBedrock, AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type { MessageCreateParamsNonStreaming, MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { AsistenteModeloService } from '../../src/modules/asistente/modelo/asistente-modelo.service';
import { calcularCosto, resolverPrecio, usoDeUsage } from '../../src/modules/asistente/modelo/precios';

const TOPE_USD = 0.1;
const MENSAJE =
    'Calculá cuántos días hay entre el 3 de marzo y el 19 de octubre de 2026, contando los dos días, y anotá el resultado con la herramienta anotar.';

function argumento(nombre: string): string | undefined {
    const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
    return a ? a.slice(nombre.length + 3) : undefined;
}

interface BloqueMedido {
    indice: number;
    tipo: string;
    inicio: number;
    primerDelta: number | null;
    fin: number | null;
    deltas: number;
    tiposDelta: Set<string>;
}

interface Medicion {
    modelo: string;
    connectMs: number | null;
    messageStartMs: number | null;
    bloques: BloqueMedido[];
    totalMs: number;
    salida: number;
    pensamiento: number | null;
    detallesDelUsage: unknown;
    costoUsd: number;
}

const ms = (t0: number): number => Math.round((performance.now() - t0) * 10) / 10;

async function medir(sdk: AnthropicBedrock | AnthropicBedrockMantle, modelo: string, maxTokens: number, strict: boolean): Promise<Medicion> {
    const params = {
        model: modelo,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        system: 'Sos un asistente de pruebas. Respondé en español rioplatense.',
        tools: [
            {
                name: 'anotar',
                description: 'Anota el resultado de un cálculo.',
                input_schema: { type: 'object', properties: { resultado: { type: 'string' } }, required: ['resultado'], additionalProperties: false },
                ...(strict ? { strict: true } : {}),
            },
        ],
        messages: [{ role: 'user', content: MENSAJE }],
    } as unknown as MessageCreateParamsNonStreaming;

    const t0 = performance.now();
    const m: Medicion = { modelo, connectMs: null, messageStartMs: null, bloques: [], totalMs: 0, salida: 0, pensamiento: null, detallesDelUsage: null, costoUsd: 0 };
    const stream = sdk.messages.stream(params);
    stream.on('connect', () => {
        m.connectMs = ms(t0);
    });
    stream.on('streamEvent', (ev: MessageStreamEvent) => {
        const t = ms(t0);
        if (ev.type === 'message_start') m.messageStartMs = t;
        else if (ev.type === 'content_block_start') {
            m.bloques.push({ indice: ev.index, tipo: ev.content_block.type, inicio: t, primerDelta: null, fin: null, deltas: 0, tiposDelta: new Set() });
        } else if (ev.type === 'content_block_delta') {
            const b = m.bloques.find((x) => x.indice === ev.index);
            if (b) {
                b.deltas++;
                b.tiposDelta.add(ev.delta.type);
                if (b.primerDelta === null) b.primerDelta = t;
            }
        } else if (ev.type === 'content_block_stop') {
            const b = m.bloques.find((x) => x.indice === ev.index);
            if (b) b.fin = t;
        }
    });
    const msg = await stream.finalMessage();
    m.totalMs = ms(t0);
    const usage = msg.usage as unknown as { output_tokens: number; output_tokens_details?: { thinking_tokens?: number } };
    m.salida = usage.output_tokens;
    m.pensamiento = usage.output_tokens_details?.thinking_tokens ?? null;
    m.detallesDelUsage = usage.output_tokens_details ?? null;
    const precio = resolverPrecio(modelo, null);
    m.costoUsd = precio ? calcularCosto(usoDeUsage(msg.usage as never), precio) : 0;
    return m;
}

async function main(): Promise<void> {
    Logger.overrideLogger(['error']);
    const modelo = new AsistenteModeloService();
    const repeticiones = Math.max(1, Number(argumento('repeticiones') ?? 3));
    const opciones = { awsRegion: modelo.region, maxRetries: 2, timeout: 60_000 };
    const sdk =
        modelo.endpoint === 'mantle'
            ? new AnthropicBedrockMantle({ ...opciones, awsProfile: process.env.AWS_PROFILE || undefined })
            : new AnthropicBedrock(opciones);

    const modelos = [...new Set([modelo.modelo, modelo.modeloReportes])];
    console.log(`Endpoint ${modelo.endpoint}, región ${modelo.region}; modelos ${modelos.join(', ')}; ${repeticiones} repetición(es)\n`);

    const todas: Medicion[] = [];
    let acumulado = 0;
    for (const nombre of modelos) {
        const esReportes = nombre === modelo.modeloReportes && nombre !== modelo.modelo;
        for (let i = 0; i < repeticiones; i++) {
            if (acumulado >= TOPE_USD) {
                console.log(`Cortado: el costo acumulado (USD ${acumulado.toFixed(4)}) llegó al tope de USD ${TOPE_USD}`);
                break;
            }
            const m = await medir(sdk, nombre, esReportes ? 16_000 : 2048, modelo.soportaStrict);
            acumulado += m.costoUsd;
            todas.push(m);
            console.log(`${nombre}  #${i + 1}  total ${m.totalMs} ms  connect ${m.connectMs} ms  message_start ${m.messageStartMs} ms  salida ${m.salida} tokens  USD ${m.costoUsd.toFixed(5)}`);
            for (const b of m.bloques) {
                console.log(
                    `   bloque ${b.indice} ${b.tipo.padEnd(18)} inicio ${b.inicio} ms  primer delta ${b.primerDelta ?? '—'} ms  fin ${b.fin ?? '—'} ms` +
                        `  (${b.fin !== null ? Math.round((b.fin - b.inicio) * 10) / 10 : '—'} ms, ${b.deltas} deltas: ${[...b.tiposDelta].join(', ') || 'ninguno'})`,
                );
            }
            console.log(`   usage.output_tokens_details = ${JSON.stringify(m.detallesDelUsage)}`);
        }
    }

    console.log('\n--- Resumen ---');
    for (const nombre of modelos) {
        const delModelo = todas.filter((m) => m.modelo === nombre);
        const razonamientos = delModelo.flatMap((m) => m.bloques.filter((b) => b.tipo === 'thinking' && b.fin !== null).map((b) => ({ dur: b.fin! - b.inicio, tokens: m.pensamiento ?? 0 })));
        if (razonamientos.length === 0) {
            console.log(`  ${nombre}: sin bloque de razonamiento en ${delModelo.length} llamada(s)${delModelo.some((m) => (m.pensamiento ?? 0) > 0) ? ' (pero con thinking_tokens > 0)' : ''}`);
            continue;
        }
        const durMedia = razonamientos.reduce((a, r) => a + r.dur, 0) / razonamientos.length;
        const tokMedia = razonamientos.reduce((a, r) => a + r.tokens, 0) / razonamientos.length;
        const conTiempoPropio = tokMedia > 100 ? durMedia > 100 : null;
        console.log(
            `  ${nombre}: razonamiento con tiempo propio: ${conTiempoPropio === null ? 'sin datos (menos de 100 tokens)' : conTiempoPropio ? 'sí' : 'no'} ` +
                `(duración media del bloque thinking ${Math.round(durMedia)} ms con ${Math.round(tokMedia)} tokens)`,
        );
    }
    console.log(`  Costo acumulado: USD ${acumulado.toFixed(4)}`);
    console.log('  Lectura: si el bloque thinking dura más de 100 ms con más de 100 tokens, la wiki dice que el razonamiento se mide aparte; si no, «incluye el razonamiento».');
}

main().catch((e) => {
    console.error(`La medición falló: ${e?.message}`, e?.stack);
    process.exit(1);
});
