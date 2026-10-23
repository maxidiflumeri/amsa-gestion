import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

// Gestión como app instalada (igual que AMSA Sender): el service worker, el aviso de versión nueva y la instalación.
// `registerType: 'prompt'` en vite.config.ts: la versión nueva espera a que la persona toque "Actualizar"; así no se
// recarga sola en medio de una gestión, y tampoco queda días con el código viejo.

/** El evento que Chrome dispara cuando la app se puede instalar (no está en los tipos de TypeScript). */
interface EventoInstalar extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface EstadoPwa {
    hayVersionNueva: boolean;
    actualizar: () => void;
    descartarVersionNueva: () => void;
    /** Chrome / Edge ofrecen instalar y la persona no lo descartó hace poco. */
    puedeInstalar: boolean;
    instalar: () => Promise<'aceptada' | 'rechazada' | 'no-disponible'>;
    /** "Ahora no": el aviso no vuelve por 14 días. */
    descartarInstalar: () => void;
    /** En iOS no hay evento de instalación: se muestran las instrucciones (Compartir › Agregar a inicio). */
    esIos: boolean;
    esStandalone: boolean;
    /** Lo descartó hace menos de 14 días (vale también para las instrucciones de iOS). */
    instalarDescartado: boolean;
}

const CLAVE_DESCARTE = 'pwaInstalarDescartadoHasta';
const DIAS_DESCARTE = 14;
const CADA_CUANTO_BUSCA_VERSION_MS = 60 * 60 * 1000;

const INERTE: EstadoPwa = {
    hayVersionNueva: false,
    actualizar: () => {},
    descartarVersionNueva: () => {},
    puedeInstalar: false,
    instalar: async () => 'no-disponible',
    descartarInstalar: () => {},
    esIos: false,
    esStandalone: false,
    instalarDescartado: false,
};

const PwaContext = createContext<EstadoPwa>(INERTE);

function leerDescarte(): boolean {
    try {
        return Number(localStorage.getItem(CLAVE_DESCARTE) || 0) > Date.now();
    } catch {
        return false;
    }
}

function detectarIos(): boolean {
    const ua = navigator.userAgent || '';
    // iPadOS se presenta como Mac: se lo reconoce porque tiene pantalla táctil.
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function detectarStandalone(): boolean {
    const nav = navigator as Navigator & { standalone?: boolean };
    return !!window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}

export const PwaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [hayVersionNueva, setHayVersionNueva] = useState(false);
    const [eventoInstalar, setEventoInstalar] = useState<EventoInstalar | null>(null);
    const [descartado, setDescartado] = useState(leerDescarte);
    const [esStandalone, setEsStandalone] = useState(detectarStandalone);
    const actualizarSW = useRef<((recargar?: boolean) => Promise<void>) | null>(null);

    useEffect(() => {
        let intervalo: ReturnType<typeof setInterval> | undefined;
        let registro: ServiceWorkerRegistration | undefined;
        const buscarVersion = () => {
            if (document.visibilityState === 'visible') registro?.update().catch(() => {});
        };
        actualizarSW.current = registerSW({
            onNeedRefresh: () => setHayVersionNueva(true),
            onRegisteredSW: (_url, r) => {
                registro = r;
                // Una app instalada puede quedar abierta días: se busca versión nueva cada hora y al volver a la pestaña.
                intervalo = setInterval(buscarVersion, CADA_CUANTO_BUSCA_VERSION_MS);
            },
        });
        document.addEventListener('visibilitychange', buscarVersion);
        return () => {
            if (intervalo) clearInterval(intervalo);
            document.removeEventListener('visibilitychange', buscarVersion);
        };
    }, []);

    useEffect(() => {
        const alPoder = (e: Event) => {
            // Sin esto Chrome muestra su propia barra; el aviso lo da el Inicio, que la persona puede descartar.
            e.preventDefault();
            setEventoInstalar(e as EventoInstalar);
        };
        const alInstalar = () => {
            setEventoInstalar(null);
            setEsStandalone(true);
        };
        window.addEventListener('beforeinstallprompt', alPoder);
        window.addEventListener('appinstalled', alInstalar);
        return () => {
            window.removeEventListener('beforeinstallprompt', alPoder);
            window.removeEventListener('appinstalled', alInstalar);
        };
    }, []);

    const instalar = useCallback(async () => {
        if (!eventoInstalar) return 'no-disponible' as const;
        await eventoInstalar.prompt();
        const { outcome } = await eventoInstalar.userChoice;
        // El evento sirve una sola vez: si la rechazó, Chrome lo vuelve a disparar más adelante.
        setEventoInstalar(null);
        return outcome === 'accepted' ? ('aceptada' as const) : ('rechazada' as const);
    }, [eventoInstalar]);

    const descartarInstalar = useCallback(() => {
        setDescartado(true);
        try {
            localStorage.setItem(CLAVE_DESCARTE, String(Date.now() + DIAS_DESCARTE * 24 * 60 * 60 * 1000));
        } catch {
            /* sin localStorage: vale solo para esta pestaña */
        }
    }, []);

    const valor = useMemo<EstadoPwa>(() => ({
        hayVersionNueva,
        actualizar: () => {
            setHayVersionNueva(false);
            void actualizarSW.current?.(true);
        },
        descartarVersionNueva: () => setHayVersionNueva(false),
        puedeInstalar: !!eventoInstalar && !descartado && !esStandalone,
        instalar,
        descartarInstalar,
        esIos: detectarIos(),
        esStandalone,
        instalarDescartado: descartado,
    }), [hayVersionNueva, eventoInstalar, descartado, esStandalone, instalar, descartarInstalar]);

    return <PwaContext.Provider value={valor}>{children}</PwaContext.Provider>;
};

/** Fuera del provider (tests de pantallas sueltas) devuelve un estado inerte: sin instalación ni versión nueva. */
export function usePwa(): EstadoPwa {
    return useContext(PwaContext);
}
