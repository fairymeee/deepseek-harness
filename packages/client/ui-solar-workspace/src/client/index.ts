/**
 * Solar 应用，浏览器侧。
 *
 * 每个 Solar 一级菜单就是一个 agent 应用。侧栏列出应用，点击后在工作区
 * 面板里以标签形式打开（Chrome 风格）：
 *   - 第一个标签固定是「工作台」（对话界面），不可关闭；
 *   - 其余标签是打开过的应用，可关闭；
 *   - 关闭最后一个应用标签时回到工作台。
 *
 * 应用清单由 Java 按当前用户的菜单权限过滤，前端只负责渲染，
 * 不自行判断"这个人能不能看这个模块"。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SolarAppsStore, type SolarApp } from './apps.ts'
import type { AppWorkspaceBinding } from './appWorkspace.ts'
import { appDirectoryName, AppWorkspaceStore, pickSessionForApp } from './appWorkspace.ts'
import { AppTabsStore, WORKBENCH_TAB_ID, type AppTab } from './tabs.ts'
import { AssistantToggleStore } from './assistant.ts'
import {
  SolarFrames, SolarPlaceholder, WorkspaceTabBar,
  type SolarWorkspaceInjected, type WorkspaceTabBarProps,
} from './SolarWorkspacePage.tsx'
import { SolarAppIcon } from './SolarAppIcon.tsx'
import { en, zh } from './locales.ts'

export type { SolarApp } from './apps.ts'
export { appUrl, fetchSolarApps } from './apps.ts'
export { AppTabsStore, WORKBENCH_TAB_ID } from './tabs.ts'
export type { AppTab } from './tabs.ts'

/** 文案命名空间。 */
export const NS = 'solarWorkspace'

/**
 * 需要官方 slot 注册表、面板导航，以及"应用即工作区"用到的三组服务。
 *
 * 这里是**服务名**：Cordis 按它给 `ctx.<name>` 放行，没声明的属性访问会直接抛错
 * （"cannot get property … without inject"）。package.json 里的
 * `dsh.client.inject` 是包名，只负责加载顺序，两者都要写。
 */
export const inject = [
  'slots', 'layout', 'locale', 'sessions', 'workspaces', 'uiWorkspace',
]

