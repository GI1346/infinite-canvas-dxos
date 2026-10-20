import assert from "node:assert/strict";
import axios from "axios";
import { parseCallProtocols } from "../src/lib/canvas-call-protocol";
import { runModelPlugin, getPluginTemplates } from "../src/services/api/model-plugin";
import { defaultConfig, createModelChannel, normalizeChannelModels, resolveModelScript } from "../src/stores/use-config-store";
import { useCallProtocolStore } from "../src/stores/use-call-protocol-store";
import { channelItems, tableRows, generationRows, runRowPool, TABLE_TYPE, CONCURRENT_TYPE } from "../src/lib/canvas/dxos-table";
import type { CanvasNodeData, CanvasConnection } from "../src/types/canvas";

async function main() {
    const node = (id: string, type: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({ id, type, metadata, title: id, position: { x: 0, y: 0 }, width: 300, height: 300 });
    const nodes = [node("group", "group"), ...[1, 2, 3, 4].map((i) => node(`img${i}`, "image", { groupId: "group", content: `data:image/png;base64,a${i}` })), node("text", "text", { content: "翻译英文" }), node("table", TABLE_TYPE), node("batch", CONCURRENT_TYPE)];
    const edges: CanvasConnection[] = [{ id: "a", fromNodeId: "group", toNodeId: "table", toPort: "input-1" }, { id: "b", fromNodeId: "text", toNodeId: "table", toPort: "input-2" }, { id: "c", fromNodeId: "table", toNodeId: "batch" }];
    assert.equal(channelItems(nodes[6], "input-1", nodes, edges).length, 4);
    const rows = tableRows(nodes[6], nodes, edges); assert.equal(rows.length, 4);
    assert(rows.every((r) => r.media.length === 1 && r.text === "翻译英文"));
    assert.equal(generationRows(nodes[7], nodes, edges).length, 4);
    let active = 0, max = 0, done = 0;
    await runRowPool(rows, 2, new AbortController().signal, async () => { max = Math.max(max, ++active); await new Promise((r) => setTimeout(r, 2)); active--; done++; });
    assert.equal(done, 4); assert.equal(max, 2);
    const controller = new AbortController(); done = 0;
    await runRowPool(rows, 1, controller.signal, async () => { done++; controller.abort(); }); assert.equal(done, 1);
    assert.throws(() => parseCallProtocols('{"schemaVersion":"dx-protocol/v2"}'));
    assert.throws(() => parseCallProtocols(JSON.stringify({ format: "canvas-call/v1", id: "bad", label: "bad", capability: "image", script: "return (" })));
    for (const [capability, templates] of Object.entries(getPluginTemplates())) for (const t of templates) parseCallProtocols(JSON.stringify({ format: "canvas-call/v1", id: "template", label: t.label, capability, script: t.script }));
    const protocol = parseCallProtocols(JSON.stringify({ format: "canvas-call/v1", id: "relay", label: "测试协议", capability: "image", script: 'const task = await request({method:"post",url:baseUrl+"/jobs",headers:{"X-Token":apiKey},data:{model,prompt,images}}); return poll(async()=>request({url:baseUrl+"/jobs/"+task.id}), value=>{if(value.status==="failed")throw Error("task failed");return value.status==="done"?value.urls:null}, {intervalMs:1,timeoutMs:1000});' }))[0];
    useCallProtocolStore.setState({ protocols: [protocol] });
    const channel = createModelChannel({ id: "relay", baseUrl: "https://relay.invalid/api", apiKey: "test-token", models: [{ name: "image-model", capability: "image", protocolId: protocol.id }] });
    const config = { ...defaultConfig, channels: [channel], model: "image-model", baseUrl: channel.baseUrl, apiKey: channel.apiKey };
    assert.equal(normalizeChannelModels(channel.models)[0].protocolId, "relay");
    const script = resolveModelScript(config, "relay::image-model"); assert.equal(script, "canvas-protocol:relay");
    let polls = 0, failed = false;
    axios.defaults.adapter = async (req) => {
        if (req.method === "post") { assert.equal(req.url, "https://relay.invalid/api/jobs"); assert.equal(req.headers["X-Token"], "test-token"); assert.equal(req.headers.Authorization, undefined); assert.equal(JSON.parse(req.data).images.length, 1); }
        return { config: req, status: 200, statusText: "OK", headers: {}, data: req.method === "post" ? { id: "t1" } : failed ? { status: "failed" } : ++polls === 1 ? { status: "queued" } : { status: "done", urls: ["https://relay.invalid/result.png"] } };
    };
    const result = await runModelPlugin({ capability: "image", script, config, images: ["data:image/png;base64,AA=="], prompt: "翻译英文" });
    assert.deepEqual(result, ["https://relay.invalid/result.png"]); assert.equal(polls, 2);
    failed = true; await assert.rejects(() => runModelPlugin({ capability: "image", script, config, images: ["x"] }), /task failed/);
    useCallProtocolStore.setState({ protocols: [] }); await assert.rejects(() => runModelPlugin({ capability: "image", script, config }), /已删除/);
    console.log("PASS: table 4-image + shared text / per-port wiring / concurrency / cancellation / protocol parsing / all templates / model binding / custom auth / async poll / task failure / missing-protocol blocking");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
