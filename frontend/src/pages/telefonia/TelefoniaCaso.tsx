import React, { useEffect, useState } from 'react'
import { Alert, AlertTitle, Box, Button, Chip, Stack, Typography } from '@mui/material'
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk'
import SearchIcon from '@mui/icons-material/Search'
import { useSearchParams } from 'react-router-dom'
import FichaDeudor from '../../components/deudores/ficha'
import BuscadorAvanzadoModal from '../../components/deudores/BuscadorAvanzadoModal'
import { LoadingSkeleton } from '../../components/ui'
import api from '../../api/axios'

/**
 * Ficha que abre la toolbar de Neotel cuando el operador atiende una llamada ("screen pop").
 *
 * Neotel arma la URL reemplazando las variables de la campaña:
 *
 *     https://amsagestion.anamayasa.com/telefonia/caso?id=[[CLAVE]]&data=[[DATA]]
 *
 * `[[CLAVE]]` es el **id interno del deudor** (así se carga la base en Neotel), lo que evita
 * cualquier ambigüedad: no hay que resolver por documento ni por teléfono. `[[DATA]]` es un campo
 * libre con información adicional del contacto; sus valores vienen unidos por el SEPARADOR que se
 * configura en la campaña.
 *
 * Si el caso no se encuentra, la pantalla **no queda en blanco**: muestra los datos crudos que mandó
 * Neotel y ofrece el buscador, para que el operador pueda atender igual mientras se corrige la base.
 */

/** Separador por defecto de `DATA`. Se puede sobreescribir por query (`&sep=;`). */
const SEPARADOR_DEFAULT = '|'

const TelefoniaCaso: React.FC = () => {
    const [params] = useSearchParams()
    // `id` es el nombre propio; `dni` y `clave` se aceptan porque son los que usan los ejemplos de
    // Neotel y evitan una carga fallida si la campaña se configuró copiando la documentación.
    const claveCruda = (params.get('id') ?? params.get('dni') ?? params.get('clave') ?? '').trim()
    const data = params.get('data') ?? ''
    const separador = params.get('sep') || SEPARADOR_DEFAULT

    const deudorId = /^\d+$/.test(claveCruda) ? Number(claveCruda) : null

    const [estado, setEstado] = useState<'cargando' | 'ok' | 'no-encontrado'>('cargando')
    const [nombre, setNombre] = useState<string>('')
    const [buscadorAbierto, setBuscadorAbierto] = useState(false)
    // Si el operador busca el caso a mano, se muestra ese en vez del que vino en la URL.
    const [idManual, setIdManual] = useState<number | null>(null)

    useEffect(() => {
        if (deudorId == null) {
            setEstado('no-encontrado')
            return
        }
        let vigente = true
        setEstado('cargando')
        api.get(`/deudores/${deudorId}`)
            .then((res) => {
                if (!vigente) return
                const d = res.data?.data ?? res.data
                setNombre([d?.apellido, d?.nombre].filter(Boolean).join(', ') || '')
                setEstado('ok')
            })
            .catch(() => {
                if (vigente) setEstado('no-encontrado')
            })
        return () => {
            vigente = false
        }
    }, [deudorId])

    const idAMostrar = idManual ?? (estado === 'ok' ? deudorId : null)

    const valoresData = data
        .split(separador)
        .map((v) => v.trim())
        .filter(Boolean)

    return (
        <Box>
            {/* Contexto de la llamada: de dónde salió esta ficha y qué mandó la campaña. */}
            <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ mb: 1.5 }}
            >
                <Chip
                    icon={<PhoneInTalkIcon />}
                    label={nombre ? `En llamada — ${nombre}` : 'En llamada'}
                    color="primary"
                    size="small"
                />
                {valoresData.map((v, i) => (
                    <Chip key={`${v}-${i}`} label={v} size="small" variant="outlined" />
                ))}
                <Box sx={{ flexGrow: 1 }} />
                <Button
                    size="small"
                    startIcon={<SearchIcon />}
                    onClick={() => setBuscadorAbierto(true)}
                >
                    Buscar otro caso
                </Button>
            </Stack>

            {estado === 'cargando' && <LoadingSkeleton variant="detail" />}

            {estado === 'no-encontrado' && idManual == null && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <AlertTitle>No se encontró el caso que mandó la central</AlertTitle>
                    <Typography variant="body2">
                        {claveCruda
                            ? <>La llamada llegó con la clave <strong>{claveCruda}</strong>, que no corresponde a
                               ningún caso cargado. Puede ser un contacto viejo o un dato mal cargado en la campaña.</>
                            : <>La llamada llegó <strong>sin identificador de caso</strong>. Revisá la configuración
                               de la URL en la campaña de Neotel.</>}
                    </Typography>
                    {valoresData.length > 0 && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            Datos que mandó la central: {valoresData.join(' · ')}
                        </Typography>
                    )}
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SearchIcon />}
                        sx={{ mt: 1.5 }}
                        onClick={() => setBuscadorAbierto(true)}
                    >
                        Buscar el caso a mano
                    </Button>
                </Alert>
            )}

            {idAMostrar != null && <FichaDeudor deudorId={idAMostrar} />}

            <BuscadorAvanzadoModal
                open={buscadorAbierto}
                onClose={() => setBuscadorAbierto(false)}
                onSelectDeudor={(id) => {
                    setIdManual(id)
                    setBuscadorAbierto(false)
                }}
            />
        </Box>
    )
}

export default TelefoniaCaso
