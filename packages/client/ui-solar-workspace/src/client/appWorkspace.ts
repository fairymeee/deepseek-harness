/**
 * 应用 ↔ 工作区绑定。
 *
 * 产品模型：**一个 Solar 应用就是一个 DSH 工作区**。会话归属到工作区，
 * 打开应用时助手自动带出这个应用最近的会话，切回工作台回到控制台会话。
 *
 * 为什么要绑定而不是每次按名字查：工作区标题可以被用户改，路径是宿主侧
 * 事实。这里记住 `workspaceId`，并缓存路径，避免每次打开都去问宿主。
 * 绑定持久化在 localStorage：刷新后不应该重新建一遍工作区。
 */

/** 一个应用到工作区的绑定。 */
export interface AppWorkspaceBinding {
  /** 宿主工作区 id。 */
  readonly workspaceId: string
  /** 宿主目录绝对路径。 */
  readonly path: string
  /**
   * 上次在这个应用里看的会话。
   *
   * 用户要的是"打开应用就带出最近的会话"；先回到他上次看的那条更符合
   * 预期，那条被删或归档了再回落到工作区里最近的一条。
   */
  readonly lastSessionId?: string
}

/** 会话行里挑最近一条需要的最小字段。 */
interface SessionRowLike {
  readonly sessionId: string
  readonly updatedAt: number
  readonly blank: boolean
}

/** 工作区里挑会话需要的最小字段。 */
interface WorkspaceLike {
  readonly sessionIds: readonly string[]
}

const STORAGE_KEY = 'solar-workspace:app-workspaces'

/** 从应用路径推导目录名：/hrm → hrm，/system → system。 */
export function appDirectoryName(appPath: string, appId: string): string {
  const slug = appPath
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? `app-${appId}` : slug
}

/**
 * 挑出打开应用时该显示哪个会话。
 *
 * 顺序：上次看的 → 工作区里最近更新的 → 没有就交给调用方新建。
 * 空会话（blank）不算：那是一张没写过的白纸，恢复它等于什么都不恢复。
 * @param binding 应用绑定
 * @param workspace 工作区
 * @param byId 会话元数据
 * @param archived 已归档的会话
 * @returns 会话 id；没有可用会话时 undefined
 */
export function pickSessionForApp(
  binding: AppWorkspaceBinding | undefined,
  workspace: WorkspaceLike | undefined,
  byId: Readonly<Record<string, SessionRowLike>>,
  archived: readonly string[],
): string | undefined {
  if (workspace === undefined) return undefined
  const usable = (id: string): SessionRowLike | undefined => {
    const row = byId[id]
    if (row === undefined || row.blank) return undefined
    return archived.includes(id) ? undefined : row
  }
  const remembered = binding?.lastSessionId
  if (remembered !== undefined
    && workspace.sessionIds.includes(remembered)
    && usable(remembered) !== undefined) return remembered
  let best: SessionRowLike | undefined
  for (const id of workspace.sessionIds) {
    const row = usable(id)
    if (row === undefined) continue
    if (best === undefined || row.updatedAt > best.updatedAt) best = row
  }
  return best?.sessionId
}

/** 应用绑定的持久化存储。 */
export class AppWorkspaceStore {
  #byApp: Record<string, AppWorkspaceBinding>

  constructor() {
    this.#byApp = readStored()
  }

  get(appId: string): AppWorkspaceBinding | undefined {
    return this.#byApp[appId]
  }

  set(appId: string, binding: AppWorkspaceBinding): void {
    this.#byApp = { ...this.#byApp, [appId]: binding }
    writeStored(this.#byApp)
  }

  delete(appId: string): void {
    if (this.#byApp[appId] === undefined) return
    this.#byApp = Object.fromEntries(
      Object.entries(this.#byApp).filter(([key]) => key !== appId),
    )
    writeStored(this.#byApp)
  }
}

/** @returns 持久化的绑定；损坏或缺失时返回空表 */
function readStored(): Record<string, AppWorkspaceBinding> {
  if (typeof localStorage === 'undefined') return {}
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, AppWorkspaceBinding> = {}
    for (const [appId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object') continue
      const entry = value as Record<string, unknown>
      if (typeof entry.workspaceId !== 'string' || typeof entry.path !== 'string') continue
      out[appId] = {
        workspaceId: entry.workspaceId,
        path: entry.path,
        ...(typeof entry.lastSessionId === 'string' ? { lastSessionId: entry.lastSessionId } : {}),
      }
    }
    return out
  } catch {
    return {}
  }
}

/** @param byApp 待写入的绑定表 */
function writeStored(byApp: Record<string, AppWorkspaceBinding>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byApp))
  } catch {
    // 配额或隐私模式：绑定只在本进程内有效，功能不受影响，下次会重新解析。
  }
}
