import React, { createContext, useContext, useState, useCallback } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Button,
} from '@mui/material';

export interface ConfirmOptions {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmColor?: 'primary' | 'error' | 'warning' | 'success';
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

interface ConfirmContextType {
    confirm: ConfirmFn;
}

export const ConfirmContext = createContext<ConfirmContextType>({
    confirm: () => Promise.resolve(false),
});

export const useConfirm = (): ConfirmFn => {
    const { confirm } = useContext(ConfirmContext);
    return confirm;
};

interface PendingConfirm {
    opts: ConfirmOptions;
    resolve: (value: boolean) => void;
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setPending({ opts, resolve });
        });
    }, []);

    const handleClose = (result: boolean) => {
        if (pending) {
            pending.resolve(result);
            setPending(null);
        }
    };

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            <Dialog
                open={pending !== null}
                onClose={() => handleClose(false)}
                maxWidth="xs"
                fullWidth
                aria-labelledby="confirm-dialog-title"
            >
                {pending && (
                    <>
                        <DialogTitle id="confirm-dialog-title">
                            {pending.opts.title}
                        </DialogTitle>
                        {pending.opts.description && (
                            <DialogContent>
                                <DialogContentText>
                                    {pending.opts.description}
                                </DialogContentText>
                            </DialogContent>
                        )}
                        <DialogActions>
                            <Button onClick={() => handleClose(false)} color="inherit">
                                {pending.opts.cancelLabel ?? 'Cancelar'}
                            </Button>
                            <Button
                                onClick={() => handleClose(true)}
                                color={pending.opts.confirmColor ?? 'primary'}
                                variant="contained"
                                autoFocus
                            >
                                {pending.opts.confirmLabel ?? 'Confirmar'}
                            </Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>
        </ConfirmContext.Provider>
    );
};
