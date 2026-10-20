// Only media persistence is mocked: event dispatch and all canvas/node components are real.
export async function uploadImage(url: string) { return { url, storageKey: "test:image", width: 1024, height: 1024, bytes: 3, mimeType: "image/png" }; }
export async function uploadMediaFile(url: string) { return { url, storageKey: "test:video", width: 1280, height: 720, bytes: 3, mimeType: "video/mp4" }; }
export function previewUrlFor() { return undefined; }
export function subscribeImagePreviews() { return () => {}; }
export function getImagePreviewRevision() { return 0; }
