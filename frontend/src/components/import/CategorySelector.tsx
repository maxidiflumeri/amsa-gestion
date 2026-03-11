import React from "react";
import {
    Box,
    Card,
    CardActionArea,
    CardContent,
    Typography,
    Chip,
} from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PaymentsIcon from "@mui/icons-material/Payments";
import ContactPhoneIcon from "@mui/icons-material/ContactPhone";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";

interface CategoryOption {
    value: string;
    label: string;
    description: string;
    icon: React.ReactNode;
    color: string;
}

const CATEGORIES: CategoryOption[] = [
    {
        value: "DEUDORES",
        label: "Deudores",
        description: "Importar casos/deudores base con datos principales",
        icon: <PeopleIcon sx={{ fontSize: 40 }} />,
        color: "#1976d2",
    },
    {
        value: "FACTURAS",
        label: "Facturas",
        description: "Facturas vinculadas a deudores existentes",
        icon: <ReceiptLongIcon sx={{ fontSize: 40 }} />,
        color: "#2e7d32",
    },
    {
        value: "PAGOS",
        label: "Pagos",
        description: "Registrar pagos vinculados a deudores",
        icon: <PaymentsIcon sx={{ fontSize: 40 }} />,
        color: "#ed6c02",
    },
    {
        value: "CONTACTOS",
        label: "Contactos",
        description: "Teléfonos, emails y otros datos de contacto",
        icon: <ContactPhoneIcon sx={{ fontSize: 40 }} />,
        color: "#9c27b0",
    },
    {
        value: "ENRIQUECIMIENTO",
        label: "Enriquecimiento",
        description: "Datos adicionales para enriquecer deudores",
        icon: <AutoFixHighIcon sx={{ fontSize: 40 }} />,
        color: "#0288d1",
    },
    {
        value: "DEUDORES_Y_FACTURAS",
        label: "Deudores y Facturas",
        description: "Importar deudores junto con sus recibos/facturas",
        icon: <ReceiptLongIcon sx={{ fontSize: 40 }} />,
        color: "#d32f2f",
    },
];

interface Props {
    selected: string;
    onSelect: (category: string) => void;
}

export default function CategorySelector({ selected, onSelect }: Props) {
    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                ¿Qué tipo de datos vas a importar?
            </Typography>
            <Box
                sx={{
                    display: "grid",
                    gridTemplateColumns: {
                        xs: "1fr",
                        sm: "1fr 1fr",
                        md: "repeat(3, 1fr)",
                    },
                    gap: 2,
                }}
            >
                {CATEGORIES.map((cat) => {
                    const isSelected = selected === cat.value;
                    return (
                        <Card
                            key={cat.value}
                            variant="outlined"
                            sx={{
                                borderColor: isSelected ? cat.color : "divider",
                                borderWidth: isSelected ? 2 : 1,
                                bgcolor: isSelected
                                    ? `${cat.color}08`
                                    : "background.paper",
                                transition: "all 0.2s ease",
                                "&:hover": {
                                    borderColor: cat.color,
                                    transform: "translateY(-2px)",
                                    boxShadow: 2,
                                },
                            }}
                        >
                            <CardActionArea
                                onClick={() => onSelect(cat.value)}
                                sx={{ p: 2 }}
                            >
                                <CardContent
                                    sx={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        textAlign: "center",
                                        gap: 1,
                                    }}
                                >
                                    <Box sx={{ color: cat.color }}>
                                        {cat.icon}
                                    </Box>
                                    <Typography
                                        variant="subtitle1"
                                        fontWeight={600}
                                    >
                                        {cat.label}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{ fontSize: 13 }}
                                    >
                                        {cat.description}
                                    </Typography>
                                    {isSelected && (
                                        <Chip
                                            label="Seleccionado"
                                            size="small"
                                            sx={{
                                                mt: 1,
                                                bgcolor: cat.color,
                                                color: "white",
                                                fontWeight: 500,
                                            }}
                                        />
                                    )}
                                </CardContent>
                            </CardActionArea>
                        </Card>
                    );
                })}
            </Box>
        </Box>
    );
}
