/**
 * Solar 应用目录：从网关拉取当前用户可见的一级菜单。
 *
 * 每个一级菜单就是一个 agent 应用：侧栏一个入口，点开进入对应模块页面。
 * 列表由 Java 按用户菜单权限过滤，前端不再自行判断权限。
 */

/** 一个 Solar 应用。 */
export interface SolarApp {
  /** 应用标识（菜单编号）。 */
  readonly id: string
  /** 应用名称，例如「人力资源」。 */
  readonly name: string
  /** 管理端路由前缀，例如 /hrm。 */
  readonly path: string
  /** 图标标识，来自菜单配置。 */
  readonly icon?: string | null
  /** 排序值。 */
  readonly sort?: number | null
  /**
   * 默认子页面路由，例如 /system/user。
   *
   * 一级菜单本身通常只是目录，直接打开会空白；优先用它定位到实际页面。
   */
  readonly defaultPath?: string | null
}

/** 拉取失败时抛出。 */
export class SolarAppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SolarAppError'
  }
}

/**
 * 拉取当前用户可见的应用。
 *
 * 走网关同源 `/admin-api`，令牌由网关注入，前端不持有凭据。
 * @returns 应用列表
 * @throws SolarAppError 未登录或请求失败
 */
export async function fetchSolarApps(): Promise<readonly SolarApp[]> {
  const response = await fetch('/admin-api/system/agent/tools/apps', {
    headers: { accept: 'application/json', 'tenant-id': '1' },
    credentials: 'same-origin',
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new SolarAppError(`应用列表返回了无法解析的响应（HTTP ${response.status}）`)
  }
  if (payload === null || typeof payload !== 'object') {
    throw new SolarAppError('应用列表返回了空响应')
  }
  const record = payload as { code?: unknown; msg?: unknown; data?: unknown }
  if (record.code !== 0) {
    const message = typeof record.msg === 'string' && record.msg !== ''
      ? record.msg
      : `业务码 ${String(record.code)}`
    throw new SolarAppError(message)
  }
  if (!Array.isArray(record.data)) return []
  const apps: SolarApp[] = []
  for (const item of record.data) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.path !== 'string') {
      continue
    }
    apps.push({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      icon: typeof entry.icon === 'string' ? entry.icon : null,
      sort: typeof entry.sort === 'number' ? entry.sort : null,
      defaultPath: typeof entry.defaultPath === 'string' ? entry.defaultPath : null,
    })
  }
  return apps
}

/**
 * 生成应用入口地址。
 *
 * 管理端用 hash 路由，模块路径放在 `#` 之后；必须同源，登录 cookie 才会带上。
 * `embed=1` 让管理端隐藏自己的侧栏与标签栏——agent 侧栏已经承担了导航，
 * 否则会出现两套重复导航。
 * @param app 应用
 * @param route 覆盖落地路由，用于从外层地址恢复深链接
 * @returns iframe 地址
 */
export function appUrl(app: SolarApp, route?: string): string {
  // 进入叶子页面：一级/二级目录本身没有页面，直接打开会空白。
  // embed=1 让管理端隐藏自己的侧栏与标签栏——agent 侧栏已是唯一导航。
  // app=<前缀> 把应用边界固定在 iframe 创建时：管理端用它拦截越界路由，
  // 不能从当前 hash 推导，否则跳到 /system/user 后边界就跟着漂移了。
  // home=<叶子路由> 是越界后的回退目标；一级菜单是目录，回退到它只会白屏。
  const fallback = app.defaultPath ?? app.path
  // 恢复的路由必须仍在该应用内，避免用地址把标签带到别的应用。
  const resolved = route !== undefined && route.startsWith(`${app.path}/`) ? route : fallback
  const query = new URLSearchParams({ embed: '1', app: app.path, home: resolved })
  return `/solar/?${query.toString()}#${resolved}`
}

/**
 * 把应用目录做成可订阅的快照源。
 *
 * 侧栏与主面板都依赖它；变更时同时通知两边重新渲染。
 */
export interface SolarAppsState {
  readonly apps: readonly SolarApp[]
  readonly loading: boolean
  readonly error?: string
}

/** 应用目录 store。 */
export class SolarAppsStore {
  #state: SolarAppsState = { apps: [], loading: true }
  readonly #listeners = new Set<() => void>()

  getSnapshot = (): SolarAppsState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** 拉取并发布。 */
  async refresh(): Promise<void> {
    this.#publish({ apps: this.#state.apps, loading: true })
    try {
      const apps = await fetchSolarApps()
      this.#publish({ apps, loading: false })
    } catch (error) {
      this.#publish({
        apps: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  #publish(next: SolarAppsState): void {
    this.#state = next
    for (const listener of this.#listeners) listener()
  }
}
