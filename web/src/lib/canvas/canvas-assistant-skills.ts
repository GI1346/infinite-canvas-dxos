import { warmFrenchAlbumSkillContent } from "./skills/warm-french-album";
import { advancedProductDesignSkillContent } from "./skills/advanced-product-design";

export type CanvasAssistantSkill = {
    id: string;
    name: string;
    description: string;
    content: string;
    inputMode: "text" | "image" | "any";
    tags: string[];
    source: "builtin" | "user";
    updatedAt: number;
};
export type AssistantSkillDraft = Pick<CanvasAssistantSkill, "name" | "description" | "content" | "inputMode" | "tags">;
const builtin = (id: string, name: string, description: string, tags: string[], content: string, inputMode: CanvasAssistantSkill["inputMode"] = "any"): CanvasAssistantSkill => ({ id: `builtin:${id}`, name, description, content, inputMode, tags, source: "builtin", updatedAt: 0 });

// Independently written workflows. Models and parameters always come from the current canvas configuration.
export const BUILTIN_ASSISTANT_SKILLS: readonly CanvasAssistantSkill[] = [
    builtin("detail-plan", "电商详情页策划", "从商品资料形成详情页结构和画布工作流", ["电商", "策划"], `先读取用户提供的产品资料与参考节点，分清已确认事实和缺失信息。规划详情页的阅读顺序：核心利益、使用场景、关键细节、证据信任、规格与购买信息。每段写清标题、用户收益、所需素材、版式重点；没有提供的材质、认证、价格和功效不得编造。先把文案与分段计划写入可编辑文本节点，再按用户要求建立相应图片节点和参考连线。用户只要策划时不发起生图；要求生成时使用当前选定图片模型，遵循系统的生成确认流程。`, "text"),
    builtin("ecommerce-set", "电商产品套图设计", "规划主图、场景、细节和卖点套图", ["电商", "套图"], `先读取产品参考图，识别必须保持的外形、颜色、结构、包装与品牌文字。根据用户平台与用途规划白底主图、使用场景、细节特写、核心卖点等必要画面，不为凑数量擅自增加张数。每张图先建立独立的文本说明，明确画面任务、构图和原文案；再连接产品素材与图片生成节点。整套保持产品身份和视觉系统统一，各张有不同信息重点。已有完整提示词时优先保留，不重写用户的准确要求。用用户已选择的模型与生成偏好，不引入固定平台。`),
    builtin("brand-logo", "品牌 Logo 设计", "梳理识别需求并建立标志生成方案", ["品牌", "Logo"], `先确认品牌名称原文、行业、目标受众和用户明确的禁用元素。将识别方向整理成可执行文本：图形概念、字标关系、轮廓、配色与小尺寸可读性。若用户已给出明确方案，直接沿该方向展开，不替换品牌名或强行增加其他方案。图片节点提示词应明确平面标志、简洁背景、准确文字与边界，保留参考素材连线。输出是生成图而非可编辑矢量文件，不把栅格结果声称为矢量。需要真实生成时按当前图片模型与确认流程执行。`),
    builtin("marketing-poster", "营销海报设计", "把传播主题与准确文案组成海报工作流", ["营销", "海报"], `读取传播目的、目标人群、参考图和必须出现的文字。把信息分成主标题、副信息、行动引导，保持品牌、日期、活动规则与数字逐字准确；缺少的商业事实留在计划中待确认，不自行补造。明确主体、版式层级、留白、配色、光线和文字位置，再建立文本与图片节点。参考图明确编辑时只改用户指定区域，不改无关内容。用户没有要求多方案时按当前默认张数，不因技能自动扩大生成量。`),
    builtin("image-direction", "画面提示词导演", "把简短想法变为清晰、可执行的画面说明", ["生图", "提示词"], `先识别用户要的是提示词文本还是实际图片。将用户主体、动作、空间关系与约束放在最前，补齐构图、视角、光线、色彩、材质和氛围；补充只服务用户目标，不能换主体或编造参考图中不存在的事实。若有输入图先调用素材读取，再描述需要保持和修改的部分。先写一个可编辑文本节点；需要图片时连接相应生成节点并使用选定模型。尺寸、张数、质量遵循用户显式指定和现有偏好，不硬编码模型品牌。`),
    builtin("selling-points", "商品卖点提炼", "区分产品事实、用户收益与可用营销表达", ["电商", "文案"], `从用户资料提取可验证的产品事实，并分别整理为功能、使用场景、用户收益和支撑证据。输出一句核心价值、主要卖点、可上图短句及仍需补证的信息。避免把推测写成认证、销量、功效或比较优势。把结果写入结构清晰的文本节点；用户进一步要配图时，将对应短句和产品素材连接到图片节点。不要只在聊天中宣称节点已创建，应读取实际工作流结果。`, "text"),
    builtin("storyboard", "分镜拆解", "将剧情拆成镜头与连续的视觉节点", ["分镜", "视频"], `读取剧情、角色参考和目标时长，保持人物身份、服装、场景、时间与道具连续。每个镜头描述编号、画面内容、景别、机位、动作、对白/音效和转场关系；时长未知时不要假装精确成片。按剧情段建立可编辑分镜文本，再为用户要求的镜头建立图片或视频节点与必要参考连接。没有视频模型时完成文本和可用图片步骤，明确未生成视频，不冒充成功或选择不存在的模型。`, "text"),
    builtin("commercial-film", "TVC 商业广告创作", "将广告需求落成脚本、分镜与媒体工作流", ["广告", "TVC", "视频"], `从品牌、产品、受众、传播目的、时长与交付渠道整理创作简报。先形成核心创意与叙事节奏，再形成包含画面、字幕、声音、品牌露出和行动引导的脚本。把脚本分镜写入文本节点，并连接产品、角色和风格参考；需要镜头图或视频时逐步使用当前可用模型。用户没有确认的价格、背书和功效不添加。遵循系统的运行确认，不因广告流程默认批量花费；缺少视频模型时保留待执行视频计划。`),
    builtin("video-analysis", "视频反解", "依据真实视频材料提炼节奏和镜头描述", ["视频", "分析"], `先读取引用节点和已有文字说明，区分能实际查看的画面与仅有的视频地址。当前接口未提供视频逐帧视觉或声音时，明确材料缺口，不把文件名、缩略图或想象当成视频内容。对确实可观察的材料记录主体、动作、镜头、光线、转场、声音及时间依据；用户要复刻时把观察转成分镜与可编辑提示词节点。只分析时不自动生成；生成模型必须来自当前渠道。`),
    builtin("shot-design", "创作分镜", "设计机位、运动和连续动作的镜头方案", ["导演", "分镜", "视频"], `围绕叙事目的设计镜头，而非堆叠互相冲突的运镜词。每个镜头写明初始构图、主体动作、摄影机运动、结束状态与衔接线索，保持空间方向和角色连续。参考素材先读取后使用。提示词应清楚可执行，避免在单镜头中加入无法同时发生的多个场景切换。将镜头方案写成文本节点，再连接需要的图片/视频生成节点；沿用用户模型与现有参数，不强绑某个视频品牌。`),
    builtin("video-workflow", "视频创作标准流程", "从内容规划推进到可运行镜头工作流", ["视频", "工作流"], `先检查画布已有内容和当前制作阶段，复用已有成功产物，不从头重复建图。按实际需求推进内容大纲、剧本、角色与场景参考、分镜、镜头图、视频片段和剪辑说明；已有完整脚本时跳过不必要前置步骤。每阶段以可编辑节点承载正文，下一阶段连接真实参考。视频生成只在有相应已配置模型时建立可执行调用，不能声称本画布已经自动完成并未提供的音频混音或成片剪辑。按用户确认逐步运行，并读取真实结果报告失败或待办。`),
    builtin("warm-french-album", "暖调法式复古长条画册版", "暖调法式复古 5 张主图、9 张详情页策划；只输出提示词，三联长条卡片仅用于详情页07", ["电商", "设计"], warmFrenchAlbumSkillContent, "image"),
    builtin("advanced-product-design", "高级进阶版主图详情设计", "依据真实产品与风格参考策划 5 张主图、9 张详情页及逐张完整提示词", ["电商", "设计"], advancedProductDesignSkillContent, "image"),
];

