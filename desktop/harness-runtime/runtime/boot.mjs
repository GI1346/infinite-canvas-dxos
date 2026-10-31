import { writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { loadLayeredEnv, auditStartupEntries } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';
import { configureBridge } from './canvas-plugin.mjs';

let runtime, stopping = false;
const accountWatch = new AbortController();
async function stop() {
  stopping = true;
  accountWatch.abort();
  try { if (runtime) await runtime.shutdown.shutdown(0); }
  finally { if (process.connected) process.disconnect(); }
}
process.on('disconnect', () => { if (!stopping) void stop(); });
process.on('message', (message) => {
  if (message?.type === 'stop') return void stop();
  if (message?.type !== 'start' || runtime || stopping) return;
  void start(message).catch(async (error) => {
    if (process.connected) process.send({ type: 'error', message: String(error.message || error) });
    process.exitCode = 1;
    await stop();
  });
});

async function start(connection) {
  configureBridge(connection);
  const persona = `你是嵌入 BlinkFlow 的 DeepSeek Harness 画布助手。中文沟通，使用真正的 canvas_* 工具操控当前画布，而不是只输出规划或模拟成功。用户已授予完整画布操作权限；权限范围是画布，不是操作系统。保留原有 Agent。
没有读取或扫描整张画布的能力，不自动获取其他节点。需要可用模型与节点类型时用 canvas_read_configuration，返回的 selectedNodeIds 只代表用户主动选中的引用。只可用 canvas_read_assets/read_results 读取这些引用或本会话创建、运行的节点；没有引用的已有节点先请用户选择，不猜测或遍历ID。模型 ID 必须逐字使用返回值，包含渠道编码，不臆造模型、不跨渠道回退。窗口底部“画布生图模型”与官方对话模型互相独立；selectedImageModel 是用户选中的生图默认，创建和运行图片节点不指定 model 时系统使用该选择。用户本轮明确要求换模型时，先从 models 查找对应完整 ID，然后在 apply_workflow.nodes[].model 和对应 canvas_run_nodes.model 都明确传入同一个 ID；不要用默认值覆盖用户已选模型。没有对应能力模型时如实说明。
用 canvas_apply_workflow 创建文本、图片、视频、音频、LLM、多维表格、并发或融合等已注册节点以及连线。文本正文放 prompt。创建后使用返回的真实节点 ID。用户让已有文本/刚生成的提示词生图时，必须把对应文本节点连到图片生成节点，不能建孤立图片；sourceNodeIds 填对应真实文本 ID。用户所选图片从 selectedNodeIds 读取并连接为上游。新节点默认放当前视图中心。
用户明确的比例、分辨率、质量必须在第一次 canvas_run_nodes 前落到 parameters：imageAspectRatio 为如9:16，imageResolution 为1k/2k/4k/auto，精确像素用size如1152x2048；节点显示宽高不等于生成像素。canvas_run_nodes.requirements 逐字传本轮用户的尺寸要求。没有明确要求才沿用画布默认值。原始提示词和用户这次明确要求冲突时本轮要求优先。
只有 canvas_run_nodes 才真正生成；等待返回真实状态、真实产物节点 ID 和像素。必要时 canvas_read_results 检查，视觉用 canvas_read_assets。不把创建工作流当生成完成，不把请求尺寸当产物尺寸，不为修正尺寸擅自再次付费生成。
保留旧节点、生成结果及配置，用户明确要求才删除或覆盖。画布更新、复制、删除、选中、打组、宫格、选区、视图、撤销用 canvas_edit_canvas；融合节点type=blinkflow:fusion，完整原图连默认端口，局部修改图连toPort=patch，再运行融合。不要为融合节点选模型。工具失败如实说明，不编造成功。必要参数缺失先提一个明确问题。
用户仅要对话或提示词文字时正常回答，不强行建节点。执行过程简短，最终清楚说明结果，不要求用户手工执行你已有工具能完成的操作。`;
  const patch = [
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: false } },
    { id: 'agent-preset-registry', config: { default: 'blinkflow' } },
    { insert: [{ id: 'blinkflow-canvas-ui', name: new URL('./canvas-ui/index.mjs', import.meta.url).href }] },
    { insert: [{ id: 'preset-blinkflow', name: '@deepseek-ai/dsh-agent-preset', config: {
      id: 'blinkflow', name: 'BlinkFlow 画布', description: '完整画布操作、节点和连线、选区融合、真实尺寸生图', order: 0,
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: persona, includeRuntimeContext: false } },
        { id: 'blinkflow-canvas', name: new URL('./canvas-plugin.mjs', import.meta.url).href },
        { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [
          { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
          { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
          { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
        ] },
        { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      ],
    } }] },
  ];
  const patchFile = join(process.env.DSH_HOME, 'blinkflow.patch.yml');
  const temporary = patchFile + '.tmp';
  await writeFile(temporary, JSON.stringify(patch, null, 2) + '\n', 'utf8');
  await rename(temporary, patchFile);
  if (stopping || !process.connected) return;
  runtime = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web', patchFiles: [patchFile], args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] });
  if (stopping || !process.connected) return stop();
  await runtime.ctx.get('loader')?.await();
  await auditStartupEntries(runtime.ctx, 'BlinkFlow Harness');
  const web = runtime.ctx.get('webServer');
  const connectionService = runtime.ctx.get('connection');
  if (!web || !connectionService) throw new Error('Harness Web 服务未就绪');
  const preset = await runtime.ctx.get('agentPresets')?.resolve('blinkflow');
  if (!preset || preset.broken) throw new Error('BlinkFlow 画布工具预设未就绪');
  // Official browser login preopens about:blank; Electron denies that popup. Watch only
  // credential-free account snapshots and ask the desktop to open the official URL.
  const account = runtime.ctx.get('deepseekAccount');
  if (account) void (async () => {
    let openedAttempt;
    try {
      for await (const state of account.watch(accountWatch.signal)) {
        const attempt = state.attempt;
        if (attempt?.phase !== 'waiting-browser' || !attempt.authorizeUrl || attempt.id === openedAttempt || !process.connected) continue;
        openedAttempt = attempt.id;
        process.send({ type: 'openExternal', url: attempt.authorizeUrl });
      }
    } catch (error) {
      if (!accountWatch.signal.aborted) console.error('DeepSeek 登录状态连接已断开：' + String(error.message || error));
    }
  })();
  process.send({ type: 'ready', url: connectionService.authenticatedUrl(web.getOrigin()) });
}