export type DesktopStorageInfo = { installDirectory: string; dataDirectory: string };
declare global {
    interface Window {
        blinkflowStorage?: {
            info: () => Promise<DesktopStorageInfo>;
            open: () => Promise<void>;
            clear: () => Promise<boolean>;
        };
    }
}