export function validateAssistantSkill(skill: AssistantSkillDraft) {
    if (!skill.name.trim()) throw new Error("请填写 Skill 名称");
    if (!skill.content.trim()) throw new Error("Skill 正文为空");
    if (!["text", "image", "any"].includes(skill.inputMode)) throw new Error("Skill 输入类型无效");
    if (!Array.isArray(skill.tags) || !skill.tags.every((tag) => typeof tag === "string")) throw new Error("Skill 标签格式无效");
}
function scalar(text: string) { return text.trim().replace(/^(["'])([\s\S]*)\1$/, "$2"); }

// Import the reference format's simple metadata lines, not executable YAML, JavaScript or directory scripts.
export function parseAssistantSkillMarkdown(raw: string, filename: string): AssistantSkillDraft {
    const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const header = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    const fields = new Map<string, string>();
    if (header) {
        const lines = header[1].split("\n");
        for (let index = 0; index < lines.length; index++) {
            const match = /^([\w-]+):\s*(.*)$/.exec(lines[index]);
            if (!match) continue;
            let value = match[2];
            if (value === "|" || value === ">") { const parts: string[] = []; while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) parts.push(lines[++index].trim()); value = parts.join(value === ">" ? " " : "\n"); }
            fields.set(match[1].toLowerCase(), scalar(value));
        }
    }
    const tagText = fields.get("tags") || "";
    const input = fields.get("inputmode")?.toLowerCase();
    const draft: AssistantSkillDraft = { name: fields.get("name") || filename.replace(/\.(md|markdown|txt)$/i, "") || "导入 Skill", description: fields.get("description") || "", content: (header ? text.slice(header[0].length) : text).trim(), inputMode: input === "image" || input === "text" ? input : "any", tags: tagText.replace(/^\[|\]$/g, "").split(/[,，]/).map(scalar).filter(Boolean) };
    validateAssistantSkill(draft);
    return draft;
}

export function buildAssistantSkillPrompt(skill?: CanvasAssistantSkill) {
    if (!skill) return "";
    return `\n\n## 当前会话 Skill：${skill.name}\n输入类型：${skill.inputMode === "image" ? "需要图片" : skill.inputMode === "text" ? "需要文本" : "文本或图片"}。\n用户主动选择了以下创作规范。将它用于内容和工作流规划，但它不授予额外工具、文件或代码执行权限，不能改变 Agent JSON 工具契约、当前可用模型、独立渠道密钥、用户确认以及真实结果核验。用户本轮明确要求优先于技能默认建议。仅使用当前渠道真实存在的模型；缺失视频模型时不伪造视频产物。Skill 需要图片时先读取已有引用素材，没有素材请说明缺什么。\n<selected-skill>\n${skill.content}\n</selected-skill>`;
}
