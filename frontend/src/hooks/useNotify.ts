import { useSnackbar, OptionsObject } from 'notistack';
import { AxiosError } from 'axios';

function extractErrorMessage(error: AxiosError | Error | string): string {
    if (typeof error === 'string') return error;

    if ((error as AxiosError).isAxiosError) {
        const axiosErr = error as AxiosError<{ message?: string | string[] }>;
        const data = axiosErr.response?.data;
        if (data?.message) {
            return Array.isArray(data.message) ? data.message[0] : data.message;
        }
    }

    return (error as Error).message || 'Error inesperado';
}

export function useNotify() {
    const { enqueueSnackbar } = useSnackbar();

    const opts = (extra?: OptionsObject): OptionsObject => ({
        anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
        autoHideDuration: 4000,
        ...extra,
    });

    return {
        success: (message: string, extra?: OptionsObject) =>
            enqueueSnackbar(message, { ...opts(extra), variant: 'success' }),

        error: (error: AxiosError | Error | string, extra?: OptionsObject) => {
            const message = extractErrorMessage(error);
            return enqueueSnackbar(message, { ...opts(extra), variant: 'error', autoHideDuration: 6000 });
        },

        warning: (message: string, extra?: OptionsObject) =>
            enqueueSnackbar(message, { ...opts(extra), variant: 'warning' }),

        info: (message: string, extra?: OptionsObject) =>
            enqueueSnackbar(message, { ...opts(extra), variant: 'info' }),
    };
}
