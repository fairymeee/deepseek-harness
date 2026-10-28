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
import { SolarAppsStore, SolarMenuStore, type SolarApp } from './apps.ts'
import { AppTabsStore, WORKBENCH_TAB_ID, type AppTab } from './tabs.ts'
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

/** 需要官方 slot 注册表与面板导航。 */
export const inject = ['slots', 'layout', 'locale']

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
    ].join('\n')
    document.head.append(style)
    document.documentElement.dataset.solarShell = ''
    return () => {
      style.remove()
      delete document.documentElement.dataset.solarShell
    }
  }, 'solar-apps: shell layout')

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
    root.style.setProperty('--solar-split-width', `${splitWidthFor(center)}px`)
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
  const menus = new SolarMenuStore()
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

  /** 打开工作台：收起应用面板，会话占满。 */
  const openWorkbench = (): void => {
    tabs.activate(WORKBENCH_TAB_ID)
    ctx.layout.selectPanel(null)
    setSplit(false)
  }

  /** 打开一个应用：新增标签并并排显示。 */
  const openApp = (app: SolarApp): void => {
    const panelId = `solar-app-${app.id}`
    tabs.open({ id: panelId, label: app.name, pinned: false, appId: app.id })
    // 会话必须留在 main 里，否则右半边没东西可看。
    ctx.layout.selectPanel(null)
    setSplit(true)
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
      menus,
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
  void menus.refresh()
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
    // 应用不再渲染在 main 里：恢复时直接进入分栏，会话留在右半边。
    setSplit(true)
    ctx.layout.selectPanel(null)
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

/** 助手栏（会话）至少要留出的宽度。DSH 的会话面板低于这个宽度会退化：
 *  标题栏丢标题、输入框工具栏换行溢出。 */
const MIN_ASSISTANT_WIDTH = 640
/** 应用窗格的目标最小宽度。 */
const MIN_APP_WIDTH = 480

/**
 * 算出应用窗格该占多宽。
 *
 * 侧栏在分栏时会收起，中栏通常就是整个窗口宽度。两边都不够时不要硬分：
 * 应用占满中栏，会话通过「Workbench」标签切回——比并排两个都看不清可用。
 * @param center 中栏宽度
 * @returns 应用窗格宽度
 */
function splitWidthFor(center: number): number {
  const available = center - MIN_ASSISTANT_WIDTH
  if (available < MIN_APP_WIDTH) return Math.round(center)
  return Math.round(Math.min(Math.max(center * 0.55, MIN_APP_WIDTH), available))
}