/**
 * 挂载 Solar 应用。
 * @param ctx 客户端根上下文
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'solar-apps: dictionaries')
  // 标签栏是 overlay，不占布局；把高度声明成全局变量，让其他主面板
  // （例如业务草稿页）能正确避让，不用各自硬编码 40px。
  ctx.effect(() => {
    const root = document.documentElement
    root.style.setProperty('--solar-tabbar-height', '40px')
    return () => { root.style.removeProperty('--solar-tabbar-height') }
  }, 'solar-apps: tabbar height token')

  // 会话面板要让出标签栏、并在分栏时缩到右半边。这两条只能作用在官方
  // 会话容器上，用它的稳定 data 属性定位（不是哈希类名）。
  //
  // 分栏用 margin-left 而不是 padding-left：会话容器是横向 flex 的子项，
  // 左边距会把它的可用宽度压窄；padding 则只是把内容往里推，容器自身
  // 宽度不变，内部一旦有更宽的元素就产生横向溢出，浏览器还会把它横向
  // 滚一段（实测滚了 170px，内容直接钻到应用层底下）。
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.solarShell = ''
    style.textContent = [
      ':root[data-solar-shell] div:has(> [data-conversation-content]) {',
      '  padding-top: var(--solar-tabbar-height, 40px);',
      '  transition: margin-left 160ms ease;',
      '}',
      ':root[data-solar-shell][data-solar-split] div:has(> [data-conversation-content]) {',
      '  margin-left: var(--solar-split-width, 60%);',
      '  min-width: 0;',
      '}',
      // 收起助手：应用占满中栏，会话只是藏起来，不卸载——
      // 展开时还停在原来的对话上。
      ':root[data-solar-shell][data-solar-assistant-collapsed] div:has(> [data-conversation-content]) {',
      '  visibility: hidden;',
      '  pointer-events: none;',
      '}',
      // 输入框下方的 token 速率、缓存命中率是开发者指标。业务用户看不懂，
      // 也占掉本就不宽的行宽，嵌入模式下不显示。
      ':root[data-solar-shell] [data-composer-stat] {',
      '  display: none;',
      '}',
    ].join('\n')
    document.head.append(style)
    document.documentElement.dataset.solarShell = ''
    return () => {
      style.remove()
      delete document.documentElement.dataset.solarShell
    }
  }, 'solar-apps: shell layout')

  /**
   * 助手面板是否收起。
   *
   * DeepClaw 的助手是"可停靠、可收起"的：看业务页面时可以把它收起来，
   * 让应用占满。窄窗口下两个并排都看不清，这个开关是必需品。
   * 声明必须在几何 effect 之前：effect 注册时会立刻读这个状态。
   */
  const assistant = new AssistantToggleStore(readFlag(ASSISTANT_COLLAPSED_KEY))

  const applyAssistantCollapsed = (): void => {
    const root = document.documentElement
    if (assistant.getSnapshot()) root.dataset.solarAssistantCollapsed = ''
    else delete root.dataset.solarAssistantCollapsed
    syncGeometry()
  }

  const toggleAssistant = (): void => {
    writeFlag(ASSISTANT_COLLAPSED_KEY, assistant.toggle())
    applyAssistantCollapsed()
  }

  /**
   * 量出中栏的位置与宽度。
   *
   * 侧栏折叠、右栏展开都会改变它，所以由这里统一写入 CSS 变量，
   * 供标签栏、应用层、会话缩进共用，避免各自硬编码 264px。
   */
  const syncGeometry = (): void => {
    const pane = document.querySelector('div:has(> [data-conversation-content])')
    // 从**父级**开始量。会话容器自己会被分栏的左边距推走，量它等于量一个
    // 被自己影响过的值：左边距改宽度、宽度又改左边距，会形成反馈环，
    // 实测能把整个中栏一路推到窗口右边去。
    let element: HTMLElement | null = pane instanceof HTMLElement ? pane.parentElement : null
    if (element === null) return
    let box = element.getBoundingClientRect()
    // 往上找到第一个真正占位的祖先：中间的插槽包装层是 display: contents，
    // 自身没有盒子。
    while (box.width === 0 && element.parentElement !== null) {
      element = element.parentElement
      box = element.getBoundingClientRect()
    }
    if (box.width === 0) return
    const center = Math.round(box.width)
    const root = document.documentElement
    root.style.setProperty('--solar-center-left', `${Math.round(box.left)}px`)
    root.style.setProperty('--solar-center-width', `${center}px`)
    root.style.setProperty(
      '--solar-split-width',
      `${assistant.getSnapshot() ? center : splitWidthFor(center)}px`,
    )
    // 会话区的宽度变化（打开右栏、折叠侧栏）不会改变 body 尺寸，
    // 必须直接盯住会话元素，否则变量会一直停在上一次的值上，
    // 表现为打开右栏后对话被挤成一条竖线。
    if (resizeObserver !== null && observed !== element) {
      if (observed !== null) resizeObserver.unobserve(observed)
      resizeObserver.observe(element)
      observed = element
      // 已经盯住真正会变尺寸的元素，DOM 兜底可以撤了。
      pendingObserver?.disconnect()
      pendingObserver = null
    }
  }

  let resizeObserver: ResizeObserver | null = null
  let observed: Element | null = null
  /** 会话面板出现之前，靠它一直重试量尺寸。 */
  let pendingObserver: MutationObserver | null = null
  let pendingFrame = 0

  /** 合并短时间内的多次触发：DOM 兜底阶段每次变更都会调到这里。 */
  const scheduleSync = (): void => {
    if (pendingFrame !== 0) return
    // 用 setTimeout 而不是 requestAnimationFrame：在没有合成帧的环境里
    // （内置浏览器窗口不活跃、被遮挡）rAF 回调可能永远不执行，
    // 兜底同步就一次也跑不到。
    pendingFrame = window.setTimeout(() => {
      pendingFrame = 0
      syncGeometry()
    }, 0)
  }

  ctx.effect(() => {
    applyAssistantCollapsed()
    resizeObserver = new ResizeObserver(() => { syncGeometry() })
    window.addEventListener('resize', syncGeometry)
    // 插件初始化时会话面板可能还没挂载（正在恢复会话），一次量不到就
    // 永远量不到：没有元素可观察，也就没有下一次触发。这里先盯着 DOM
    // 变化重试，拿到面板后换成 ResizeObserver。
    //
    // 盯 documentElement 而不是 body：插件可能在 body 挂载前就初始化，
    // observe(null) 会抛错，把后面的首次同步一起带没（表现为只有窗口
    // 尺寸变化时才写 CSS 变量）。
    pendingObserver = new MutationObserver(scheduleSync)
    pendingObserver.observe(document.documentElement, { childList: true, subtree: true })
    syncGeometry()
    return () => {
      window.removeEventListener('resize', syncGeometry)
      if (pendingFrame !== 0) window.clearTimeout(pendingFrame)
      pendingFrame = 0
      pendingObserver?.disconnect()
      pendingObserver = null
      resizeObserver?.disconnect()
      resizeObserver = null
      observed = null
    }
  }, 'solar-apps: geometry')
  const t = ctx.locale.bind(NS)
  const apps = new SolarAppsStore()
  const tabs = new AppTabsStore()
  /** 已注册的 main 面板：只为了让侧栏点击能派发，渲染为空。 */
  const panelDisposers = new Map<string, () => void>()

  /**
   * 是否处于"应用 + 助手"并排。
   *
   * 应用不再是 main 面板：会话常驻在右侧，应用占左半边。这样用户能一边
   * 看业务页面一边和助手说话。main 始终是会话，所以 selectPanel(null)。
   */
  let split = false
  /**
   * 侧栏是不是被这次分栏收起的。
   *
   * 只还原自己收起的那次：用户本来就把侧栏收着，回到工作台时不该替他展开。
   */
  let sidebarHiddenBySplit = false


  /** 侧栏当前是否收起（官方 frame 上的稳定标记）。 */
  const sidebarCollapsed = (): boolean =>
    document.querySelector('[data-sidebar-collapsed]') !== null

  const setSplit = (on: boolean): void => {
    if (split === on) return
    split = on
    const root = document.documentElement
    if (on) root.dataset.solarSplit = ''
    else delete root.dataset.solarSplit
    // 看应用时收起左侧那列应用列表：它占 264px，不收的话应用和助手都被挤扁。
    // 跨应用切换由标签栏承担，侧栏不是唯一入口。
    if (on) {
      if (!sidebarCollapsed()) {
        ctx.layout.toggleSidebar()
        sidebarHiddenBySplit = true
      }
    } else if (sidebarHiddenBySplit) {
      if (sidebarCollapsed()) ctx.layout.toggleSidebar()
      sidebarHiddenBySplit = false
    }
    syncGeometry()
  }

  /** 打开工作台：收起应用面板，会话占满，并回到控制台会话。 */
  const openWorkbench = (): void => {
    // 取消可能在途的应用切换：用户已经回到工作台，不该再被拉走。
    appNavigation += 1
    tabs.activate(WORKBENCH_TAB_ID)
    ctx.layout.selectPanel(null)
    setSplit(false)
    restoreConsoleSession()
  }

  /**
   * 打开一个应用：新增标签、并排显示，并把助手切到该应用最近的会话。
   *
   * 会话切换是异步的（要先解析工作区），所以用递增的令牌取消过期请求：
   * 用户连点两个应用时，只应该停在最后点的那个上。
   */
  const openApp = (app: SolarApp): void => {
    const panelId = `solar-app-${app.id}`
    // 从工作台进入应用前记住控制台会话，回工作台时恢复。
    if (tabs.getSnapshot().activeId === WORKBENCH_TAB_ID) rememberConsoleSession()
    tabs.open({ id: panelId, label: app.name, pinned: false, appId: app.id })
    // 会话必须留在 main 里，否则右半边没东西可看。
    ctx.layout.selectPanel(null)
    setSplit(true)
    const token = ++appNavigation
    void openAppSession(app, token).catch((reason: unknown) => {
      console.warn('[solar] 打开应用工作区失败：', reason)
    })
  }

  // ── 应用即工作区 ──────────────────────────────────────────────
  //
  // 每个应用对应一个宿主工作区：会话归属到该工作区，打开应用时助手自动
  // 带出这个应用最近的会话。DSH 的会话列表本来就按工作区分组，侧栏因此
  // 天然按应用分组，不需要另造一套分组界面。
  const bindings = new AppWorkspaceStore()
  let appNavigation = 0

  /** 这些服务由其他插件提供；缺失时降级为"只切应用、不切会话"。 */
  const workspaceApi = (): WorkspacesLike | undefined =>
    (ctx as unknown as { workspaces?: WorkspacesLike }).workspaces
  const sessionApi = (): SessionsLike | undefined =>
    (ctx as unknown as { sessions?: SessionsLike }).sessions
  const uiWorkspaceApi = (): UiWorkspaceLike | undefined =>
    (ctx as unknown as { uiWorkspace?: UiWorkspaceLike }).uiWorkspace
  /**
   * 让网关准备一个应用工作区目录。
   *
   * 宿主只接受已存在的目录，而 Web 宿主的目录选择器没有 list/create 能力，
   * 浏览器侧建不了目录；网关和宿主同机，由它建。
   * @param slug 单段目录名，例如 hrm
   * @returns 绝对路径；失败时 undefined
   */
  const ensureAppDirectory = async (
    slug: string,
    app: SolarApp,
  ): Promise<string | undefined> => {
    try {
      const query = new URLSearchParams({ slug, name: app.name, path: app.path })
      const response = await fetch(`/solar-api/app-workspace?${query.toString()}`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!response.ok) return undefined
      const payload: unknown = await response.json()
      if (payload === null || typeof payload !== 'object') return undefined
      const path = (payload as { path?: unknown }).path
      return typeof path === 'string' && path !== '' ? path : undefined
    } catch {
      return undefined
    }
  }

  const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

  /** 轮询等待一个条件成立，避免在快照还没到位时做出错误判断。 */
  const waitFor = async (ready: () => boolean, attempts = 50): Promise<boolean> => {
    for (let index = 0; index < attempts; index += 1) {
      if (ready()) return true
      await sleep(100)
    }
    return ready()
  }

  const workspaceById = (workspaceId: string): WorkspaceViewLike | undefined =>
    workspaceApi()?.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)

  /** 解析（必要时创建）一个应用对应的工作区。 */
  const ensureAppWorkspace = async (app: SolarApp): Promise<AppWorkspaceBinding | undefined> => {
    const workspaces = workspaceApi()
    if (workspaces === undefined) return undefined
    // 每次都重走一遍目录准备：它同时刷新工作区里的 AGENTS.md（应用上下文包）。
    // 权限变了、场景改了，下一次打开应用就生效，不需要用户清缓存或重建会话。
    const directory = await ensureAppDirectory(appDirectoryName(app.path, app.id), app)
    if (directory === undefined) return undefined
    const cached = bindings.get(app.id)
    if (cached !== undefined
      && cached.path === directory
      && workspaceById(cached.workspaceId) !== undefined) return cached
    // 工作区被用户删了，或落脚目录换了：绑定失效，重新解析。
    if (cached !== undefined) bindings.delete(app.id)
    const created = await workspaces.create({ path: directory })
    if (created.title !== app.name) {
      // 标题默认取目录名（hrm）。改成应用名，侧栏分组才读得懂；
      // 重名说明别的分组占了这个标题，保持目录名即可，不打断打开流程。
      try {
        await workspaces.rename(created.workspaceId, app.name)
      } catch {
        // 保持目录名。
      }
    }
    const binding: AppWorkspaceBinding = { workspaceId: created.workspaceId, path: directory }
    bindings.set(app.id, binding)
    return binding
  }

  /** 把助手切到该应用的工作区会话。 */
  const openAppSession = async (app: SolarApp, token: number): Promise<void> => {
    const api = uiWorkspaceApi()
    const sessions = sessionApi()
    if (api === undefined) return
    if (sessions === undefined) return
    if (workspaceApi() === undefined) return
    const binding = await ensureAppWorkspace(app)
    if (binding === undefined || token !== appNavigation) return
    // 工作区与会话列表都来自流式快照，刚建好的工作区可能还没到。
    await waitFor(() => workspaceById(binding.workspaceId) !== undefined, 20)
    await waitFor(() => sessions.list.getSnapshot().phase === 'ready')
    if (token !== appNavigation) return
    const workspace = workspaceById(binding.workspaceId)
    const snapshot = sessions.list.getSnapshot()
    const archived = workspaceApi()?.list.getSnapshot().archivedSessionIds ?? []
    const picked = pickSessionForApp(binding, workspace, snapshot.byId, archived)
    // 这个应用还没聊过：给它开一个空会话，而不是借用别的应用的上下文。
    const sessionId = picked ?? await api.connectWorkspace(binding.workspaceId)
    if (token !== appNavigation) return
    api.openSession(sessionId)
    bindings.set(app.id, { ...binding, lastSessionId: sessionId })
  }

  /** 记下当前主会话，供回到工作台时恢复。 */
  const rememberConsoleSession = (): void => {
    const current = readCurrentSession()
    if (current === undefined) return
    try {
      localStorage.setItem(CONSOLE_SESSION_KEY, current)
    } catch {
      // 隐私模式：这次会话内不记忆，不影响功能。
    }
  }

  /** 回到工作台时恢复控制台会话。 */
  const restoreConsoleSession = (): void => {
    const api = uiWorkspaceApi()
    const sessions = sessionApi()
    if (api === undefined || sessions === undefined) return
    let saved: string | undefined
    try {
      saved = localStorage.getItem(CONSOLE_SESSION_KEY) ?? undefined
    } catch {
      saved = undefined
    }
    if (saved === undefined) return
    // 会话可能已被删除；不存在就别把界面切到一个打不开的地址。
    if (sessions.list.getSnapshot().byId[saved] === undefined) return
    api.openSession(saved)
  }

  /** 关闭标签；关掉当前标签时切到相邻标签。 */
  const closeTab = (tab: AppTab): void => {
    const nextId = tabs.close(tab.id)
    if (nextId === WORKBENCH_TAB_ID) {
      openWorkbench()
      return
    }
    const next = tabs.getSnapshot().tabs.find(item => item.id === nextId)
    const nextApp = next?.appId === undefined
      ? undefined
      : apps.getSnapshot().apps.find(app => app.id === next.appId)
    if (nextApp !== undefined) {
      openApp(nextApp)
    } else {
      openWorkbench()
    }
  }

  // 每个应用仍注册一个 main 面板，但只渲染空占位。
  //
  // 官方侧栏的每一行都会 `selectPanel(id)`，id 不在 main 注册表里就抛错，
  // 所以面板必须存在。真正的显示交给 overlay 的分栏：选中面板后立刻回到
  // 会话（见 syncFromPanel），应用以左半边的形式出现。
  const registerPanel = (appId: string): void => {
    const panelId = `solar-app-${appId}`
    if (panelDisposers.has(panelId)) return
    panelDisposers.set(panelId, ctx.slots.register({
      name: 'main',
      key: panelId,
      locale: NS,
    }, SolarPlaceholder))
  }

  // 常驻标签栏：挂在 shell.overlay 上，切到对话界面也可见。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'solar-workspace-tabs',
    locale: NS,
    inject: (): WorkspaceTabBarProps => ({
      tabs,
      apps,
      openWorkbench,
      openApp,
      closeTab,
      assistant,
      toggleAssistant,
      t,
    }),
  }, WorkspaceTabBar))

  // iframe 常驻层：同样挂 overlay，避免切回工作台时被卸载。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'solar-workspace-frames',
    locale: NS,
    inject: (): SolarWorkspaceInjected => ({
      apps,
      tabs,
      openWorkbench,
      openApp,
      closeTab,
    }),
  }, SolarFrames))

  // 侧栏：每个应用一个入口。
  const sidebarDisposers = new Map<string, () => void>()
  const syncSidebar = (): void => {
    const list = apps.getSnapshot().apps
    const wanted = new Set(list.map(app => app.id))
    for (const [id, dispose] of sidebarDisposers) {
      if (wanted.has(id)) continue
      dispose()
      sidebarDisposers.delete(id)
      // 权限被收回：连同标签一起移除。
      const { removed, activeId } = tabs.removeApp(id)
      if (removed && activeId === WORKBENCH_TAB_ID) openWorkbench()
    }
    for (const app of list) {
      if (sidebarDisposers.has(app.id)) continue
      registerPanel(app.id)
      sidebarDisposers.set(app.id, ctx.slots.register({
        name: 'sidebar.panellist',
        id: `solar-app-${app.id}`,
        order: typeof app.sort === 'number' ? app.sort : 100,
        label: () => app.name,
        locale: NS,
        // 只给图标数据：点击由官方侧栏的 panelRow 按面板 id 派发，
        // 组件自己不再挂 onClick。
        inject: () => ({ app }),
      }, SolarAppIcon))
    }
  }

  apps.subscribe(syncSidebar)
  void apps.refresh().then(() => {
    syncSidebar()
    restoreFromUrl()
    restoreActiveTab()
    syncUrl()
  })

  /**
   * 把当前激活标签与应用内路由写进外层地址栏。
   *
   * 不这样做的话地址永远是 `/`：用户没法把"我正在看的员工详情"发给同事，
   * 也没法收藏。用 query 而不是 hash——hash 被管理端自己的路由占用了，
   * 而且外层是 agent 的地址，改 hash 可能干扰 agent 自己的导航。
   */
  function syncUrl(): void {
    if (typeof window === 'undefined') return
    const state = tabs.getSnapshot()
    const active = state.tabs.find(tab => tab.id === state.activeId)
    const url = new URL(window.location.href)
    if (active?.appId === undefined) {
      url.searchParams.delete('app')
      url.searchParams.delete('route')
    } else {
      url.searchParams.set('app', active.appId)
      // 只记录落在该应用边界内的路由。越界时管理端会把用户弹回应用首页，
      // 而 iframe 里那次 hash 变化仍会被监听到；照抄它会让地址栏与
      // 实际显示的页面不一致，分享出去的链接也就指向了错误页面。
      const app = apps.getSnapshot().apps.find(item => item.id === active.appId)
      const route = active.route
      const inBounds = app !== undefined
        && route !== undefined
        && (route === app.path || route.startsWith(`${app.path}/`))
      if (inBounds) {
        url.searchParams.set('route', route)
      } else {
        url.searchParams.delete('route')
      }
    }
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, '', url.href)
    }
  }

  /**
   * 从外层地址恢复深链接。
   *
   * 只接受应用目录里真实存在的应用；路由必须落在该应用前缀下，
   * 否则忽略——避免用地址把标签带到别的应用。
   */
  function restoreFromUrl(): void {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const appId = params.get('app')
    if (appId === null) return
    const app = apps.getSnapshot().apps.find(item => item.id === appId)
    if (app === undefined) return
    const route = params.get('route')
    const panelId = `solar-app-${app.id}`
    const valid = route !== null && route.startsWith(`${app.path}/`) ? route : undefined
    tabs.open({
      id: panelId,
      label: app.name,
      pinned: false,
      appId: app.id,
      ...(valid === undefined ? {} : { route: valid }),
    })
    if (panelDisposers.has(panelId)) ctx.layout.selectPanel(panelId as never)
  }

  // 标签或路由变化后同步地址栏。
  ctx.effect(() => {
    const unsubscribe = tabs.subscribe(syncUrl)
    return () => { unsubscribe() }
  }, 'solar-apps: address sync')

  /**
   * 恢复上次打开的标签对应的面板。
   *
   * 标签 store 已从 localStorage 读回列表，这里等应用目录与面板注册都
   * 就绪后再把选中面板对齐过去；否则刷新后标签栏显示着上次的应用，
   * 界面却停在对话页。权限被回收的应用不再自动打开。
   */
  function restoreActiveTab(): void {
    const state = tabs.getSnapshot()
    if (state.activeId === WORKBENCH_TAB_ID) return
    const appId = state.tabs.find(tab => tab.id === state.activeId)?.appId
    if (appId === undefined) return
    if (!apps.getSnapshot().apps.some(app => app.id === appId)) {
      tabs.activate(WORKBENCH_TAB_ID)
      return
    }
    // 恢复时走完整的打开流程：除了进入分栏，还要确保工作区目录与
    // 应用上下文包（AGENTS.md）就位，并把助手切到该应用最近的会话。
    const app = apps.getSnapshot().apps.find(item => item.id === appId)
    if (app === undefined) {
      setSplit(true)
      ctx.layout.selectPanel(null)
      return
    }
    openApp(app)
  }

  // 侧栏点击走官方 selectPanel(id)。面板 id 与应用一一对应，
  // 这里只负责把标签激活到同一个应用，不再二次切换面板。
  let redirecting = false
  const syncFromPanel = (): void => {
    const active = ctx.layout.panelInfo.getSnapshot().activePanelId
    if (active === null || !active.startsWith('solar-app-')) return
    if (redirecting) return
    const appId = active.slice('solar-app-'.length)
    const app = apps.getSnapshot().apps.find(item => item.id === appId)
    if (app === undefined) return
    // 侧栏点击最终选中了这个面板。应用不渲染在 main 里，所以立刻回到
    // 会话（main 保持对话），并让应用以左半边出现。
    redirecting = true
    try {
      openApp(app)
    } finally {
      redirecting = false
    }
  }
  ctx.effect(() => {
    const unsubscribe = ctx.layout.panelInfo.subscribe(syncFromPanel)
    return () => { unsubscribe() }
  }, 'solar-apps: sidebar selection')

  ctx.effect(() => {
    return () => {
      for (const dispose of sidebarDisposers.values()) dispose()
      sidebarDisposers.clear()
      for (const dispose of panelDisposers.values()) dispose()
      panelDisposers.clear()
    }
  }, 'solar-apps: registration teardown')
}

