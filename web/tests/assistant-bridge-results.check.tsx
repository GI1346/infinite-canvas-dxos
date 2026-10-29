import assert from "node:assert/strict";
import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAgentBridge } from "../src/pages/canvas/hooks/use-agent-bridge";
import { useCanvasAssistantStore } from "../src/stores/use-canvas-assistant-store";
import type { CanvasNodeData, CanvasConnection } from "../src/types/canvas";

const input: CanvasNodeData = { id: "result", type: "image", title: "原图", position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { content: "blob:old", naturalWidth: 2048, naturalHeight: 2048, prompt: "小狗" } };
let manualEdit: () => void;
function Harness({ projectId }: { projectId: string }) {
    const [nodes, setNodes] = useState([input]), [connections, setConnections] = useState<CanvasConnection[]>([{ id: "incoming", fromNodeId: "upstream", toNodeId: "result" }]);
    const [selectedNodeIds, setSelectedNodeIds] = useState(new Set<string>()), [viewport, setViewport] = useState({ x: 0, y: 0, k: 1 });
    const nodesRef = useRef(nodes), connectionsRef = useRef(connections), selectedNodeIdsRef = useRef(selectedNodeIds), viewportRef = useRef(viewport), generateNodeRef = useRef<any>(null), pluginHostRef = useRef<any>(null);
    nodesRef.current = nodes; connectionsRef.current = connections; selectedNodeIdsRef.current = selectedNodeIds; viewportRef.current = viewport;
    manualEdit = () => setNodes((current) => [...current, { ...input, id: "manual", title: "用户新增" }]);
    generateNodeRef.current = async () => {
        // Real branch generation duplicates upstream edges, NOT result -> branch.
        setNodes((current) => [...current, { ...input, id: "branch", metadata: { ...input.metadata, content: "blob:new", naturalWidth: 1365, naturalHeight: 2048, status: "success" } }]);
        setConnections((current) => [...current, { id: "branched", fromNodeId: "upstream", toNodeId: "branch" }]);
        return "branch";
    };
    useAgentBridge({ projectId, title: "results", nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, pluginHostRef, setNodes, setConnections, setSelectedNodeIds, setViewport, setSelectedConnectionId: () => {}, setContextMenu: () => {} });
    return null;
}
async function main() {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const context = () => useCanvasAssistantStore.getState().context!;
    try {
        await act(async () => root.render(<Harness projectId="results-a" />));
        await act(async () => {
            context().applyOps([{ type: "update_node", id: "result", patch: { title: "第一次" } }]);
            context().applyOps([{ type: "update_node", id: "result", patch: { title: "第二次" } }]);
            assert.equal(context().undoOps!()?.nodes[0].title, "第一次");
            assert.equal(context().undoOps!()?.nodes[0].title, "原图");
        });
        assert.equal(context().canUndo, false);
        await act(async () => context().applyOps([{ type: "update_node", id: "result", patch: { title: "准备生成" } }]));
        let output: CanvasNodeData | undefined;
        await act(async () => { output = await context().runNode("result", "image", "2:3,2k"); });
        assert.equal(output?.id, "branch"); assert.equal(output?.metadata?.naturalWidth, 1365);
        assert.equal(context().getSnapshot().nodes[0].metadata?.content, "blob:old");
        assert.equal(context().canUndo, false);
        await act(async () => assert.equal(context().undoOps!(), null));
        assert(context().getSnapshot().nodes.some((node) => node.id === "branch"));
        await act(async () => context().applyOps([{ type: "update_node", id: "branch", patch: { title: "改名" } }]));
        await act(async () => manualEdit());
        await act(async () => assert.equal(context().undoOps!(), null));
        assert(context().getSnapshot().nodes.some((node) => node.id === "manual"), "Undo must not overwrite unrelated manual work");
        const old = context(); await act(async () => root.render(<Harness projectId="results-b" />));
        assert.throws(() => old.applyOps([{ type: "delete_node", ids: ["result"] }]), { name: "AbortError" });
        assert.equal(old.undoOps!(), null);
        console.log("PASS actual branch ID readback (upstream-only edge), sequential undo, generation/manual-edit undo guards and stale project isolation.");
    } finally { await act(async () => root.unmount()); host.remove(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
