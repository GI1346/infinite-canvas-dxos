const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const { build } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
fs.mkdirSync(".checks", { recursive: true });

// Copy production AST statements verbatim: the test supplies only initial data and UI shell.
// No drag, selection, history, or keyboard algorithm is reimplemented here.
function productionHarness() {
    const source = fs.readFileSync("src/pages/canvas/project.tsx", "utf8");
    const ast = ts.createSourceFile("project.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const page = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "InfiniteCanvasPage");
    if (!page?.body) throw new Error("Production InfiniteCanvasPage not found");
    const names = new Set(`containerRef historyRef lastHistoryRef historyCommitTimerRef applyingHistoryRef historyPausedRef rafRef nodeDraggingRef dragRef nodes connections chatSessions activeChatId viewport selectedNodeIds selectedConnectionId hoveredNodeId connectingParams connectionTargetNodeId pendingConnectionCreate mouseWorld selectionBox contextMenu nodeCreatePosition backgroundMode showImageInfo projectLoaded toolbarNodeId dialogNodeId infoNodeId paintNodeId cropNodeId maskEditNodeId isNodeDragging dropTargetGroupId historyState nodesRef connectionsRef selectedNodeIdsRef viewportRef connectingParamsRef connectionTargetNodeIdRef selectionBoxRef pendingConnectionCreateRef createHistoryEntry screenToCanvas setConnecting applyHistory undoCanvas redoCanvas handleCanvasMouseDown selectNodeByEvent pendingSelectionRef handleNodeSelectCapture handleNodeMouseDown prepareNodeDrag finishNodeDrag handleGlobalMouseMove handleGlobalPointerMove handleGlobalMouseUp handleConnectStart`.split(" "));
    const statements = [];
    let copied = 0, effects = 0;
    for (const statement of page.body.statements) {
        const text = statement.getText(ast);
        if (ts.isVariableStatement(statement)) {
            const declaration = statement.declarationList.declarations[0];
            const name = ts.isIdentifier(declaration.name) ? declaration.name.text : ts.isArrayBindingPattern(declaration.name) ? declaration.name.elements[0]?.name?.text : undefined;
            if (names.has(name)) { statements.push(text); names.delete(name); copied++; }
        } else if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
            const call = statement.expression;
            const effect = call.expression.getText(ast);
            if ((effect === "useLayoutEffect" && (text.includes("nodesRef.current = nodes;") || text.includes("selectionBoxRef.current = selectionBox;"))) || (effect === "useEffect" && (text.includes("const handlePointerUp =") || text.includes("const handleKeyDown =") || text.includes("if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;")))) { statements.push(text); effects++; }
        }
    }
    if (names.size || effects !== 5) throw new Error(`Production extraction incomplete: ${[...names]} / ${effects} effects`);
    console.log(`Production AST: ${copied} unmodified declarations + ${effects} unmodified effects`);
    return `
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { ConnectionPath } from "@/components/canvas/canvas-connections";
import { cloneDragSelection, expandDragNodeIds } from "@/lib/canvas/canvas-drag-copy";
import { findGroupDropTarget, snapNodesIntoGroup, findContainingGroupId, canGroupSelectedNodes, canUngroupSelectedNodes } from "@/lib/canvas/canvas-node-geometry";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { useConfigStore } from "@/stores/use-config-store";
import { CanvasNodeType } from "@/types/canvas";
const no = () => {};
const cancelPendingConnectionCreate = no, connectNodes = no;
const shortcut = (name) => () => globalThis.__dragShortcut?.(name);
const copySelectedNodes = shortcut("copy"), deleteConnection = shortcut("deleteConnection"), deleteNodes = shortcut("deleteNodes"), groupSelection = shortcut("group"), pasteCopiedNodes = shortcut("paste"), pasteSystemClipboard = shortcut("systemPaste"), ungroupSelection = shortcut("ungroup");
const getConnectionDropTarget = () => ({ nodeId: null, isNearNode: false });
export function ProjectDragHarness({ seed, expose }) {
 const initialized = useRef(false), focusNodeRef = useRef(no);
 ${statements.join("\n")}
 useLayoutEffect(() => {
  if (initialized.current) return;
  initialized.current = true;
  setNodes(seed.nodes); setConnections(seed.connections); setViewport(seed.viewport); setSelectedNodeIds(new Set(seed.selected || []));
  lastHistoryRef.current = { nodes: seed.nodes, connections: seed.connections, chatSessions, activeChatId, backgroundMode, showImageInfo };
  setProjectLoaded(true);
 }, []);
 const pluginHost = { getNode: (id) => nodesRef.current.find(n => n.id === id) || null, getNodes: () => nodesRef.current, getConnections: () => connectionsRef.current, getUpstream: () => [], getDownstream: () => [], updateNode: no, updateMetadata: no, applyOps: no, openPanel: no, closePanel: no, ai: { listModels: () => [], defaultModel: () => "", generateText: () => { throw Error("Unexpected AI"); }, generateImage: () => { throw Error("Unexpected AI"); }, generateVideo: () => { throw Error("Unexpected AI"); } } };
 useLayoutEffect(() => expose({ nodes, connections, selected: selectedNodeIds, viewport, history: historyRef.current, last: lastHistoryRef.current, drag: dragRef.current, container: containerRef.current, connecting: connectingParams, selectionBox, isNodeDragging, updateOriginal: (id, patch) => setNodes(items => items.map(item => item.id === id ? { ...item, metadata: { ...item.metadata, ...patch } } : item)) }), [nodes, connections, selectedNodeIds, viewport, isNodeDragging, selectionBox, connectingParams, historyState]);
 return <InfiniteCanvas containerRef={containerRef} viewport={viewport} tool="select" onViewportChange={setViewport} onCanvasMouseDown={handleCanvasMouseDown}>
  <svg>{connections.map(connection => { const from = nodes.find(n => n.id === connection.fromNodeId), to = nodes.find(n => n.id === connection.toNodeId); return from && to ? <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active={false} onSelect={no} onContextMenu={no} /> : null; })}</svg>
  {nodes.map(node => <CanvasNode key={node.id} data={node} scale={viewport.k} isSelected={selectedNodeIds.has(node.id)} isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={Boolean(connectingParams)} showPanel={false} showImageInfo={false} groupChildCount={nodes.filter(child => child.metadata?.groupId === node.id).length} pluginHost={pluginHost} onMouseDown={handleNodeMouseDown} onSelectCapture={handleNodeSelectCapture} onHoverStart={no} onHoverEnd={no} onConnectStart={handleConnectStart} onResizeStart={no} onResize={no} onResizeEnd={no} onContentChange={no} onTitleChange={no} onContextMenu={no} />)}
 </InfiniteCanvas>;
}`;
}
(async () => {
    const outfile = path.resolve(".checks/drag-copy-ui.cjs");
    await build({ entryPoints: ["tests/drag-copy-ui.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile,
        alias: { "@/services/image-storage": path.resolve("tests/interaction-media-mock.ts"), "@/services/file-storage": path.resolve("tests/interaction-media-mock.ts") },
        plugins: [{ name: "production-project-drag", setup(build) {
            build.onResolve({ filter: /^project-drag-harness$/ }, () => ({ path: "production-project-drag", namespace: "production-project" }));
            build.onLoad({ filter: /.*/, namespace: "production-project" }, () => ({ contents: productionHarness(), loader: "tsx", resolveDir: process.cwd() }));
        } }],
    });
    execFileSync(process.execPath, ["--require", path.resolve("tests/channel-protocol-dom.cjs"), outfile], { stdio: "inherit" });
})().catch((error) => { console.error(error); process.exitCode = 1; });
