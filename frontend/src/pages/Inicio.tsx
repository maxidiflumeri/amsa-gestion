// src/pages/Inicio.tsx
import React from 'react';
import { Box, Grid, Skeleton, Typography, useTheme } from '@mui/material';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import { PageContainer, PageHeader, SectionCard, EmptyState } from '../components/ui';

interface MetricCardProps {
    label: string;
    icon: React.ReactNode;
    comingSoon?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, icon, comingSoon = true }) => {
    const theme = useTheme();

    return (
        <SectionCard
            title={label}
            action={
                <Box
                    sx={{
                        color: 'text.disabled',
                        display: 'flex',
                        alignItems: 'center',
                        pr: 1,
                        '& svg': { fontSize: 22 },
                    }}
                >
                    {icon}
                </Box>
            }
        >
            {comingSoon ? (
                <EmptyState
                    title="Próximamente"
                    description="Esta métrica estará disponible cuando se conecte el endpoint correspondiente."
                />
            ) : (
                <Box sx={{ py: 2 }}>
                    <Skeleton variant="text" width="40%" height={48} />
                    <Skeleton variant="text" width="60%" height={20} sx={{ mt: 1 }} />
                </Box>
            )}
        </SectionCard>
    );
};

const Inicio: React.FC = () => {
    return (
        <PageContainer>
            <PageHeader
                title="Inicio"
                subtitle="Panel de control de AMSA Gestión"
            />

            <Grid container spacing={3}>
                <Grid item xs={12} sm={6} lg={4}>
                    <MetricCard
                        label="Deudores totales"
                        icon={<PeopleOutlineIcon />}
                    />
                </Grid>

                <Grid item xs={12} sm={6} lg={4}>
                    <MetricCard
                        label="Importaciones pendientes"
                        icon={<UploadFileOutlinedIcon />}
                    />
                </Grid>

                <Grid item xs={12} sm={6} lg={4}>
                    <MetricCard
                        label="Gestiones del día"
                        icon={<AssignmentOutlinedIcon />}
                    />
                </Grid>
            </Grid>
        </PageContainer>
    );
};

export default Inicio;
