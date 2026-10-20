import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import localforage from "localforage";
import axios from "axios";
import { ConfigProtocolCenter } from "../src/components/layout/config-protocol-center";
import { useCallProtocolStore } from "../src/stores/use-call-protocol-store";
import { defaultConfig, resolveModelScript, useConfigStore } from "../src/stores/use-config-store";
import type { CanvasCallProtocol } from "../src/lib/canvas-call-protocol";

Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }), configurable: true });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Object.defineProperty(globalThis, "ShadowRoot", { value: window.ShadowRoot, configurable: true });
Object.defineProperty(globalThis, "SVGElement", { value: window.SVGElement, configurable: true });
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function click(target: HTMLElement) { await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); await tick(); }); }
async function value(target: HTMLInputElement | HTMLTextAreaElement, next: string) {
    Object.getOwnPropertyDescriptor(target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(target, next);
    await act(async () => { target.dispatchEvent(new Event("input", { bubbles: true })); await tick(); });
}
const button = (host: HTMLElement, text: string) => { const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.replace(/\s/g, "") === text.replace(/\s/g, "")); assert.ok(found, text); return found; };
const input = (host: HTMLElement, label: string) => { const found = host.querySelector(`[aria-label="${label}"]`); assert.ok(found, label); return found as HTMLInputElement; };

async function main() {
    await useCallProtocolStore.persist.rehydrate();
    const original: CanvasCallProtocol = { format: "canvas-call/v1", id: "stable-relay", label: "原始名称", capability: "image", script: "return [];" };
    const other: CanvasCallProtocol = { ...original, id: "text-relay", label: "对话协议", capability: "text" };
    const config = { ...defaultConfig, imageModel: "image::image-model", channels: [{ id: "image", name: "image", baseUrl: "https://image.invalid", apiKey: "image-test-not-a-secret", apiFormat: "openai" as const, models: [{ name: "image-model", capability: "image" as const, protocolId: original.id }] }] };
    useConfigStore.setState({ config });
    const configBefore = JSON.stringify(useConfigStore.getState().config), keyBefore = localStorage.getItem("infinite-canvas:ai_config_store");
    useCallProtocolStore.setState({ protocols: [original, other] });
    let requests = 0;
    axios.defaults.adapter = async () => { requests++; throw new Error("协议编辑不得请求网络"); };
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<ConfigProvider theme={{ token: { motion: false } }}><App message={{ duration: 0 }}><ConfigProtocolCenter /></App></ConfigProvider>); await tick(); });

    await click(button(host, "原始名称 · image"));
    assert.equal(input(host, "协议名称").value, original.label);
    assert.equal(JSON.parse(input(host, "自定义协议 JSON").value).id, original.id);
    await value(input(host, "自定义协议 JSON"), JSON.stringify({ ...original, script: "throw Error('unsaved');" }));
    await value(input(host, "协议名称"), "  我的生图协议  ");
    await click(button(host, "重命名"));
    assert.deepEqual(useCallProtocolStore.getState().protocols.find((p) => p.id === original.id), { ...original, label: "我的生图协议" });
    assert.ok(button(host, "我的生图协议 · image"));
    assert.equal(JSON.parse(input(host, "自定义协议 JSON").value).label, "我的生图协议");
    assert.equal(resolveModelScript(useConfigStore.getState().config, "image::image-model"), "canvas-protocol:stable-relay");
    console.log("PASS 已有协议名称显式加载 / 重命名更新列表与 JSON / ID、脚本与模型绑定保持稳定");

    await value(input(host, "协议名称"), "   ");
    await click(button(host, "重命名"));
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /请填写协议名称/);
    assert.equal(useCallProtocolStore.getState().protocols.find((p) => p.id === original.id)!.label, "我的生图协议");
    await value(input(host, "协议名称"), "保存按钮改名");
    await click(button(host, "保存协议"));
    assert.ok(button(host, "保存按钮改名 · image"));
    console.log("PASS 空白名称被阻止 / 保存协议同样可改名");

    await value(input(host, "自定义协议 JSON"), JSON.stringify({ ...original, id: "unexpected-new-id", label: "意外改 ID" }));
    await click(button(host, "保存协议"));
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /保留原 ID/);
    assert.equal(useCallProtocolStore.getState().protocols.length, 2);
    assert.equal(useCallProtocolStore.getState().protocols.some((p) => p.id === "unexpected-new-id"), false);
    await click(button(host, "对话协议 · text"));
    assert.equal(input(host, "协议名称").value, other.label);
    await click(button(host, "保存按钮改名 · image"));
    assert.equal(input(host, "协议名称").value, "保存按钮改名");
    await click(button(host, "删除"));
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /仍被渠道或模型使用/);
    console.log("PASS 编辑已有协议禁止意外更换 ID / 切换协议回显保存名称 / 已绑定删除保护不变");

    await click(button(host, "新建协议"));
    assert.equal(input(host, "协议名称").value, "");
    assert.equal(input(host, "自定义协议 JSON").value, "");
    const created = { ...original, id: "new-relay", label: "JSON 中的名称" };
    await value(input(host, "自定义协议 JSON"), JSON.stringify(created));
    assert.equal(input(host, "协议名称").value, created.label);
    await value(input(host, "协议名称"), "新建时自定义名称");
    await click(button(host, "保存协议"));
    assert.deepEqual(useCallProtocolStore.getState().protocols.find((p) => p.id === created.id), { ...created, label: "新建时自定义名称" });
    const db = localforage.createInstance({ name: "infinite-canvas", storeName: "call_protocols" });
    const stored = JSON.parse((await db.getItem<string>("canvas-call-protocols-v1"))!);
    assert.equal(stored.state.protocols.find((p: CanvasCallProtocol) => p.id === original.id).label, "保存按钮改名");
    assert.equal(stored.state.protocols.find((p: CanvasCallProtocol) => p.id === created.id).label, "新建时自定义名称");
    assert.equal(JSON.stringify(useConfigStore.getState().config), configBefore);
    assert.equal(localStorage.getItem("infinite-canvas:ai_config_store"), keyBefore);
    assert.equal(requests, 0);
    console.log("PASS 新建 JSON 自动带入名称 / 自定义名称持久化 / 渠道 API Key 和配置不变 / 不发出网络请求");
    await act(async () => useConfigStore.setState({ config: { ...config, channels: [{ ...config.channels[0], protocolId: other.id }] } }));
    await click(button(host, "对话协议 · text"));
    await click(button(host, "删除"));
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /仍被渠道或模型使用/);
    assert(useCallProtocolStore.getState().protocols.some((p) => p.id === other.id));
    console.log("PASS 渠道默认协议绑定同样阻止删除");
    await act(async () => root.unmount()); host.remove();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
