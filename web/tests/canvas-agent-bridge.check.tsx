import assert from "node:assert/strict";
import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAgentBridge } from "../src/pages/canvas/hooks/use-agent-bridge";
import { useCanvasAssistantStore } from "../src/stores/use-canvas-assistant-store";
import type { CanvasNodeData } from "../src/types/canvas";

const input: CanvasNodeData = { id: "native", type: "image", title: "native", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { prompt: "test" } };
let dispatched = 0, receivedSignal: AbortSignal | undefined;
let transport: () => Promise<void> = async () => {};
let renderProject = "bridge-a";
function Harness({ projectId }: { projectId: string }) {
    const [nodes, setNodes] = useState<CanvasNodeData[]>([input]), [connections, setConnections] = useState<any[]>([]);
    const [selectedNodeIds, setSelectedNodeIds] = useState(new Set<string>()), [viewport, setViewport] = useState({ x: 0, y: 0, k: 1 });
    const nodesRef = useRef(nodes), connectionsRef = useRef(connections), selectedNodeIdsRef = useRef(selectedNodeIds), viewportRef = useRef(viewport);
    const generateNodeRef = useRef<any>(null), pluginHostRef = useRef<any>(null);
    nodesRef.current = nodes; connectionsRef.current = connections; selectedNodeIdsRef.current = selectedNodeIds; viewportRef.current = viewport;
    generateNodeRef.current = async (_id: string, _mode: string, _prompt: string, signal?: AbortSignal) => {
        dispatched++; receivedSignal = signal;
        await transport();
        // Simulate the native runner's project/signal guarded graph commit, even when transport ignores abort.
        if (!signal?.aborted && projectId === renderProject) setNodes((current) => current.map((node) => ({ ...node, metadata: { ...node.metadata, status: "success" } })));
    };
    useAgentBridge({ projectId, title: "audit", getCanvasCenter: () => ({ x: (750 - viewportRef.current.x) / viewportRef.current.k, y: (500 - viewportRef.current.y) / viewportRef.current.k }), nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, pluginHostRef, setNodes, setConnections, setSelectedNodeIds, setViewport, setSelectedConnectionId: () => {}, setContextMenu: () => {} });
    return null;
}
const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function render(projectId: string) { renderProject = projectId; await act(async () => { root.render(<Harness projectId={projectId} />); await tick(); }); }
const context = () => useCanvasAssistantStore.getState().context!;
try {
    await render("bridge-a");
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(context().runNode("native", "image", "test", cancelled.signal), { name: "AbortError" });
    assert.equal(dispatched, 0);
    console.log("PASS already-aborted native Agent generation never dispatches.");

    let complete!: () => void;
    transport = () => new Promise<void>((resolve) => { complete = resolve; });
    const active = new AbortController(); let ended = false;
    const run = context().runNode("native", "image", "test", active.signal).then(() => { throw new Error("Cancelled request returned success"); }, (error) => { assert.equal(error.name, "AbortError"); ended = true; });
    await tick(); assert.equal(receivedSignal, active.signal); active.abort(); await tick();
    assert(ended, "Agent stop must not wait for an abort-ignoring transport");
    await act(async () => { complete(); await run; await tick(); });
    assert.notEqual(context().getSnapshot().nodes[0].metadata?.status, "success");
    console.log("PASS in-flight stop propagates the actual signal and settles promptly; late transport cannot report success.");

    const old = context(); const oldRun = old.runNode("native", "image", "test").then(() => { throw new Error("Old project returned success"); }, (error) => assert.equal(error.name, "AbortError"));
    await tick(); await render("bridge-b"); await act(async () => { complete(); await oldRun; await tick(); });
    assert.equal(context().snapshot.projectId, "bridge-b");
    assert.notEqual(context().getSnapshot().nodes[0].metadata?.status, "success");
    await assert.rejects(old.runNode("native", "image", "test"), { name: "AbortError" });
    console.log("PASS project switches reject both pending completion and stale-context dispatch.");

    transport = async () => {};
    let output: CanvasNodeData | undefined;
    await act(async () => { output = await context().runNode("native", "image", "test"); });
    assert.equal(output?.metadata?.status, "success");
    console.log("PASS successful native generation flushes the actual updated graph before Agent readback.");
} finally { await act(async () => root.unmount()); host.remove(); }
