import {
    Injectable,
    InternalServerErrorException,
    Logger,
    OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * SipCryptoService — cifrado AES-256-GCM para credenciales SIP/Neotel.
 *
 * Formato de salida: `<iv_base64>:<authTag_base64>:<ciphertext_base64>`
 *
 * Key: 32 bytes derivada de env NEOTEL_SIP_ENCRYPTION_KEY.
 *   - Acepta 64 caracteres hex (ej. openssl rand -hex 32)
 *   - O 44 caracteres base64 que resultan en 32 bytes (ej. openssl rand -base64 32 | tr -d '\n')
 *
 * El servicio valida la key al arrancar y falla rápido si no está configurada.
 */
@Injectable()
export class SipCryptoService implements OnModuleInit {
    private readonly logger = new Logger(SipCryptoService.name);
    private key!: Buffer;

    /** Prefijo inyectado en el IV para detectar strings ya cifrados */
    private static readonly ALGORITHM = 'aes-256-gcm';
    private static readonly IV_LENGTH = 12;      // 96 bits — recomendado para GCM
    private static readonly TAG_LENGTH = 16;     // 128 bits — default

    constructor(private readonly config: ConfigService) {}

    onModuleInit() {
        const raw = this.config.get<string>('NEOTEL_SIP_ENCRYPTION_KEY', '');

        if (!raw) {
            const msg = 'NEOTEL_SIP_ENCRYPTION_KEY no está configurada. Las credenciales SIP no se pueden cifrar/descifrar.';
            this.logger.error(msg);
            throw new InternalServerErrorException(msg);
        }

        this.key = this.deriveKey(raw);
        this.logger.log('SipCryptoService inicializado — clave AES-256-GCM cargada');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // API pública
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Cifra un texto plano.
     * @returns string con formato `<iv_base64>:<authTag_base64>:<ciphertext_base64>`
     */
    encrypt(plaintext: string): string {
        if (!plaintext) return '';

        const iv     = crypto.randomBytes(SipCryptoService.IV_LENGTH);
        const cipher = crypto.createCipheriv(SipCryptoService.ALGORITHM, this.key, iv, {
            authTagLength: SipCryptoService.TAG_LENGTH,
        });

        const ciphertext = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        return [
            iv.toString('base64'),
            authTag.toString('base64'),
            ciphertext.toString('base64'),
        ].join(':');
    }

    /**
     * Descifra un string en formato `<iv_base64>:<authTag_base64>:<ciphertext_base64>`.
     * @throws InternalServerErrorException si el formato es inválido o el authTag falla.
     */
    decrypt(cipherString: string): string {
        if (!cipherString) return '';

        const parts = cipherString.split(':');
        if (parts.length !== 3) {
            throw new InternalServerErrorException(
                'Formato de credencial cifrada inválido (se esperan 3 partes separadas por ":")',
            );
        }

        const [ivB64, tagB64, cipherB64] = parts;

        let iv: Buffer, authTag: Buffer, ciphertext: Buffer;
        try {
            iv         = Buffer.from(ivB64,   'base64');
            authTag    = Buffer.from(tagB64,   'base64');
            ciphertext = Buffer.from(cipherB64, 'base64');
        } catch {
            throw new InternalServerErrorException('Credencial cifrada con base64 inválido');
        }

        if (iv.length !== SipCryptoService.IV_LENGTH) {
            throw new InternalServerErrorException(
                `IV inválido: se esperan ${SipCryptoService.IV_LENGTH} bytes, llegaron ${iv.length}`,
            );
        }

        try {
            const decipher = crypto.createDecipheriv(SipCryptoService.ALGORITHM, this.key, iv, {
                authTagLength: SipCryptoService.TAG_LENGTH,
            });
            decipher.setAuthTag(authTag);
            return Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]).toString('utf8');
        } catch (err) {
            // Error de autenticación GCM (tamper detectado o key incorrecta)
            this.logger.error('Fallo al descifrar credencial SIP — posible tampering o key incorrecta');
            throw new InternalServerErrorException('No se pudo descifrar la credencial SIP');
        }
    }

    /**
     * Detecta si un string ya está cifrado por este servicio.
     * Heurística: tiene exactamente 3 partes separadas por ":" y
     * la primera parte decodifica a exactamente 12 bytes.
     */
    isEncrypted(value: string): boolean {
        if (!value) return false;
        const parts = value.split(':');
        if (parts.length !== 3) return false;
        try {
            const iv = Buffer.from(parts[0], 'base64');
            return iv.length === SipCryptoService.IV_LENGTH;
        } catch {
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers privados
    // ─────────────────────────────────────────────────────────────────────────

    private deriveKey(raw: string): Buffer {
        const trimmed = raw.trim();

        // 64 chars hex → 32 bytes
        if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
            return Buffer.from(trimmed, 'hex');
        }

        // base64 → intentar 32 bytes
        try {
            const buf = Buffer.from(trimmed, 'base64');
            if (buf.length === 32) return buf;
        } catch {
            // no es base64 válido
        }

        const msg = [
            'NEOTEL_SIP_ENCRYPTION_KEY debe ser:',
            '  - 64 caracteres hexadecimales (openssl rand -hex 32), o',
            '  - base64 de 32 bytes (openssl rand -base64 32 | tr -d "\\n")',
            `Valor recibido tiene ${trimmed.length} caracteres.`,
        ].join('\n');
        this.logger.error(msg);
        throw new InternalServerErrorException(msg);
    }
}