/**
 * 助手栏（会话）至少要留出的宽度。
 *
 * DSH 的会话面板低于 640 会退化（标题栏丢标题、输入框工具栏换行）；
 * 但应用侧栏放回来之后，助手再占 640 就把业务表格压没了，
 * 折中到 520：会话仍可读，应用窗格还留得住一张表。
 */
const MIN_ASSISTANT_WIDTH = 520
/**
 * 应用窗格的目标宽度。
 *
 * 管理端自己按 768px 断点判断"是不是窄屏"：低于它会把侧栏收进抽屉、
 * 页面切到移动端排版。应用窗格必须让开这个断点，否则原生侧栏根本不出现。
 */
const PREFERRED_APP_WIDTH = 768
/** 应用窗格的最小可接受宽度。 */
const MIN_APP_WIDTH = 520

/**
 * 算出应用窗格该占多宽。
 *
 * 优先保证应用窗格过桌面断点（原生侧栏才在），助手拿剩下的；
 * 剩下不够就退到按比例分。两边都不够时不要硬分：应用占满中栏，
 * 会话通过「Workbench」标签切回——比并排两个都看不清可用。
 * @param center 中栏宽度
 * @returns 应用窗格宽度
 */
function splitWidthFor(center: number): number {
  const available = center - MIN_ASSISTANT_WIDTH
  if (available < MIN_APP_WIDTH) return Math.round(center)
  const preferred = Math.max(available, PREFERRED_APP_WIDTH)
  return Math.round(Math.min(preferred, center - 360))
}

