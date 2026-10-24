import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNode } from "../src/components/canvas/canvas-node";
import { ActiveConnectionPath, connectionDragNodeIds } from "../src/components/canvas/canvas-connections";
import { normalizeConnection, getConnectionTargetAnchor } from "../src/lib/canvas/canvas-node-geometry";
import { tableConnectionPort } from "../src/lib/canvas/canvas-table-port";
import { fusionConnectionPort } from "../src/lib/canvas/canvas-fusion-ports";
import { createCanvasNode } from "../src/lib/canvas/canvas-node-factory";
import { registerNodeDefinitions } from "../src/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type Position } from "../src/types/canvas";

const source = readFileSync("src/pages/canvas/project.tsx", "utf8"), tree = ts.createSourceFile("project.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string, scope: Record<string, unknown>) {
    let found: ts.ArrowFunction | undefined;
    const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useCallback" && ts.isArrowFunction(node.initializer.arguments[0])) found = node.initializer.arguments[0]; ts.forEachChild(node, visit); };
    visit(tree); assert(found, `Actual useCallback ${name} missing`);
    const code = ts.transpileModule(`const actual = ${found.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return new Function(...Object.keys(scope), `${code}; return actual;`)(...Object.values(scope));
}
const previewExpression = source.split(/\r?\n/).find((line) => line.includes("{connectingParams ? connectionDragNodeIds(connectingParams).map"))!.trim();
assert(previewExpression, "Actual project preview render expression missing");
const compilePreview = (scope: Record<string, unknown>) => new Function(...Object.keys(scope), `${ts.transpileModule(`const ActualPreview = () => <svg>${previewExpression}</svg>;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText}; return ActualPreview;`)(...Object.values(scope));
const ref = <T,>(current: T) => ({ current });
const no = () => {}, host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
const a: CanvasNodeData = { id: "a", type: "image", title: "a", position: { x: 20, y: 100 }, width: 240, height: 180, metadata: {} };
const b: CanvasNodeData = { ...a, id: "b", title: "b", position: { x: 20, y: 420 } };
const table: CanvasNodeData = { ...a, id: "table", type: "dxos:table", title: "表格", position: { x: 650, y: 100 }, width: 420, height: 400, metadata: { tableInputChannels: [1,2,3,4,5].map((i) => ({ id: `input-${i}` })) } };
const group: CanvasNodeData = { ...a, id: "group", type: "group", position: { x: 1300, y: 0 } };
const config: CanvasNodeData = { ...a, id: "config", type: "config", position: { x: 1800, y: 0 } };
const fusion: CanvasNodeData = { ...a, id: "fusion", type: "blinkflow:fusion", position: { x: 1100, y: 450 }, width: 460, height: 380 };
const nodesRef = ref<CanvasNodeData[]>([a,b,table,group,config,fusion]), selectedNodeIdsRef = ref(new Set(["a","b"])), pendingSelectionRef = ref<Set<string>|null>(new Set(["stale"]));
const viewportRef = ref({ x: 70, y: -30, k: 1.5 }), box = { left: 220, top: 90, width: 1200, height: 900 }, containerRef = ref({ getBoundingClientRect: () => box });
let connections: CanvasConnection[] = [], connecting: ConnectionHandle | null = null, selectedConnection: string|null = "old", contextMenu: unknown = "old", toolbar: unknown = null, dialog: unknown = null, pending: unknown = "old", mouseWorld: Position = { x: 0, y: 0 }, warnings: unknown[] = [], drags = 0;
const connectionTargetNodeIdRef = ref<string|null>("old");
const screenToCanvas = callback("screenToCanvas", { containerRef, viewportRef });
const common = { connectionDragNodeIds, normalizeConnection, nodesRef, screenToCanvas, tableConnectionPort, fusionConnectionPort, nanoid: () => `edge-${Math.random()}`, message: { warning: (value: unknown) => warnings.push(value) }, t: (value: string) => value, setContextMenu: (value: unknown) => { contextMenu = value; }, setConnections: (update: (prev: CanvasConnection[]) => CanvasConnection[]) => { connections = update(connections); } };
const selectNodeByEvent = callback("selectNodeByEvent", { selectedNodeIdsRef, setSelectedNodeIds: (value: Set<string>) => { selectedNodeIdsRef.current = value; }, setToolbarNodeId: (value: unknown) => { toolbar = value; } });
const capture = callback("handleNodeSelectCapture", { pendingSelectionRef, selectNodeByEvent, setContextMenu: (value: unknown) => { contextMenu = value; }, setHoveredNodeId: no, setSelectedConnectionId: (value: string|null) => { selectedConnection = value; } });
const start = callback("handleConnectStart", { pendingSelectionRef, selectedNodeIdsRef, screenToCanvas, setMouseWorld: (value: Position) => { mouseWorld = value; }, setConnecting: (value: ConnectionHandle|null) => { connecting = value; }, connectionTargetNodeIdRef, setConnectionTargetNodeId: no, setSelectedConnectionId: (value: string|null) => { selectedConnection = value; } });
const connect = callback("connectNodes", common);
const drop = callback("getConnectionDropTarget", { ...common, viewportRef, CONNECTION_NODE_HIT_PADDING: 32, CONNECTION_HANDLE_HIT_RADIUS: 40, getConnectionTargetAnchor });
const create = callback("createConnectedNode", { ...common, CanvasNodeType, createCanvasNode, getGenerationCount: (value: string) => Number(value), effectiveConfig: { imageModel: "stub-model", model: "stub-model", size: "2048x2048", count: "1", canvasImageCount: "1" }, setNodes: (update: (prev: CanvasNodeData[]) => CanvasNodeData[]) => { nodesRef.current = update(nodesRef.current); }, setSelectedNodeIds: (value: Set<string>) => { selectedNodeIdsRef.current = value; }, setSelectedConnectionId: (value: string|null) => { selectedConnection = value; }, setDialogNodeId: (value: unknown) => { dialog = value; }, setPendingConnectionCreate: (value: unknown) => { pending = value; }, setConnecting: (value: ConnectionHandle|null) => { connecting = value; } });
const base = { scale: 1, isSelected: true, isRelated: false, isFocusRelated: false, isConnectionTarget: false, isConnecting: false, showPanel: false, showImageInfo: false, onHoverStart: no, onHoverEnd: no, onResizeStart: no, onResize: no, onResizeEnd: no, onContentChange: no, onTitleChange: no, onContextMenu: no };
const screen = (point: Position) => ({ clientX: box.left + viewportRef.current.x + point.x * viewportRef.current.k, clientY: box.top + viewportRef.current.y + point.y * viewportRef.current.k });
const event = (target: Element, extra = {}) => ({ button: 0, target, clientX: 100, clientY: 200, shiftKey: false, metaKey: false, ctrlKey: false, preventDefault: no, stopPropagation: no, ...extra });
let hits: Element|null = null; document.elementFromPoint = () => hits;
let passed = 0;
async function test(name: string, run: () => unknown | Promise<unknown>) { await run(); passed++; console.log(`PASS ${name}`); }
async function main() {
    const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Multiconnect acceptance must not call network"); };
    try {
        registerNodeDefinitions(["image","text","dxos:table","config","group","blinkflow:fusion"].map((type) => ({ type, title: type, icon: null, defaultSize: { width: 340, height: 240 } })));
        await test("actual CanvasNode capture/start preserves Shift-selected two sources and freezes IDs", async () => {
            await act(async () => root.render(<><CanvasNode {...base} data={a} renderNodeContent={() => <div>content</div>} onMouseDown={() => { drags++; }} onSelectCapture={capture} onConnectStart={start} /></>));
            const handle = host.querySelector<HTMLElement>('[data-node-id="a"] .-right-6[data-node-handle]')!; assert(handle);
            await act(async () => { handle.firstElementChild!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, shiftKey: true })); handle.firstElementChild!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, shiftKey: true, clientX: 610, clientY: 340 })); });
            assert.deepEqual([...selectedNodeIdsRef.current], ["a","b"]); assert.equal(pendingSelectionRef.current, null); assert.equal(drags, 0); assert.deepEqual(connecting?.sourceNodeIds, ["a","b"]); assert.equal(selectedConnection, null); assert.equal(connectionTargetNodeIdRef.current, null);
            selectedNodeIdsRef.current.delete("b"); selectedNodeIdsRef.current.add("config"); assert.deepEqual(connectionDragNodeIds(connecting!), ["a","b"]);
            const previous = connecting; start(event(handle, { button: 2 }), "a", "source"); assert.equal(connecting, previous);
        });
        await test("actual multi-preview project JSX renders each source and snaps all to table input3", async () => {
            mouseWorld = { x: table.position.x, y: table.position.y + table.height/2 };
            const Preview = compilePreview({ React, connectingParams: connecting, connectionDragNodeIds, ActiveConnectionPath, nodeById: new Map(nodesRef.current.map((node) => [node.id,node])), mouseWorld, connectionTargetNodeId: table.id });
            await act(async () => root.render(<Preview />)); const paths = [...host.querySelectorAll<SVGPathElement>("[data-connection-preview]")]; assert.deepEqual(paths.map((path) => path.dataset.connectionPreview), ["a","b"]); assert(paths.every((path) => path.getAttribute("d")!.endsWith(", 650 300"))); assert(paths.every((path) => path.style.pointerEvents === "none")); assert.notEqual(paths[0].getAttribute("d"),paths[1].getAttribute("d"));
        });
        await test("actual batch connect uses table ports2/3, rejects sources as targets and deduplicates", () => {
            const current = connecting!; const tableDom = document.createElement("div"); tableDom.dataset.nodeId=table.id; tableDom.innerHTML='<span data-table-port="input-2"><b>2</b></span>'; hits = tableDom.querySelector("b");
            const point = screen({ x: table.position.x, y: table.position.y+table.height/2-56 }); connect(current,table.id,point.clientX,point.clientY); assert.equal(connections.length,2); assert(connections.every((edge) => edge.toNodeId === table.id && edge.toPort === "input-2")); connect(current,table.id,point.clientX,point.clientY); assert.equal(connections.length,2);
            hits = null; const third = screen({ x:table.position.x,y:table.position.y+table.height/2 }); connect(current,table.id,third.clientX,third.clientY); assert.equal(connections.length,4); assert.equal(connections.filter((edge) => edge.toPort === "input-3").length,2);
            connect(current,"a",100,100); connect(current,"b",100,100); assert.equal(connections.length,4); assert(!connections.some((edge) => edge.fromNodeId === edge.toNodeId)); assert.equal(contextMenu,null);
        });
        await test("actual target hit callback excludes complete source set, handles zoom, invalid groups and partial compatibility", () => {
            for(const k of [.05,.25,1,2,5]) { viewportRef.current.k=k; const point=screen({x:table.position.x,y:table.position.y+table.height/2-56}); assert.deepEqual(drop(point.clientX,point.clientY,connecting!),{nodeId:table.id,isNearNode:true}); }
            viewportRef.current.k=1.5; for(const node of [a,b,group]) { const point=screen({x:node.position.x+node.width/2,y:node.position.y+node.height/2}); const result=drop(point.clientX,point.clientY,connecting!); assert.equal(result.nodeId,null); assert.equal(result.isNearNode,true); }
            const empty=screen({x:2500,y:2000}); assert.deepEqual(drop(empty.clientX,empty.clientY,connecting!),{nodeId:null,isNearNode:false});
            const point=screen({x:config.position.x+40,y:config.position.y+50}); const mixed:ConnectionHandle={nodeId:config.id,handleType:"source",sourceNodeIds:[config.id,a.id]}; assert.equal(drop(point.clientX,point.clientY,mixed).nodeId,null,"a selected source is never a target");
            connect({nodeId:"missing",handleType:"source",sourceNodeIds:["missing",a.id]},config.id,point.clientX,point.clientY); assert(connections.some((edge)=>edge.fromNodeId===a.id&&edge.toNodeId===config.id));
        });
        await test("actual reverse table input3 start stays singular and preserves port on connect/create", () => {
            selectedNodeIdsRef.current=new Set([table.id,a.id]); const port=document.createElement("span"); port.dataset.nodeHandle=""; start(event(port),table.id,"target","input-3"); assert.equal(connecting!.sourceNodeIds,undefined); assert.deepEqual(connectionDragNodeIds(connecting!),[table.id]);
            const point=screen(a.position); connect(connecting!,a.id,point.clientX,point.clientY); assert(connections.some((edge)=>edge.fromNodeId===a.id&&edge.toNodeId===table.id&&edge.toPort==="input-3"));
            const before=nodesRef.current.length, prior=connecting!; create("dxos:table",{connection:prior,position:{x:2000,y:1200}}); assert.equal(nodesRef.current.length,before+1); const fresh=nodesRef.current.at(-1)!; assert(connections.some((edge)=>edge.fromNodeId===fresh.id&&edge.toNodeId===table.id&&edge.toPort==="input-3"),"new table must not clobber old table input3 to input1");
        });
        await test("actual empty-space creation makes exactly one shared target and no orphan on invalid batch", () => {
            const before=nodesRef.current.length, prior=connections.length; create("image",{connection:{nodeId:a.id,handleType:"source",sourceNodeIds:[a.id,b.id]},position:{x:2400,y:1600}}); assert.equal(nodesRef.current.length,before+1); const fresh=nodesRef.current.at(-1)!; const added=connections.slice(prior); assert.equal(added.length,2); assert(added.every((edge)=>edge.toNodeId===fresh.id)); assert.deepEqual(new Set(added.map((edge)=>edge.fromNodeId)),new Set([a.id,b.id])); assert.deepEqual([...selectedNodeIdsRef.current],[fresh.id]); assert.equal(dialog,fresh.id); assert.equal(pending,null); assert.equal(connecting,null);
            const beforeInvalid=nodesRef.current.length, edges=connections.length; create("group",{connection:{nodeId:a.id,handleType:"source",sourceNodeIds:[a.id,b.id]},position:{x:2600,y:1800}}); assert.equal(nodesRef.current.length,beforeInvalid); assert.equal(connections.length,edges); assert.equal(warnings.length,1);
            create("dxos:table",{connection:{nodeId:a.id,handleType:"source",sourceNodeIds:[a.id,b.id]},position:{x:2700,y:1900}}); const freshTable=nodesRef.current.at(-1)!; assert(connections.filter((edge)=>edge.toNodeId===freshTable.id).every((edge)=>edge.toPort==="input-1"));
        });
        await test("actual fusion patch input and batch preview remain independent from table ports", async () => {
            const handle:ConnectionHandle={nodeId:a.id,handleType:"source",sourceNodeIds:[a.id,b.id]}, point=screen({x:fusion.position.x+fusion.width,y:fusion.position.y+40}); const previous=connections.length; connect(handle,fusion.id,point.clientX,point.clientY); assert.equal(connections.length,previous+2); assert(connections.slice(previous).every((edge)=>edge.toPort==="patch")); assert.equal(drop(point.clientX,point.clientY,handle).nodeId,fusion.id);
            const Preview=compilePreview({React,connectingParams:handle,connectionDragNodeIds,ActiveConnectionPath,nodeById:new Map(nodesRef.current.map((node)=>[node.id,node])),mouseWorld:{x:fusion.position.x+fusion.width,y:fusion.position.y+40},connectionTargetNodeId:fusion.id}); await act(async()=>root.render(<Preview/>)); assert.equal(host.querySelectorAll("[data-connection-preview]").length,2); assert([...host.querySelectorAll("path")].every((path)=>path.getAttribute("d")!.endsWith(", 1560 490")));
        });
        console.log(`Multiconnect actual project callbacks: ${passed}/${passed} passed (AST-extracted production callbacks + actual JSX/React DOM, supplied layout/hit testing; no API)`);
    } finally { await act(async()=>root.unmount()); host.remove(); globalThis.fetch=originalFetch; }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
