/** Canvas call script for relay models advertising Chat Completions but not Responses. */
export const relayChatScript = `
if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
const response = await fetch(http.url("/chat/completions"), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey, Accept: "text/event-stream" },
  body: JSON.stringify({ model, messages, stream: true, ...(reasoningEffort && reasoningEffort !== "auto" ? { reasoning_effort: reasoningEffort } : {}) }),
  signal,
});
if (!response.ok) {
  const raw = await response.text();
  let detail = raw;
  try { const data = JSON.parse(raw); detail = data.error?.message || data.message || raw; } catch {}
  throw new Error(detail || "HTTP " + response.status);
}
const contentText = value => typeof value === "string" ? value : Array.isArray(value) ? value.map(part => part.text || "").join("") : "";
if (!response.headers.get("content-type")?.includes("text/event-stream")) {
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || String(data.error));
  const text = contentText(data.choices?.[0]?.message?.content);
  onDelta?.(text);
  return text;
}
if (!response.body) throw new Error("Chat Completions 未返回响应流");
const reader = response.body.getReader(), decoder = new TextDecoder();
let buffer = "", text = "", finished = false;
const consume = block => {
  const raw = block.split(/\\r?\\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\\n").trim();
  if (!raw) return;
  if (raw === "[DONE]") { finished = true; return; }
  const data = JSON.parse(raw);
  if (data.error) throw new Error(data.error.message || String(data.error));
  const delta = contentText(data.choices?.[0]?.delta?.content);
  if (delta) { text += delta; onDelta?.(text); }
};
try {
  while (!finished) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary;
    while (!finished && (boundary = buffer.match(/\\r?\\n\\r?\\n/))) {
      const index = boundary.index;
      consume(buffer.slice(0, index));
      buffer = buffer.slice(index + boundary[0].length);
    }
    if (done) { if (!finished && buffer.trim()) consume(buffer); break; }
  }
} finally { await reader.cancel().catch(() => {}); }
return text;
`;
