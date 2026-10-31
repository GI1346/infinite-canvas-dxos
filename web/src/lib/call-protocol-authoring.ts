import type { CallCapability } from "@/lib/canvas-call-protocol";
import { getPluginTemplates } from "@/services/api/model-plugin";

// Mirrors runModelPlugin and its four native callers, not a declarative DX executor.
export function getCallProtocolAuthoringPrompt(capability: CallCapability) {
    const example = { format: "canvas-protocol-bundle/v1", protocols: [{ format: "canvas-call/v1", id: `my-${capability}-relay`, label: `我的${({ image: "图像", video: "视频", text: "文本", audio: "音频" })[capability]}协议`, capability, script: getPluginTemplates()[capability][0].script }] };
    return `你正在为 BlinkFlow 无限画布的「协议中心」编写可直接导入、绑定模型并执行的调用协议。请根据我随后提供的官方 API 文档生成完整协议，不照搬 DX OS，也不要写一个只有结构没有执行代码的空架子。

一、输出与导入格式
只输出一个合法 JSON 对象，不要 Markdown、注释或解释。统一输出 {"format":"canvas-protocol-bundle/v1","protocols":[...]}；每条协议必须且只需这五项：{"format":"canvas-call/v1","id":"自定义小写id","label":"中文名称","capability":"${capability}","script":"完整可运行的 JavaScript 异步函数体"}。
id 使用小写字母/数字/横线/下划线，首字符为字母或数字，包内不重复。当前选中能力为 ${capability}；除非我明确要求多个能力，只生成该能力。不同 endpoint 或参数/响应结构拆成独立协议；共用协议时脚本必须根据真实 model 正确分支。
本画布没有 provider/models、operations、workflows、modelProfiles、uiSchemas、declarative executor 或 {{变量}} 模板引擎，禁止输出这些 DX 专用结构。Base URL、API Key、模型名及模型能力仍在「渠道」配置；导入不会新建渠道、自动拉取/添加模型或自动绑定，保存后在渠道默认协议或模型行绑定。协议内不得写入真实地址、密钥或用户数据。

二、实际执行环境
script 由浏览器以 async 函数体执行，可以 await，必须 return 最终结果，不能输出 ES 模块、import/require、Node/Shell 或伪代码。JSON 中换行/引号必须正确转义，不使用 TODO、占位接口、空数组/空字符串冒充成功。
运行时实际注入的变量只有：prompt, images, videos, audios, messages, params, model, baseUrl, apiKey, systemPrompt, reasoningEffort, http, request, poll, sleep, signal, onDelta。model/baseUrl/apiKey 是当前所选渠道与模型已经解析后的值，不能从别的渠道补 Key。
- prompt:string：图像/视频的生成描述，音频为待合成文本。图像 prompt 已合并系统要求，不重复添加 systemPrompt。
- images:string[]：图片/视频参考图的 data URL，文生图为空数组；保持输入顺序，不只处理第一张。
- videos:File[]、audios:File[]：仅视频能力提供的参考素材。
- messages：文本能力提供的完整消息数组，role 为 system/user/assistant，content 为字符串或 [{type:"text",text},{type:"image_url",image_url:{url}}]。保留顺序、system、assistant和图片；根据目标 API 精确转换，不把多模态数组转成字符串。Agent 的动作和工具结果由画布以普通消息传入，不注入 tools/tool_choice；不要承诺原生 tool_calls、独立 reasoning 事件或任意 params.messages。
- params 只提供以下已有字段，不会因为在协议声明自定义参数或 UI 而自动出现：
  image：size（如2048x2048/1152x2048，自动时为undefined）、resolution（1k/2k/4k/auto）、quality（low/medium/high/xhigh/max 或未指定）、count:number、background（请求透明时为transparent，其他情况缺省）。图像没有 params.aspect_ratio，需从 size 换算文档支持的比例或直接传像素；不从 images 尺寸覆盖明确的输出尺寸。
  video：seconds:string、size:string像素或null（自动）、resolution:string（如720p）、ratio:string、generateAudio:boolean、watermark:boolean、mode（frames/reference）。frames 时首/尾帧分别为 images[0]/images[1]；reference 保留全部素材。
  audio：voice:string（当前界面为OpenAI音色名，如alloy）、format:string、speed:string、instructions:string。不同服务商的音色枚举不通用，必须按目标文档映射或在脚本中明确指定其支持的音色，不能把alloy等直接传给Gemini；示例Gemini模板明确使用Kore，不声称界面音色已自动转换。
  text：params 为空对象，messages 单独注入；reasoningEffort 单独注入，auto 表示不强制推理档位。不要猜出 temperature/max_tokens 等界面未提供的参数。
- signal:AbortSignal 用于取消；sleep(ms) 自动响应取消；onDelta 仅文本能力可能提供，用 onDelta?.(text) 推送正文，仍须 return 完整正文。

三、HTTP 与 URL 的真实约定
request({method,url,headers,data,params,responseType,...}) 使用 Axios 并返回响应正文，不是 Response，不需要再 .json()，不要取不存在的 response.data 包裹。只有 API 自己的正文 data 字段才读 result.data。它自动使用当前 signal 和本地代理，但不会自动附加鉴权；必须按文档由 apiKey 生成 Bearer、x-api-key、x-goog-api-key 或其他要求。
request 的绝对 http(s) URL 不增加 /v1。推荐先规范 baseUrl，再拼文档中的完整路径；相对 URL 和 http.get/post 会经本画布 buildApiUrl：Base URL 若未以 /v1 结尾会自动追加 /v1，再拼路径。因此相对 /v1/xxx 将重复版本号，非 /v1 API 不可直接用相对路径。
例如仅对于文档确认使用 /v1 的接口，可用 const root=baseUrl.trim().replace(/\\/+$/,"").replace(/\\/v1$/i,""); 再 request({url:root+"/v1/文档真实路径",...})。非标准前缀（如/api/paas/v4）按文档确定 Base URL 的填写范围，不盲目剥除任意路径；绝对 URL 仍必须从 baseUrl 构建，不能硬编码另一站点。
http.get(path,options) 与 http.post(path,body,options) 也返回正文，默认附 Bearer apiKey，options 支持 headers/params/responseType。非 Bearer 鉴权优先 request，避免多带 Bearer。
JSON body 放 data；文件按官方字段用 FormData。参考图可 await (await fetch(dataUrl)).blob() 再 append；不要在 multipart 手写 Content-Type/boundary。二进制用 responseType:"blob"，而非把视频/音频 JSON 当媒体。
现有 helper 不解析 SSE 事件；普通对话优先 stream:false。只有官方文档要求且脚本完整实现解析时才处理 SSE 文本，不能宣称 responseMode:"sse" 自动生效。不要在脚本里直接 fetch 远程接口绕过现有代理和取消；fetch 仅用于本地 data URL 转 Blob 等操作。

四、最终返回值（必须精确符合消费端）
image：返回非空图片 URL/data URL 数组，或数组项 {url:string}/{dataUrl:string}/{b64_json:string}；单项也可。不能返回 {data:[...]} 整个服务商 envelope、任务ID或 Blob；b64_json 约定PNG，其他编码须构成带正确 MIME 的data URL。
video：返回真实可播放 URL 字符串、{url:string}/{video_url:string}/{result_url:string}，或视频 Blob/{blob:Blob}。不能只返回taskId/status。
audio：返回音频 Blob，或 URL/data URL/纯base64字符串，或 {url:string}/{data:string}/{b64_json:string}；非URL的base64按 params.format 解码，必须保证编码与格式对应；不要把PCM冒充MP3，已带正确MIME的可播放Blob优先。
text：返回非空最终正文字符串；先从真实响应字段提取，保留 Agent 要求的 JSON 正文，不 JSON.stringify 整个服务商响应，不只返回思考过程。Responses API 的输入需把 text/image_url 转为 input_text/input_image，输出需从 output_text 或 message 内容中提取；Chat Completions 则依文档使用 messages 和 choices。
所有能力遇到业务失败或缺少有效结果应 throw new Error(有意义的错误)，不能吞错或返回空结果。

五、异步任务与边界
只用官方文档提供的提交、状态查询、下载/上传端点。提交一次后保存真实任务ID，完整处理pending/success/failure及业务错误；服务端已返回最终产物时直接解析，不再次提交。
可 await poll(()=>request(...), state=>{...},options)。extract 返回 null/undefined/false 表示继续查询，返回其他值（包括空数组）都会结束，故成功前必须验证结果非空；失败态必须 throw。现有默认 intervalMs=2500、timeoutMs=300000（五分钟），不自创重试、超时和并发边界；文档未规定时沿用默认并说明其适用性，变更边界需先向用户确认。
自定义脚本的异步查询只在当前调用生命周期内执行；视频脚本完成结果暂存在内存。当前格式没有持久化任务ID/刷新后续查钩子，不能声称自动加入原生异步任务续查。遇到超时如实抛错，不自动重新付费提交。

六、按官方文档核对后再输出
先核实鉴权、真实模型ID、每类素材/参数、size与resolution映射、输出MIME、查询状态及返回字段。只实现文档已证实且当前输入能提供的能力；不猜/models、端点、认证、重试或未暴露的UI字段。若缺少影响可运行性的必要文档，指出缺失项并询问，不编造协议来冒充完成。
下面是与当前运行时匹配的可导入${capability}示例，仅演示现有OpenAI兼容接口；不是待接站点的事实，必须根据接下来提供的官方文档改写接口/字段/响应解析：
${JSON.stringify(example, null, 2)}

最终自检：JSON可解析、每条id唯一且能力匹配、script包含完整请求及return、所有注入变量真实存在、所有参考图顺序保留、地址不会重复/v1、鉴权取当前apiKey、异步提交只有一次、错误非空返回、无真实密钥。校验按钮只检查格式和脚本语法，不代表网络/付费调用验证。最终返回完整组合包。`;
}
