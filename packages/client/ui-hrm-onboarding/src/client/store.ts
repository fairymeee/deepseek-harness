/**
 * 当前打开的草稿。
 *
 * 卡片与页面是两个不同的插槽条目，需要共享"现在看哪份草稿"。这里用一个
 * 极小的可订阅 store：卡片点开时写入，页面订阅后加载。
 *
 * 只存编号，不存草稿内容——页面每次打开都重新读取，避免拿旧快照覆盖
 * 别处刚改过的字段。
 */

/** 卡片里带的界面引用。 */
export interface SurfaceRef {
  /** 界面标识，例如 hrm.employee-onboarding.draft */
  readonly id: string
  /** 业务对象编号（草稿编号） */
  readonly objectId: string
  /** 所属任务 */
  readonly taskId?: string
}

/** store 状态。 */
export interface DraftSelection {
  readonly draftId: number | null
}

/** 草稿选择 store。 */
export class DraftSelectionStore {
  #state: DraftSelection = { draftId: null }
  readonly #listeners = new Set<() => void>()

  getSnapshot = (): DraftSelection => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * 打开一份草稿。
   * @param draftId 草稿编号
   */
  open(draftId: number): void {
    if (this.#state.draftId === draftId) return
    this.#state = { draftId }
    for (const listener of this.#listeners) listener()
  }
}

/**
 * 从工具结果的文本里取出界面引用。
 *
 * 工具返回的是 JSON 文本（服务端渲染时就是 `JSON.stringify(value)`），
 * 里面若带 `surface` 说明这个动作有对应页面。客户端只接受已注册的界面
 * 标识，不认识的一律忽略——不能让结果把界面带到任意页面。
 * @param text 工具结果文本
 * @param registered 已注册的界面标识
 * @returns 界面引用；没有或不认识时返回 undefined
 */
export function readSurface(text: string, registered: readonly string[]): SurfaceRef | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const surface = (parsed as { surface?: unknown }).surface
  if (surface === null || typeof surface !== 'object') return undefined
  const record = surface as Record<string, unknown>
  if (typeof record.id !== 'string' || !registered.includes(record.id)) return undefined
  if (typeof record.objectId !== 'string' || record.objectId === '') return undefined
  return {
    id: record.id,
    objectId: record.objectId,
    ...(typeof record.taskId === 'string' ? { taskId: record.taskId } : {}),
  }
}
