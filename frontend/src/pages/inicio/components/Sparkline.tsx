import React from 'react';
import { Box, useTheme } from '@mui/material';
import { Line, LineChart } from 'recharts';

interface Props {
    valores: number[];
    ancho?: number;
    alto?: number;
}

/** La línea chica de un indicador: sin ejes ni tooltip, en el color primario del tema. Es decorativa (el número está al lado). */
const Sparkline: React.FC<Props> = ({ valores, ancho = 88, alto = 30 }) => {
    const theme = useTheme();
    if (valores.length < 2) return null;
    const datos = valores.map((v, i) => ({ i, v }));
    return (
        <Box aria-hidden sx={{ width: ancho, height: alto, flex: 'none', lineHeight: 0 }}>
            <LineChart width={ancho} height={alto} data={datos} margin={{ top: 3, right: 3, bottom: 3, left: 3 }}>
                <Line type="monotone" dataKey="v" stroke={theme.palette.primary.main} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
        </Box>
    );
};

export default Sparkline;
