/**
 * encrypt-sip-passwords.ts
 *
 * Script idempotente que migra credenciales en plain text de agente_telefonia
 * al formato AES-256-GCM usado por SipCryptoService.
 *
 * Detecta si un valor ya está cifrado (3 partes base64 separadas por ":")
 * antes de re-cifrar, por lo que es seguro correrlo múltiples veces.
 *
 * Prerrequisito: NEOTEL_SIP_ENCRYPTION_KEY en .env (64 hex chars ó 32 bytes base64)
 *
 * Ejecutar:
 *   npx ts-node --transpile-only prisma/scripts/encrypt-sip-passwords.ts
 *
 * Verificar resultado:
 *   npx ts-node --transpile-only prisma/scripts/encrypt-sip-passwords.ts --dry-run
 */

import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Cargar .env desde la raíz del backend
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma  = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Crypto inline (replica SipCryptoService para no depender de NestJS) ─────

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12;
const TAG_LENGTH = 16;

function deriveKey(raw: string): Buffer {
    const trimmed = raw.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
    try {
        const buf = Buffer.from(trimmed, 'base64');
        if (buf.length === 32) return buf;
    } catch { /* not base64 */ }
    throw new Error(
        'NEOTEL_SIP_ENCRYPTION_KEY debe ser 64 chars hex o base64 de 32 bytes.\n' +
        'Generar con: openssl rand -hex 32',
    );
}

function encrypt(plaintext: string, key: Buffer): string {
    const iv     = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function isAlreadyEncrypted(value: string): boolean {
    if (!value) return false;
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    try {
        const iv = Buffer.from(parts[0], 'base64');
        return iv.length === IV_LENGTH;
    } catch { return false; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const rawKey = process.env.NEOTEL_SIP_ENCRYPTION_KEY ?? '';
    if (!rawKey) {
        console.error('ERROR: NEOTEL_SIP_ENCRYPTION_KEY no está en .env');
        process.exit(1);
    }

    let key: Buffer;
    try {
        key = deriveKey(rawKey);
    } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
    }

    console.log(`Modo: ${DRY_RUN ? 'DRY RUN (sin cambios)' : 'PRODUCCIÓN (escribiendo a DB)'}`);
    console.log('Leyendo agentes...');

    const agentes = await prisma.agente_telefonia.findMany();
    console.log(`  Encontrados: ${agentes.length} agentes`);

    let migrados = 0;
    let yaCifrados = 0;
    let errores = 0;

    for (const agente of agentes) {
        const sipAlreadyEnc    = isAlreadyEncrypted(agente.sipPasswordEnc);
        const claveAlreadyEnc  = isAlreadyEncrypted(agente.claveNeotelEnc);

        const needsSip   = !sipAlreadyEnc;
        const needsClave = !claveAlreadyEnc;

        if (!needsSip && !needsClave) {
            console.log(`  ✓ Agente ${agente.id} (${agente.usuarioNeotel}): ya cifrado — skip`);
            yaCifrados++;
            continue;
        }

        console.log(`  → Agente ${agente.id} (${agente.usuarioNeotel}):`
            + (needsSip   ? ' cifrar sipPasswordEnc' : '')
            + (needsClave ? ' cifrar claveNeotelEnc' : ''));

        if (DRY_RUN) {
            migrados++;
            continue;
        }

        try {
            const updateData: Record<string, string> = {};
            if (needsSip)   updateData.sipPasswordEnc = encrypt(agente.sipPasswordEnc, key);
            if (needsClave) updateData.claveNeotelEnc = encrypt(agente.claveNeotelEnc, key);

            await prisma.agente_telefonia.update({
                where: { id: agente.id },
                data:  updateData,
            });
            migrados++;
            console.log(`    ✓ Agente ${agente.id}: cifrado OK`);
        } catch (err) {
            console.error(`    ✗ Agente ${agente.id}: ERROR — ${(err as Error).message}`);
            errores++;
        }
    }

    console.log('\n──────────────────────────────────────────────');
    console.log(`Resumen${DRY_RUN ? ' (DRY RUN)' : ''}:`);
    console.log(`  Migrados:   ${migrados}`);
    console.log(`  Ya cifrados: ${yaCifrados}`);
    console.log(`  Errores:    ${errores}`);
    if (DRY_RUN) {
        console.log('\nPara aplicar los cambios, correr sin --dry-run:');
        console.log('  npx ts-node --transpile-only prisma/scripts/encrypt-sip-passwords.ts');
    }
    console.log('──────────────────────────────────────────────\n');

    if (errores > 0) process.exit(1);
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
