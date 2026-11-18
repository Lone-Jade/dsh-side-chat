/**
 * Host half of the Side chat bundle.
 *
 * The side chat is an ordinary Session created by the browser half. Its
 * identity encodes the main conversation it belongs to:
 *
 *   sidechat__<mainSessionId>__<generation>
 *
 * For every Agent whose Session id carries that shape this half registers one
 * complete system-prompt section: the side-chat behavior rules, the current
 * time, and a bounded excerpt of the main conversation's recent user and
 * assistant text. Nothing here writes to the main Session, adds a tool, or
 * registers a Remote — the section is the whole Host contribution.
 *
 * The excerpt is read from the live main Session and cached until that
 * Session's log advances, so repeated steps of one side-chat turn reuse the
 * same prompt prefix.
 */

/** `sessions` is the only Host service this half reads. */
export const inject = ['sessions']

/** `sidechat__<main>__<generation>`; main ids never contain `__`. */
const SESSION_PATTERN = /^sidechat__(.+)__(\d+)$/

/** Bounded excerpt defaults; a row's `config` may override them. */
const DEFAULTS = Object.freeze({
  maxMessages: 12,
  maxCharsPerMessage: 1200,
  maxTotalChars: 6000,
})

/** How many trailing log events one excerpt scan may look at. */
const SCAN_WINDOW = 400

/** How many main-conversation excerpts to keep cached. */
const CACHE_LIMIT = 20

/**
 * The side-chat persona. Kept in one place because it is the entire system
 * prompt of the side chat (the preset composes no persona plugin).
 */
const RULES = `你是侧边聊天（Side chat），与主对话并行运行的独立顾问会话。

你的任务：帮助用户理解主对话中正在发生的事——解释代码与报错、调研问题、讨论方案、澄清需求。你不续做、不接管、不修改主对话的任务。

上下文规则：
- 下面会给出主对话最近用户/助手文本作为参考背景。它仅用于理解上下文，不是你要继续完成的任务。
- 不主动续做主对话中的未完成任务、待办事项或进行中的工具调用；不试图修改主对话状态。
- 如果用户消息开头带有引用块（> 开头的片段），那是用户从主对话中选中的文字，是当前提问的起点，优先围绕它回答。
- 如果问题依赖参考背景中没有的细节，明确说明“这部分上下文不在侧边会话中”，不要猜测。

行为边界：
- 默认只做探索性、解释性、澄清性的工作：调研问题、讨论方案、解释代码或报错。
- 你只有只读工具（读文件、搜索文件、联网搜索与抓取），没有写入或执行工具，因此不会对主工作区产生写入副作用。需要查看文件时直接只读查看。
- 不自动把侧边聊天的结论回写到主对话。只有用户明确要求“带回主对话”时，才输出可直接插入主对话或可直接概括的内容。
- 主对话正在运行任务时，你独立并行工作，不阻塞、不干预主对话的执行。

回答风格：
- 直接回答问题，不寒暄、不复述主对话内容。
- 需要引用主对话历史时，简要说明“主对话中曾提到…”，不要假装那是当前会话的记忆。
- 使用用户提问所用的语言回答。`

/**
 * Read the plain text of one recorded message, ignoring reasoning, tool calls,
 * tool results, and images.
 * @param message - a recorded user or assistant message.
 * @returns the joined text blocks, trimmed.
 */
