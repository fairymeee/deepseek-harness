/**
 * 企业流式桥：把 Harness 的进程内 assistant 流式帧转发给外部 Node 服务。
 *
 * 官方 `sdk` profile 只把**持久化**会话事件写进 stdio JSON-RPC，Web 客户端用的
 * `assistant/live-chunk` 是进程内瞬时事件，不经过 SDK。本插件订阅官方的
 * `agent/assistant-stream` 事件，把同一份帧以额外的 JSON-RPC 通知输出，
 * 让企业 Node 服务拿到逐字文本、思考过程和工具调用增量。
 *
 * 只读取并转发，不改变 Agent 行为，也不新增模型可见内容。
 */

export const name = 'enterprise-stream-bridge'

/**
 * @typedef {object} StreamBridgeConfig
 * @property {(line: string) => void} [write] 写出一行 JSON 的接收器；未提供时使用 process.stdout。
 */

/**
 * 订阅 `agent/assistant-stream` 并把帧写成 `enterprise/assistant-stream` 通知。
 *
 * 通知形状刻意保持扁平，避免把上游内部类型泄漏给 Node 服务：params 携带
 * sessionId 与一个只含 type/index/chunk 的 frame。
 */
/**
 * @param {object} ctx Cordis 上下文。
 * @param {StreamBridgeConfig} [config] 插件配置。
 */
export function apply(ctx, config = {}) {
  const write = config.write ?? ((line) => { process.stdout.write(line) })

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const sessionId = String(agent.session.id)
    const payload = projectFrame(sessionId, frame)
    if (payload === null) {
      return
    }
    write(`${JSON.stringify(payload)}\n`)
  }, { global: true })
}

/**
 * @param {string} sessionId
 * @param {unknown} frame
 * @returns {object | null}
 */
function projectFrame(sessionId, frame) {
  if (frame === null || typeof frame !== 'object') {
    return null
  }
  const record = frame
  const type = record.type

  if (type === 'start') {
    return {
      jsonrpc: '2.0',
      method: 'enterprise/assistant-stream',
      params: {
        sessionId,
        frame: {
          type: 'start',
          attemptId: String(record.attemptId ?? ''),
          turn: numberOr(record.turn, 0),
          step: numberOr(record.step, 0),
        },
      },
    }
  }

  if (type === 'end') {
    return {
      jsonrpc: '2.0',
      method: 'enterprise/assistant-stream',
      params: {
        sessionId,
        frame: {
          type: 'end',
          attemptId: String(record.attemptId ?? ''),
          outcome: projectOutcome(record.outcome),
        },
      },
    }
  }

  if (type === 'chunk') {
    const chunk = projectChunk(record.chunk)
    if (chunk === null) {
      return null
    }
    return {
      jsonrpc: '2.0',
      method: 'enterprise/assistant-stream',
      params: {
        sessionId,
        frame: {
          type: 'chunk',
          attemptId: String(record.attemptId ?? ''),
          index: numberOr(record.index, 0),
          chunk,
        },
      },
    }
  }

  return null
}

/**
 * 只转发企业界面需要消费的 chunk 种类；`usage`、`finish` 等由持久事件承担，
 * 避免同一事实出现两个来源。
 */
/**
 * @param {unknown} value
 * @returns {object | null}
 */
function projectChunk(value) {
  if (value === null || typeof value !== 'object') {
    return null
  }
  const chunk = value
  switch (chunk.type) {
    case 'block-start':
      return { type: 'block-start', index: numberOr(chunk.index, 0), blockType: String(chunk.blockType ?? '') }
    case 'block-end':
      return { type: 'block-end', index: numberOr(chunk.index, 0) }
    case 'text-delta':
      return typeof chunk.text === 'string'
        ? { type: 'text-delta', index: numberOr(chunk.index, 0), text: chunk.text }
        : null
    case 'reasoning-delta':
      return typeof chunk.text === 'string'
        ? { type: 'reasoning-delta', index: numberOr(chunk.index, 0), text: chunk.text }
        : null
    case 'tool-call-delta':
      return {
        type: 'tool-call-delta',
        index: numberOr(chunk.index, 0),
        ...(typeof chunk.name === 'string' ? { name: chunk.name } : {}),
        ...(typeof chunk.argumentsDelta === 'string' ? { argumentsDelta: chunk.argumentsDelta } : {}),
      }
    default:
      return null
  }
}

/**
 * @param {unknown} value
 * @returns {object}
 */
function projectOutcome(value) {
  if (value === null || typeof value !== 'object') {
    return { kind: 'abandoned' }
  }
  const record = value
  if (record.kind === 'committed') {
    return {
      kind: 'committed',
      eventType: String(record.eventType ?? ''),
      seq: numberOr(record.seq, 0),
    }
  }
  return { kind: 'abandoned' }
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
