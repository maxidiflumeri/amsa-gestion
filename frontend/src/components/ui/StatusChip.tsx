import React from 'react';
import { Chip, ChipProps } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import CancelIcon from '@mui/icons-material/Cancel';

export type StatusValue =
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'neutral'
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed';

interface StatusConfig {
    label: string;
    color: ChipProps['color'];
    icon: React.ReactElement;
}

const STATUS_MAP: Record<StatusValue, StatusConfig> = {
    success: { label: 'Exitoso', color: 'success', icon: <CheckCircleIcon /> },
    warning: { label: 'Advertencia', color: 'warning', icon: <WarningAmberIcon /> },
    error: { label: 'Error', color: 'error', icon: <ErrorIcon /> },
    info: { label: 'Info', color: 'info', icon: <InfoIcon /> },
    neutral: { label: 'Neutral', color: 'default', icon: <HelpOutlineIcon /> },
    pending: { label: 'Pendiente', color: 'default', icon: <HourglassEmptyIcon /> },
    running: { label: 'En curso', color: 'info', icon: <AutorenewIcon /> },
    completed: { label: 'Completado', color: 'success', icon: <TaskAltIcon /> },
    failed: { label: 'Fallido', color: 'error', icon: <CancelIcon /> },
};

interface StatusChipProps extends Omit<ChipProps, 'color' | 'label' | 'icon'> {
    status: StatusValue;
    label?: string;
    showIcon?: boolean;
}

const StatusChip: React.FC<StatusChipProps> = ({
    status,
    label,
    showIcon = true,
    size = 'small',
    ...props
}) => {
    const config = STATUS_MAP[status] ?? STATUS_MAP.neutral;

    return (
        <Chip
            label={label ?? config.label}
            color={config.color}
            icon={showIcon ? config.icon : undefined}
            size={size}
            {...props}
        />
    );
};

export default StatusChip;
