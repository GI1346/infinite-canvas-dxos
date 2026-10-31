import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'blinkflow-canvas';
export const inject = ['tools', 'attachments'];
let bridge;
export function configureBridge(connection) {
  const url = new URL(connection.bridgeUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !connection.bridgeToken) throw new Error('画布连接无效');
  bridge = { url: new URL('/tool', url).href, token: connection.bridgeToken };
}
const ids = (description, required = true) => ({ type: 'array', items: { type: 'string' }, description, ...(required ? { required: true } : {}) });
const string = (description, required = false) => ({ type: 'string', description, ...(required ? { required: true } : {}) });
const object = (description, required = false) => ({ type: 'object', additionalProperties: true, description, ...(required ? { required: true } : {}) });
const number = (description) => ({ type: 'number', description });
const generationParameters = '合法键：imageAspectRatio（如9:16）、imageResolution（1k/2k/4k/auto）、size（宽x高）、quality、background、count、textCount、seconds、vquality、generateAudio、watermark、videoMode、reasoningEffort、tableBatchConcurrency、tableBatchStartRow、llmOutputMode、fusionColorMatch、audioVoice、audioFormat、audioSpeed、audioInstructions。size和比例不能冲突。';
const definitions = [
  ['read_configuration', '读取实时可用模型、节点类型与用户主动选中的引用，不返回整张画布的节点、连线或正文。只能对主动引用或本 Harness 创建、运行的节点使用 read_assets/read_results。', {}],
  ['read_assets', '只查看用户主动选中或本 Harness 创建、运行的节点正文、参数与图片视觉内容。未引用节点不可读取；图片返回官方持久化附件。', { nodeIds: ids('需要查看的节点 ID') }],
  ['read_results', '回读实际运行状态、产物、真实像素尺寸和错误。请求尺寸不等于产物尺寸。', { nodeIds: ids('需回读结果的节点 ID') }],
  ['apply_workflow', '创建节点与连线。文本正文放 prompt；生成模型必须逐字使用 read_configuration 的完整 ID。返回 key 到真实 ID 的映射，之后用真实 ID。nodes 可空以连接已有节点。新节点在当前可视画布居中布局。', {
    nodes: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      key: string('本次工作流内唯一临时 key', true), type: string('read_configuration 返回的已注册节点类型', true), title: string('节点标题'), prompt: string('文本节点正文或生成提示词'), model: string('真实完整渠道模型 ID'), mode: { type: 'string', enum: ['image', 'video', 'text', 'audio'] }, parameters: object(generationParameters),
    } } },
    connections: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { from: string('上游 key 或已有节点 ID', true), to: string('下游 key 或已有节点 ID', true), toPort: string('可选输入端口。融合完整原图不填，局部修改图填 patch') } } },
    sourceNodeIds: ids('将这些已有提示词文本节点连为新生成节点的上游', false),
  }],
  ['update_nodes', '更新指定节点的生成参数，不替换已有图片或提示词。首次生成前落实用户的比例和分辨率。', { nodeIds: ids('需修改的节点 ID'), parameters: object(generationParameters, true) }],
  ['edit_canvas', '编辑画布。update 用 nodes 修改节点；delete/copy/select/group/ungroup 用 nodeIds；grid 用 nodeIds/columns/gap；disconnect 用 connectionIds；viewport 用 x/y/zoom；extract_region 用原图 nodeIds 与原始像素 x/y/width/height/ratio；undo 撤销最近助手编辑。连接和新建用 apply_workflow。', {
    action: { type: 'string', required: true, enum: ['update', 'delete', 'copy', 'select', 'group', 'ungroup', 'grid', 'disconnect', 'viewport', 'extract_region', 'undo'] },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: string('真实节点 ID', true), title: string('标题'), x: number('画布横坐标'), y: number('画布纵坐标'), width: number('节点显示宽度，不是生成像素'), height: number('节点显示高度，不是生成像素'), text: string('仅文本节点正文'), prompt: string('生成提示词'), model: string('真实完整模型 ID'), parameters: object(generationParameters) } } },
    nodeIds: ids('操作对象，提取选区只传一个原图 ID', false), connectionIds: ids('断开的连线 ID', false), dx: number('复制水平位移'), dy: number('复制垂直位移'), columns: number('宫格列数'), gap: number('宫格间距'), x: number('横坐标，选区时为原图像素'), y: number('纵坐标，选区时为原图像素'), width: number('选区原图像素宽'), height: number('选区原图像素高'), zoom: number('画布缩放值'), ratio: string('选区宽高比'),
  }],
  ['run_nodes', '实际运行指定节点并等待真实产物。仅运行支持的生成节点、LLM、并发或融合节点。requirements 必须逐字传用户本轮尺寸和分辨率要求，系统在第一次请求前解析为真实像素。保留旧产物，不得为纠正尺寸擅自再次付费生成。', {
    nodeIds: ids('需运行的真实节点 ID'), requirements: string('用户原始尺寸/比例/分辨率要求，例如：一只小猫，2k，9:16'), model: string('可选生图模型，必须是 read_configuration.models 中的完整渠道模型 ID；明确覆盖窗口所选生图模型，仅对图片生成节点有效'), parameters: object(generationParameters), prompt: string('可选的本次生成提示词覆盖，不替代已连入的文本上下游'),
  }],
];

export function apply(ctx) {
  for (const [tool, description, parameters] of definitions) ctx.tools.register(defineTool({
    name: 'canvas_' + tool,
    description,
    parameters,
    output: { schema: { type: 'json' }, render: (_args, value) => [
      { type: 'text', text: JSON.stringify(value.value) },
      ...(value.images || []).flatMap((image) => [
        { type: 'text', text: '画布图片节点：' + image.nodeId },
        { type: 'image', attachment: image.attachment },
      ]),
    ] },
    // One canvas is shared with the original Agent and user edits; never overlap tool calls.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!bridge) throw new Error('请从 BlinkFlow 画布打开 DeepSeek Harness');
      const response = await fetch(bridge.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridge.token }, body: JSON.stringify({ tool, args }), signal: exec.signal });
      if (!response.ok) throw new Error('画布工具连接失败（HTTP ' + response.status + '）');
      const result = await response.json();
      if (result.error) throw new Error(String(result.error));
      if (!Object.hasOwn(result, 'value')) throw new Error('画布工具没有返回有效结果');
      const images = [];
      for (const image of result.images || []) {
        exec.signal.throwIfAborted();
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image.url);
        if (!match) throw new Error('画布图片不是受支持的内联图片');
        const attachment = await ctx.attachments.saveImage({ data: Buffer.from(match[2], 'base64'), mediaType: match[1], name: 'canvas-' + image.nodeId });
        images.push({ nodeId: image.nodeId, attachment });
      }
      return { value: result.value, ...(images.length ? { images } : {}) };
    },
  }));
}