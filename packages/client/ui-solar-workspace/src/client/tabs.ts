/**
 * 应用标签（Chrome 风格）。
 *
 * 第一个标签固定是「工作台」（对话界面），不可关闭；其余标签对应
 * 用户打开过的 Solar 应用。关闭最后一个应用标签时回到工作台。
 *
 * 为什么需要这一层：`ctx.layout.selectPanel` 只记录"当前选中哪个面板"，
 * 不记录"打开过哪些"。标签栏要保留用户开过的应用，因此自己维护一份
 * 打开顺序。
 */

/** 工作台标签的固定标识（对应 layout 的 `null` 面板）。 */
export const WORKBENCH_TAB_ID = 'workbench'

/** 标签状态的持久化键。 */
const STORAGE_KEY = 'solar-workspace:tabs'

/** 一个已打开的标签。 */
export interface AppTab {
  /** 标签标识：工作台用固定值，应用用面板 id。 */
  readonly id: string
  /** 显示名。 */
  readonly label: string
  /** 是否为工作台（不可关闭）。 */
  readonly pinned: boolean
  /** 应用标签对应的应用；工作台没有。 */
  readonly appId?: string
  /**
   * 应用内当前路由，例如 `/hrm/employee`。
   *
   * 记录它是为了让外层地址能反映"用户正在看哪个页面"——否则地址栏永远
   * 停在 `/`，既不能分享也不能收藏。缺省时用应用自己的默认落地页。
   */
  readonly route?: string
}

/** 标签状态。 */
export interface TabsState {
  readonly tabs: readonly AppTab[]
  /** 当前激活的标签；永远是 tabs 里的某一项。 */
  readonly activeId: string
}

/** 只保留可安全回填的字段：标签名与顺序是界面状态，不是权限。 */
function parseStored(raw: string | null): TabsState | null {
  if (raw === null || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const record = parsed as { tabs?: unknown; activeId?: unknown }
    if (!Array.isArray(record.tabs)) return null
    const tabs: AppTab[] = [{ id: WORKBENCH_TAB_ID, label: '', pinned: true }]
    for (const item of record.tabs) {
      if (item === null || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      if (typeof entry.id !== 'string' || entry.id === WORKBENCH_TAB_ID) continue
      if (typeof entry.label !== 'string' || typeof entry.appId !== 'string') continue
      if (tabs.some(tab => tab.id === entry.id)) continue
      tabs.push({
        id: entry.id,
        label: entry.label,
        pinned: false,
        appId: entry.appId,
        ...(typeof entry.route === 'string' ? { route: entry.route } : {}),
      })
    }
    // 激活项必须存在；否则回到工作台。
    const activeId = typeof record.activeId === 'string'
      && tabs.some(tab => tab.id === record.activeId)
      ? record.activeId
      : WORKBENCH_TAB_ID
    return { tabs, activeId }
  } catch {
    return null
  }
}

/** 标签 store：持有打开顺序与激活项。 */
export class AppTabsStore {
  #state: TabsState = this.#restore()

  readonly #listeners = new Set<() => void>()

  /** 从本地存储恢复上次的标签；没有或损坏时退回只有工作台。 */
  #restore(): TabsState {
    const fallback: TabsState = {
      tabs: [{ id: WORKBENCH_TAB_ID, label: '', pinned: true }],
      activeId: WORKBENCH_TAB_ID,
    }
    if (typeof window === 'undefined') return fallback
    try {
      return parseStored(window.localStorage.getItem(STORAGE_KEY)) ?? fallback
    } catch {
      // 隐私模式或存储被禁用：不持久化，但功能照常。
      return fallback
    }
  }

  /** 写入本地存储；失败只影响下次恢复，不影响当前交互。 */
  #persist(state: TabsState): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tabs: state.tabs.filter(tab => !tab.pinned),
        activeId: state.activeId,
      }))
    } catch {
      // 配额满或被禁用：忽略。
    }
  }

  getSnapshot = (): TabsState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * 打开一个应用标签：已存在则激活，不存在则追加到末尾并激活。
   * @param tab 应用标签
   */
  open(tab: AppTab): void {
    const exists = this.#state.tabs.some(item => item.id === tab.id)
    const tabs = exists ? this.#state.tabs : [...this.#state.tabs, tab]
    this.#publish({ tabs, activeId: tab.id })
  }

  /**
   * 记录某个标签内部的路由变化。
   *
   * 只改路由、不动激活项：用户在 iframe 里点菜单不应该把焦点从别处抢走。
   * @param id 标签标识
   * @param route 应用内路由
   */
  setRoute(id: string, route: string): void {
    const current = this.#state.tabs.find(item => item.id === id)
    if (current === undefined || current.route === route) return
    const tabs = this.#state.tabs.map(item => item.id === id ? { ...item, route } : item)
    this.#publish({ tabs, activeId: this.#state.activeId })
  }

  /** 激活一个已打开的标签。 */
  activate(id: string): void {
    if (!this.#state.tabs.some(item => item.id === id)) return
    this.#publish({ tabs: this.#state.tabs, activeId: id })
  }

  /**
   * 关闭一个标签。工作台不可关闭。
   * @param id 标签标识
   * @returns 关闭后应激活的标签标识；不可关闭时返回当前激活项
   */
  close(id: string): string {
    const target = this.#state.tabs.find(item => item.id === id)
    if (target === undefined || target.pinned) return this.#state.activeId
    const index = this.#state.tabs.findIndex(item => item.id === id)
    const tabs = this.#state.tabs.filter(item => item.id !== id)
    // 关闭当前标签时，激活它右边的一个；没有右边就激活左边。
    const nextActive = this.#state.activeId === id
      ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? WORKBENCH_TAB_ID)
      : this.#state.activeId
    this.#publish({ tabs, activeId: nextActive })
    return nextActive
  }

  /**
   * 外部（例如权限回收）导致某应用不可用时移除其标签。
   * @param appId 应用标识
   * @returns 是否移除，以及应激活的标签
   */
  removeApp(appId: string): { removed: boolean; activeId: string } {
    const target = this.#state.tabs.find(item => item.appId === appId)
    if (target === undefined) return { removed: false, activeId: this.#state.activeId }
    const activeId = this.close(target.id)
    return { removed: true, activeId }
  }

  /** 更新标签显示名（应用改名时）。 */
  relabel(id: string, label: string): void {
    const tabs = this.#state.tabs.map(item => item.id === id ? { ...item, label } : item)
    this.#publish({ tabs, activeId: this.#state.activeId })
  }

  #publish(next: TabsState): void {
    this.#state = next
    this.#persist(next)
    for (const listener of this.#listeners) listener()
  }
}
