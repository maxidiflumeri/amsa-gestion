/**
 * Tests unitarios de SipCryptoService.
 *
 * Ejecutar: npx jest sip-crypto.service.spec.ts --no-coverage
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { SipCryptoService } from './sip-crypto.service';

// Clave de 64 hex chars válida para tests
const VALID_KEY_HEX = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

function makeService(key: string): SipCryptoService {
    const config = {
        get: (k: string, def?: unknown) => {
            if (k === 'NEOTEL_SIP_ENCRYPTION_KEY') return key;
            return def;
        },
        getOrThrow: (k: string) => {
            if (k === 'NEOTEL_SIP_ENCRYPTION_KEY') return key;
            throw new Error(`Missing: ${k}`);
        },
    } as unknown as ConfigService;

    const svc = new SipCryptoService(config);
    svc.onModuleInit(); // dispara la carga de la key
    return svc;
}

describe('SipCryptoService', () => {
    describe('onModuleInit', () => {
        it('arranca correctamente con una key hex de 64 chars', () => {
            expect(() => makeService(VALID_KEY_HEX)).not.toThrow();
        });

        it('arranca correctamente con una key base64 de 32 bytes', () => {
            // openssl rand -base64 32 genera exactamente 44 chars sin padding
            const key32Bytes = Buffer.alloc(32, 0xab).toString('base64');
            expect(() => makeService(key32Bytes)).not.toThrow();
        });

        it('falla si la key está vacía', () => {
            expect(() => makeService('')).toThrow(InternalServerErrorException);
        });

        it('falla si la key es demasiado corta', () => {
            expect(() => makeService('tooshort')).toThrow(InternalServerErrorException);
        });

        it('falla si la key tiene 62 chars hex (< 64)', () => {
            expect(() => makeService(VALID_KEY_HEX.slice(0, 62))).toThrow(InternalServerErrorException);
        });
    });

    describe('encrypt / decrypt — round trip', () => {
        let svc: SipCryptoService;
        beforeAll(() => { svc = makeService(VALID_KEY_HEX); });

        it('cifra y descifra correctamente un string simple', () => {
            const plain = 'Externo6001';
            const cipher = svc.encrypt(plain);
            expect(cipher).not.toBe(plain);
            expect(svc.decrypt(cipher)).toBe(plain);
        });

        it('cifra y descifra correctamente la clave Neotel', () => {
            const plain = '10066001';
            expect(svc.decrypt(svc.encrypt(plain))).toBe(plain);
        });

        it('cifra y descifra un string con caracteres especiales', () => {
            const plain = 'P@ss#w0rd!$ñÑ€';
            expect(svc.decrypt(svc.encrypt(plain))).toBe(plain);
        });

        it('cifra y descifra string vacío sin error', () => {
            expect(svc.encrypt('')).toBe('');
            expect(svc.decrypt('')).toBe('');
        });

        it('cada cifrado produce un ciphertext distinto (IV aleatorio)', () => {
            const plain = 'Externo6001';
            const c1 = svc.encrypt(plain);
            const c2 = svc.encrypt(plain);
            expect(c1).not.toBe(c2); // IV diferente → ciphertext diferente
            // Ambos descifran al mismo valor
            expect(svc.decrypt(c1)).toBe(plain);
            expect(svc.decrypt(c2)).toBe(plain);
        });

        it('el formato tiene exactamente 3 partes separadas por ":"', () => {
            const cipher = svc.encrypt('test');
            expect(cipher.split(':').length).toBe(3);
        });
    });

    describe('isEncrypted', () => {
        let svc: SipCryptoService;
        beforeAll(() => { svc = makeService(VALID_KEY_HEX); });

        it('detecta un string cifrado como cifrado', () => {
            expect(svc.isEncrypted(svc.encrypt('Externo6001'))).toBe(true);
        });

        it('detecta "Externo6001" (plain) como no cifrado', () => {
            expect(svc.isEncrypted('Externo6001')).toBe(false);
        });

        it('detecta "10066001" (plain) como no cifrado', () => {
            expect(svc.isEncrypted('10066001')).toBe(false);
        });

        it('devuelve false para string vacío', () => {
            expect(svc.isEncrypted('')).toBe(false);
        });
    });

    describe('tampering detection', () => {
        let svc: SipCryptoService;
        beforeAll(() => { svc = makeService(VALID_KEY_HEX); });

        it('detecta authTag manipulado y lanza InternalServerErrorException', () => {
            const cipher = svc.encrypt('Externo6001');
            const parts  = cipher.split(':');
            // Mutar el primer byte del authTag
            const tagBuf = Buffer.from(parts[1], 'base64');
            tagBuf[0]    = tagBuf[0] ^ 0xff;
            parts[1]     = tagBuf.toString('base64');
            const tampered = parts.join(':');
            expect(() => svc.decrypt(tampered)).toThrow(InternalServerErrorException);
        });

        it('detecta ciphertext manipulado y lanza InternalServerErrorException', () => {
            const cipher = svc.encrypt('Externo6001');
            const parts  = cipher.split(':');
            const ctBuf  = Buffer.from(parts[2], 'base64');
            ctBuf[0]     = ctBuf[0] ^ 0xff;
            parts[2]     = ctBuf.toString('base64');
            expect(() => svc.decrypt(parts.join(':'))).toThrow(InternalServerErrorException);
        });

        it('lanza en formato incorrecto (solo 2 partes)', () => {
            expect(() => svc.decrypt('aGVsbG8:d29ybGQ')).toThrow(InternalServerErrorException);
        });

        it('lanza con key distinta (simula key rotada o incorrecta)', () => {
            const otherKey = '0000000000000000000000000000000000000000000000000000000000000000';
            const svc2 = makeService(otherKey);
            const cipher = svc.encrypt('Externo6001');
            expect(() => svc2.decrypt(cipher)).toThrow(InternalServerErrorException);
        });
    });
});
