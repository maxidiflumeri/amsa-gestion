import React from 'react';
import { Avatar, type SxProps, type Theme } from '@mui/material';

export function iniciales(nombre: string): string {
    return nombre
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase();
}

interface AvatarUsuarioProps {
    nombre: string;
    avatarUrl?: string | null;
    size?: number;
    sx?: SxProps<Theme>;
}

/**
 * La foto de la cuenta de Google y, si no hay o no carga, las iniciales. Sin `referrer`: las fotos de Google a veces
 * contestan 403 cuando el pedido lleva de dónde viene.
 */
const AvatarUsuario: React.FC<AvatarUsuarioProps> = ({ nombre, avatarUrl, size = 34, sx }) => (
    <Avatar
        src={avatarUrl ?? undefined}
        alt=""
        imgProps={{ referrerPolicy: 'no-referrer' }}
        sx={[
            {
                width: size,
                height: size,
                fontSize: Math.round(size * 0.36),
                fontWeight: 700,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
            },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
    >
        {iniciales(nombre)}
    </Avatar>
);

export default AvatarUsuario;
