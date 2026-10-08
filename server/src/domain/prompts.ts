import type { ContentLevel, PromptDto } from "../../../shared/protocol.js";

const LEVEL_RANK: Record<ContentLevel, number> = { mild: 0, spicy: 1, wild: 2 };

export function levelsAtOrBelow(level: ContentLevel): ContentLevel[] {
  const max = LEVEL_RANK[level];
  return (Object.keys(LEVEL_RANK) as ContentLevel[]).filter((item) => LEVEL_RANK[item] <= max);
}

export function eligiblePrompts(
  catalog: PromptDto[],
  kind: PromptDto["kind"],
  level: ContentLevel,
  allowAdult: boolean,
  recentIds: string[],
): PromptDto[] {
  const levels = new Set(levelsAtOrBelow(level));
  const recent = new Set(recentIds);
  const matches = (prompt: PromptDto, ignoreRecent: boolean) =>
    prompt.kind === kind &&
    levels.has(prompt.level) &&
    (allowAdult || !prompt.adult) &&
    (ignoreRecent || !recent.has(prompt.id));
  const fresh = catalog.filter((prompt) => matches(prompt, false));
  return fresh.length > 0 ? fresh : catalog.filter((prompt) => matches(prompt, true));
}

export function drawPrompt(
  catalog: PromptDto[],
  kind: PromptDto["kind"],
  level: ContentLevel,
  allowAdult: boolean,
  recentIds: string[],
  rng: () => number,
): PromptDto {
  const pool = eligiblePrompts(catalog, kind, level, allowAdult, recentIds);
  if (pool.length === 0) {
    throw new Error("empty");
  }
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const prompt = pool[index];
  if (!prompt) throw new Error("empty");
  return prompt;
}

function item(
  id: string,
  kind: PromptDto["kind"],
  level: ContentLevel,
  category: string,
  text: string,
  adult = false,
): PromptDto {
  return { id, kind, level, category, text, adult };
}

export const SEED_PROMPTS: PromptDto[] = [
  item("t-mild-1", "truth", "mild", "日常", "今天最让你开心的一件小事是什么？"),
  item("t-mild-2", "truth", "mild", "友谊", "在场的人里，你最想一起去旅行的是谁？"),
  item("t-mild-3", "truth", "mild", "回忆", "你最近一次放声大笑是因为什么？"),
  item("t-mild-4", "truth", "mild", "观察", "用三个词形容你现在的状态。"),
  item("t-mild-5", "truth", "mild", "日常", "你有什么一直想养成、却还没开始的习惯？"),
  item("t-mild-6", "truth", "mild", "友谊", "你更喜欢被当面表扬，还是私下表扬？"),
  item("t-spicy-1", "truth", "spicy", "勇气", "你上次说了善意的谎言，是为了保护谁？"),
  item("t-spicy-2", "truth", "spicy", "回忆", "哪件事你现在想起来还会觉得不好意思？"),
  item("t-spicy-3", "truth", "spicy", "友谊", "在场谁最可能成为你的紧急联系人，为什么？"),
  item("t-spicy-4", "truth", "spicy", "观察", "你最容易被人看穿的小动作是什么？"),
  item("t-spicy-5", "truth", "spicy", "日常", "你手机里最舍不得删的一张照片是什么主题？"),
  item("t-wild-1", "truth", "wild", "勇气", "如果必须立刻向在场一位玩家道歉，你会选谁？"),
  item("t-wild-2", "truth", "wild", "回忆", "你做过最后悔但没有回头补救的决定是什么？"),
  item("t-wild-3", "truth", "wild", "友谊", "你曾经嫉妒过哪位朋友？嫉妒的是什么？"),
  item("t-adult-1", "truth", "spicy", "勇气", "描述一次让你脸红的心动经历，不必说出对方名字。", true),
  item("t-adult-2", "truth", "wild", "日常", "说出你最不想被家人翻到的聊天记录类型。", true),
  item("d-mild-1", "dare", "mild", "日常", "用十秒夸夸你左边的玩家。"),
  item("d-mild-2", "dare", "mild", "勇气", "模仿一种动物，直到有人猜中。"),
  item("d-mild-3", "dare", "mild", "友谊", "给在场一位玩家起一个今天限定的外号。"),
  item("d-mild-4", "dare", "mild", "观察", "用一句话总结今天的房间氛围。"),
  item("d-mild-5", "dare", "mild", "日常", "分享一个你今天吃过或想吃的食物。"),
  item("d-mild-6", "dare", "mild", "回忆", "哼一首你最近循环的歌，哼四小节即可。"),
  item("d-spicy-1", "dare", "spicy", "勇气", "向一位玩家真诚地请教一件你不擅长的事。"),
  item("d-spicy-2", "dare", "spicy", "友谊", "让其他玩家各说一个你的优点，你来复述。"),
  item("d-spicy-3", "dare", "spicy", "日常", "用夸张的语气朗读刚才的真心话题目。"),
  item("d-spicy-4", "dare", "spicy", "观察", "指出房间里两位玩家的一个共同点。"),
  item("d-wild-1", "dare", "wild", "勇气", "用三十秒发表一段完全站不住脚的演讲。"),
  item("d-wild-2", "dare", "wild", "友谊", "选择一位玩家，当面说出你欣赏但很少告诉对方的地方。"),
  item("d-wild-3", "dare", "wild", "回忆", "表演你人生中最尴尬的一个瞬间，点到为止。"),
  item("d-adult-1", "dare", "spicy", "勇气", "用一句话大胆夸奖在场的一位玩家。", true),
  item("d-adult-2", "dare", "wild", "友谊", "分享一个你曾经撒过、现在可以公开的小谎。", true),
];