/** 应用工作区绑定持久化用的键（与 tabs 一致的前缀）。 */
const CONSOLE_SESSION_KEY = 'solar-workspace:console-session'

/** 工作区列表里用得到的最小字段。 */
interface WorkspaceViewLike {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** 宿主工作区控制器（由 api-workspace-controller 插件提供）。 */
interface WorkspacesLike {
  readonly list: {
    getSnapshot(): {
      readonly items: readonly WorkspaceViewLike[]
      readonly archivedSessionIds: readonly string[]
      readonly phase: 'pending' | 'ready'
    }
  }
  create(input: { path: string }): Promise<WorkspaceViewLike>
  initializeDefault(signal?: AbortSignal): Promise<WorkspaceViewLike | undefined>
  rename(workspaceId: string, title: string): Promise<unknown>
}


/** 会话控制器（由 api-session-controller 插件提供）。 */
interface SessionsLike {
  readonly list: {
    getSnapshot(): {
      readonly byId: Readonly<Record<string, {
        readonly sessionId: string
        readonly updatedAt: number
        readonly blank: boolean
      }>>
      readonly phase: 'pending' | 'ready'
    }
  }
}

/** 工作区 UI 服务（由 client-ui-workspace 插件提供）。 */
interface UiWorkspaceLike {
  openSession(target: string): void
  connectWorkspace(workspaceId: string): Promise<string>
  listDirectory(path?: string): Promise<{ readonly home: string }>
  createDirectory(path: string, name: string): Promise<string>
}

/**
 * 读出当前主会话。
 *
 * 官方导航服务把当前选择持久化在 `dsh.sessions.current`，没有对外暴露
 * 读取接口；这是唯一能拿到"用户此刻在看哪个会话"的稳定位置。
 * @returns 会话 id；未选择时 undefined
 */
function readCurrentSession(): string | undefined {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const id = (parsed as { sessionId?: unknown }).sessionId
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}

/** 助手面板折叠状态的持久化键。 */
const ASSISTANT_COLLAPSED_KEY = 'solar-workspace:assistant-collapsed'

/**
 * 读一个布尔开关。
 * @param key 存储键
 * @returns 是否开启；缺失或不可读时 false
 */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/**
 * 写一个布尔开关。
 * @param key 存储键
 * @param value 是否开启
 */
function writeFlag(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // 隐私模式：本次会话内有效。
  }
}