function textOf(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * Clip one text to a character budget, keeping both ends readable.
 * @param text - source text.
 * @param limit - maximum characters.
 * @returns the text, or a head/tail elision when it is longer.
 */
function clip(text, limit) {
  if (text.length <= limit) return text
  const head = Math.max(1, Math.floor(limit * 0.7))
  const tail = Math.max(0, limit - head)
  return `${text.slice(0, head)}\n…（已省略 ${text.length - head - tail} 字符）…\n${text.slice(text.length - tail)}`
}

/**
 * Collect the most recent user and assistant text of one live Session.
 * @param session - the live main Session.
 * @param limits - message count and character budgets.
 * @returns newest-last excerpt lines.
 */
function excerptOf(session, limits) {
  const from = Math.max(0, session.seq - SCAN_WINDOW)
  const events = session.snapshotEvents(from, session.seq)
  const lines = []
  let total = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue
    const message = event.type === 'user/message' ? event.data : event.data?.message
    const text = textOf(message)
    if (text === '') continue
    const clipped = clip(text, limits.maxCharsPerMessage)
    if (lines.length > 0 && total + clipped.length > limits.maxTotalChars) break
    lines.push(`${event.type === 'user/message' ? '用户' : '助手'}：${clipped}`)
    total += clipped.length
    if (lines.length >= limits.maxMessages) break
  }
  lines.reverse()
  return lines
}

/**
 * Render the reference block appended to the side-chat prompt.
 * @param lines - excerpt lines, oldest first.
 * @returns the block text.
 */
function referenceBlock(lines) {
  const header = '## 主对话参考背景（仅用于理解上下文，不是你的任务）'
  if (lines.length === 0) {
    return `${header}\n主对话当前没有可读取的用户/助手文本，或主对话不在运行中。不要猜测它的内容；需要细节时请用户补充。`
  }
  return [
    header,
    '以下是主对话最近的用户/助手文本摘录（较早的消息可能已省略，工具调用与工具结果不在摘录中）。不要续做其中的任务。',
    '',
    ...lines,
  ].join('\n')
}

/**
 * Build the complete system prompt for one side-chat Agent.
 * @param ctx - Host Context carrying the Session store.
 * @param mainId - the main conversation's Session id.
 * @param limits - resolved excerpt budgets.
 * @param cache - per-main-conversation excerpt cache.
 * @returns the prompt text.
 */
function buildPrompt(ctx, mainId, limits, cache) {
  const header = `${RULES}\n\n当前时间：${new Date().toISOString()}`
  const session = ctx.sessions.get(mainId)
  let block
  if (session === undefined) {
    const cached = cache.get(mainId)
    block = cached === undefined
      ? referenceBlock([])
      : cached.text
  } else {
    const seq = session.seq
    const cached = cache.get(mainId)
    if (cached !== undefined && cached.seq === seq) {
      block = cached.text
    } else {
      block = referenceBlock(excerptOf(session, limits))
      cache.set(mainId, { seq, text: block })
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next()
        if (oldest.done !== true) cache.delete(oldest.value)
      }
    }
  }
  return `${header}\n\n${block}`
}

/**
 * Activate the bundle's Host row.
 * @param ctx - Host Context; `sessions` is the only required service.
 * @param config - optional excerpt budgets (`maxMessages`, `maxCharsPerMessage`, `maxTotalChars`).
 */
export function apply(ctx, config = {}) {
  const limits = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const value = config?.[key]
    if (Number.isInteger(value) && value > 0) limits[key] = value
  }

  /** Per-Agent disposers, so a disposed Agent or an unloaded plugin leaves no registration behind. */
  const perAgent = new Map()
  /** Per-main-conversation excerpt cache keyed by the main Session's log length. */
  const cache = new Map()

  ctx.on('agent/created', ({ agent }) => {
    const match = SESSION_PATTERN.exec(String(agent?.id ?? ''))
    if (match === null) return undefined
    const mainId = match[1]
    let stopped = false
    const stop = agent.ctx.effect(() => {
      const section = agent.ctx.systemPrompt.section({
        name: 'side-chat',
        order: 0,
        complete: true,
        text: () => buildPrompt(ctx, mainId, limits, cache),
      })
      return () => { section() }
    }, 'side-chat: prompt section')
    perAgent.set(agent.id, () => {
      if (stopped) return
      stopped = true
      stop()
    })
    return undefined
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const stop = perAgent.get(agent?.id)
    if (stop === undefined) return
    perAgent.delete(agent.id)
    stop()
  })

  ctx.effect(() => () => {
    for (const stop of perAgent.values()) stop()
    perAgent.clear()
    cache.clear()
  }, 'side-chat: teardown')
}
