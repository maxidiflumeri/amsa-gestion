import React, { useEffect, useMemo, useState } from 'react'
import { Alert, AlertTitle, Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk'
import SearchIcon from '@mui/icons-material/Search'
import { useSearchParams } from 'react-router-dom'
import TabsPanel from '../../components/deudores/TabsPanel'
import { LoadingSkeleton } from '../../components/ui'
import api from '../../api/axios'
import { resolverCaso } from './resolver-caso'

/**
 * Ficha que abre la Toolbar de Neotel cuando el operador atiende una llamada ("screen pop").
 *
 * Neotel arma la URL reemplazando las variables de la campaña:
 *
 *     https://amsagestion.anamayasa.com/telefonia/caso?llamada=[[CLAVE]]&data=[[DATA]]
 *
 * `[[CLAVE]]` es el identificador del contacto / de la llamada **en Neotel**, y `[[DATA]]` el campo
 * libre donde viaja **nuestro id de deudor**. Como el contenido de `DATA` lo define quien carga la
 * base, la resolución prueba varios candidatos en orden (ver `resolver-caso.ts`) en vez de asumir
 * una posición fija.
 *
 * Si ninguno resuelve, la pantalla **no queda en blanco**: muestra lo que mandó la central y ofrece
 * el buscador, para que el operador pueda atender igual mientras se corrige la configuración.
 *
 * Muestra el **mismo `TabsPanel` que la pantalla de Gestión**, no solo la ficha: Política y Timeline
 * son justo lo que el operador necesita mirar con la persona en línea (qué se le puede ofrecer y qué
 * se le dijo antes), y Lista de deudores le permite llegar a otro caso sin salir de la toolbar.
 */
const TelefoniaCaso: React.FC = () => {
    const [params] = useSearchParams()

    const { candidatos, valoresData, idNeotel, truncados, dataIlegible } = useMemo(
        () =>
            resolverCaso({
                data: params.get('data'),
                // `id` y `dni` se aceptan porque son los nombres de los ejemplos de la documentación
                // de Neotel: alcanza con configurar la campaña copiando y pegando para que la ficha
                // no cargue y nadie entienda por qué.
                clave: params.get('llamada') ?? params.get('clave') ?? params.get('id') ?? params.get('dni'),
                deudor: params.get('deudor'),
                sep: params.get('sep'),
                pos: params.get('pos'),
            }),
        [params],
    )

    const [tab, setTab] = useState(0)
    const [estado, setEstado] = useState<'cargando' | 'ok' | 'no-encontrado'>('cargando')
    const [deudorId, setDeudorId] = useState<number | null>(null)
    const [nombre, setNombre] = useState('')
    /** True si el caso se resolvió por la clave de Neotel y no por DATA — hay que confirmarlo. */
    const [dudoso, setDudoso] = useState(false)
    const [buscadorAbierto, setBuscadorAbierto] = useState(false)

    useEffect(() => {
        let vigente = true

        const buscar = async () => {
            setEstado('cargando')
            // Cada llamada nueva arranca en la ficha, no en la solapa que quedó de la anterior.
            setTab(0)
            // Limpiar antes de resolver: si esta búsqueda no encuentra nada, el chip de arriba no
            // puede seguir mostrando el nombre del caso anterior.
            setNombre('')
            setDudoso(false)
            // Se prueban en orden; el primero que exista gana. Un candidato equivocado devuelve 404
            // y se sigue con el siguiente.
            for (const c of candidatos) {
                try {
                    const res = await api.get(`/deudores/${c.id}`)
                    if (!vigente) return
                    const d = res.data?.data ?? res.data
                    if (d?.id) {
                        setDeudorId(c.id)
                        setNombre([d.apellido, d.nombre].filter(Boolean).join(', '))
                        setDudoso(c.origen === 'clave')
                        setEstado('ok')
                        return
                    }
                } catch {
                    /* no es este: se prueba el siguiente */
                }
            }
            if (vigente) {
                setDeudorId(null)
                setDudoso(false)
                setEstado('no-encontrado')
            }
        }

        buscar()
        return () => {
            vigente = false
        }
    }, [candidatos])

    /**
     * Caso elegido **por una persona**: desde el buscador avanzado o haciendo clic en la solapa
     * Lista de deudores. Baja la marca de `dudoso` (no hay nada que confirmar si lo eligió el
     * operador) y refresca el nombre del chip, que si no queda mostrando el del caso anterior.
     */
    const seleccionarDeudor = async (id: number | null) => {
        setDeudorId(id)
        setDudoso(false)
        setNombre('')
        // Deseleccionar una fila no es "no se encontró el caso": se deja el estado como está para
        // no disparar el cartel de error de la llamada.
        if (id == null) return
        setEstado('ok')
        try {
            const res = await api.get(`/deudores/${id}`)
            const d = res.data?.data ?? res.data
            setNombre([d?.apellido, d?.nombre].filter(Boolean).join(', '))
        } catch {
            /* el chip queda sin nombre; la ficha se muestra igual */
        }
    }

    return (
        <Box>
            {/* Contexto de la llamada: de dónde salió esta ficha y qué mandó la campaña. */}
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                <Chip
                    icon={<PhoneInTalkIcon />}
                    label={nombre ? `En llamada — ${nombre}` : 'En llamada'}
                    color="primary"
                    size="small"
                />
                {idNeotel && (
                    <Tooltip title="Identificador de la llamada en Neotel">
                        <Chip label={`Neotel ${idNeotel}`} size="small" variant="outlined" />
                    </Tooltip>
                )}
                {valoresData.map((v, i) => (
                    <Chip key={`${v}-${i}`} label={v} size="small" variant="outlined" />
                ))}
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" startIcon={<SearchIcon />} onClick={() => setBuscadorAbierto(true)}>
                    Buscar otro caso
                </Button>
            </Stack>

            {estado === 'cargando' && <LoadingSkeleton variant="detail" />}

            {estado === 'no-encontrado' && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <AlertTitle>No se encontró el caso de esta llamada</AlertTitle>
                    <Typography variant="body2">
                        {candidatos.length > 0 ? (
                            <>
                                Se probó con {candidatos.length === 1 ? 'el número' : 'los números'}{' '}
                                <strong>{candidatos.map((c) => c.id).join(', ')}</strong> y ninguno
                                corresponde a un caso cargado. Puede ser un contacto viejo, o que el id
                                de deudor no esté llegando en el campo DATA de la campaña.
                            </>
                        ) : (
                            <>
                                La llamada llegó <strong>sin ningún número de caso</strong>. Revisá la
                                configuración de la URL en la campaña de Neotel: el id del deudor tiene
                                que viajar en el campo DATA.
                            </>
                        )}
                    </Typography>
                    {dataIlegible && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            <strong>El campo DATA vino pero no se pudo leer ningún número.</strong> Casi siempre
                            es que el separador de la campaña no coincide con el que espera el sistema: hay que
                            agregarle <code>&amp;sep=</code> a la URL con el que usaron al cargar la base.
                        </Typography>
                    )}
                    {truncados > 0 && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            DATA traía más números de los que se pueden probar: quedaron <strong>{truncados}</strong> sin
                            probar. Si el id del caso es uno de esos, hay que indicar su posición con <code>&amp;pos=</code>.
                        </Typography>
                    )}
                    {valoresData.length > 0 && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            La central mandó: {valoresData.join(' · ')}
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

            {/*
              El caso no vino en DATA sino que se resolvió con el id de contacto de Neotel. Los dos
              son enteros correlativos, así que la coincidencia puede ser casual: antes de gestionar,
              el operador tiene que confirmar que es la persona con la que está hablando.
            */}
            {estado === 'ok' && dudoso && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <AlertTitle>Confirmá que es el caso correcto</AlertTitle>
                    <Typography variant="body2">
                        El campo DATA de la campaña no trajo el número de caso, así que se abrió el que
                        coincide con el identificador de Neotel (<strong>{idNeotel}</strong>). Puede ser
                        una coincidencia: verificá el nombre con la persona antes de registrar la gestión.
                    </Typography>
                </Alert>
            )}

            {/*
              Se monta aunque el caso no se haya resuelto: con `deudorId` en null la solapa de datos
              queda vacía (el cartel de arriba ya explica por qué), pero el operador puede pasarse a
              Lista de deudores y encontrar el caso a mano sin salir de la toolbar.
              El buscador avanzado lo renderiza el propio TabsPanel, por eso acá no va uno aparte.
            */}
            {estado !== 'cargando' && (
                <TabsPanel
                    selectedTab={tab}
                    setSelectedTab={setTab}
                    selectedDeudorId={deudorId}
                    setSelectedDeudorId={seleccionarDeudor}
                    advancedSearchOpen={buscadorAbierto}
                    setAdvancedSearchOpen={setBuscadorAbierto}
                />
            )}
        </Box>
    )
}

export default TelefoniaCaso
