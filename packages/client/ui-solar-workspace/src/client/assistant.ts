/**
 * 助手面板的展开状态。
 *
 * 为什么单独做成 store：标签栏上的开关按钮要跟着状态变（图标与文案），
 * 而状态本身还要被几何计算读取。用一个可订阅的小 store 同时满足两边，
 * 不必把 React 状态往插件主体里引。
 */

/** 助手面板开关。 */
export class AssistantToggleStore {
  #collapsed: boolean
  readonly #listeners = new Set<() => void>()

  /**
   * @param collapsed 初始是否收起
   */
  constructor(collapsed: boolean) {
    this.#collapsed = collapsed
  }

  getSnapshot = (): boolean => this.#collapsed

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** 翻转并通知。 */
  toggle(): boolean {
    this.#collapsed = !this.#collapsed
    for (const listener of this.#listeners) listener()
    return this.#collapsed
  }
}
