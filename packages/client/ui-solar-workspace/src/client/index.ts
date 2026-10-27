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
import { SolarAppsStore, type SolarApp } from './apps.ts'
import { AppTabsStore, WORKBENCH_TAB_ID, type AppTab } from './tabs.ts'
import {
  SolarFrames, SolarWorkspace, WorkspaceTabBar,
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
  const t = ctx.locale.bind(NS)
  const apps = new SolarAppsStore()
  const tabs = new AppTabsStore()
  /** 已注册的 main 面板，用于判断某个应用面板是否可用。 */
  const panelDisposers = new Map<string, () => void>()

  /** 打开工作台：切到对话界面，标签栏保留已打开的应用。 */
  const openWorkbench = (): void => {
    tabs.activate(WORKBENCH_TAB_ID)
    ctx.layout.selectPanel(null)
  }

  /** 打开一个应用：新增标签并切到该应用的面板。 */
  const openApp = (app: SolarApp): void => {
    const panelId = `solar-app-${app.id}`
    // 先发布标签状态：即便下面的面板切换失败，标签栏也应反映用户的点击。
    tabs.open({ id: panelId, label: app.name, pinned: false, appId: app.id })
    // 面板可能尚未注册（应用目录刚刷新、侧栏还没同步到），此时
    // selectPanel 会抛错。标签已经打开，用户再点一次就能进入，
    // 所以这里只记录，不让异常打断事件处理。
    if (!panelDisposers.has(panelId)) {
      console.error(`[solar] panel ${panelId} not registered yet`)
      return
    }
    ctx.layout.selectPanel(panelId as never)
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

  // 每个应用注册一个 main 面板，都渲染同一个工作区组件。
  //
  // 为什么不是"一个面板 + 自己改选中态"：官方侧栏点击走
  // `selectPanel(id)`，id 必须能在 main 注册表里找到，否则整次切换失败。
  // 让面板 id 与侧栏入口 id 一一对应，点击才能生效；组件内部
  // 再按 id 决定显示哪个应用。
  const registerPanel = (appId: string): void => {
    const panelId = `solar-app-${appId}`
    if (panelDisposers.has(panelId)) return
    panelDisposers.set(panelId, ctx.slots.register({
      name: 'main',
      key: panelId,
      locale: NS,
      // 传 store 而不是 apps 快照：inject 只在注册时求值一次，而注册发生在
      // 应用目录拉取完成之前，快照会永久停在空数组上。组件内部订阅 store。
      inject: (): SolarWorkspaceInjected => ({
        apps,
        tabs,
        openWorkbench,
        openApp,
        closeTab,
      }),
    }, SolarWorkspace))
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
    const panelId = `solar-app-${appId}`
    if (panelDisposers.has(panelId)) ctx.layout.selectPanel(panelId as never)
  }

  // 侧栏点击走官方 selectPanel(id)。面板 id 与应用一一对应，
  // 这里只负责把标签激活到同一个应用，不再二次切换面板。
  const syncFromPanel = (): void => {
    const active = ctx.layout.panelInfo.getSnapshot().activePanelId
    if (active === null || !active.startsWith('solar-app-')) return
    const appId = active.slice('solar-app-'.length)
    const app = apps.getSnapshot().apps.find(item => item.id === appId)
    if (app === undefined) return
    // 只打开标签，不调用 selectPanel（避免和用户点击互相覆盖）。
    tabs.open({ id: active, label: app.name, pinned: false, appId: app.id })
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
