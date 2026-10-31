// Shared lock without coupling the original Agent store to the Harness bridge.
export const harnessBusyProjects = new Set<string>();
export const isHarnessCanvasBusy = (projectId: string) => harnessBusyProjects.has(projectId);
