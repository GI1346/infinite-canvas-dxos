export type DesktopStorageInfo = { installDirectory: string; dataDirectory: string };
declare global {
    interface Window {
        blinkflowDownloads?: { saveImages: (files: { name: string; data: ArrayBuffer }[]) => Promise<{ canceled: boolean; count: number; directory?: string }> };
        blinkflowStorage?: {
            info: () => Promise<DesktopStorageInfo>;
            open: () => Promise<void>;
            clear: () => Promise<boolean>;
        };
    }
}
