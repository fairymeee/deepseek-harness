/**
 * Solar 工作区：应用标签 + 常驻 iframe。
 *
 * 结构分三块，挂在不同插槽上：
 *   - `main` 面板：只放占位，让 layout 保持"选中了某个应用"的状态；
 *   - `shell.overlay` 常驻层：真正的 iframe，切回工作台也不卸载；
 *   - `shell.overlay` 标签栏：跨应用常驻，切到对话界面也可见。
 *
 * 为什么 iframe 不放在 main 面板里：切回工作台会卸载该面板，iframe 跟着
 * 销毁，用户填到一半的表单就丢了。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SolarApp, SolarAppsStore, SolarMenuStore, AppMenuNode } from './apps.ts'
import type { SolarWorkspaceKey } from './locales.ts'
import { appMenuTree, appUrl, firstPagePath, menuChain } from './apps.ts'
import type { AppTab, AppTabsStore } from './tabs.ts'
import { WORKBENCH_TAB_ID } from './tabs.ts'
import {
  fetchNotifications, markNotificationRead, unreadCount, type NotifyMessage,
} from './notifications.ts'
import css from './SolarWorkspacePage.module.css'

/** 工作区面板 id。 */
export const WORKSPACE_PANEL = 'solar-workspace'

/** 注入面。 */
export interface SolarWorkspaceInjected {
  /** 应用目录 store（已按权限过滤）；组件内部订阅，不用快照。 */
  readonly apps: SolarAppsStore
  /** 菜单树 store：应用内页面导航。 */
  readonly menus: SolarMenuStore
  /** 标签 store。 */
  readonly tabs: AppTabsStore
  /** 切到工作台（对话界面）。 */
  readonly openWorkbench: () => void
  /** 打开一个应用标签。 */
  readonly openApp: (app: SolarApp) => void
  /** 关闭一个标签。 */
  readonly closeTab: (tab: AppTab) => void
}

/** 标签栏 props。 */
export interface WorkspaceTabBarProps {
  readonly tabs: AppTabsStore
  /** 应用目录 store；组件内部订阅，不用快照。 */
  readonly apps: SolarAppsStore
  readonly openWorkbench: () => void
  readonly openApp: (app: SolarApp) => void
  readonly closeTab: (tab: AppTab) => void
  readonly t: (key: SolarWorkspaceKey) => string
}

/** 完整 props。 */
export type SolarWorkspaceProps =
  PropsRuntime<'main'>
  & PropsLocale<'solarWorkspace'>
  & InjectFace<SolarWorkspaceInjected>

/**
 * main 面板的空占位。
 *
 * 应用不再渲染在 main 里：它显示在 overlay 的左半边，会话留在右半边。
 * 面板仍然要注册，否则官方侧栏的 `selectPanel(id)` 会抛错。
 */
export function SolarPlaceholder(): null {
  return null
}

/**
 * 应用面板（左侧）与页面导航。
 *
 * 会话常驻在右侧：切到应用时不是替换对话，而是把对话让到右半边、应用占
 * 左半边——用户可以一边看业务页面一边和助手说话，和 DeepClaw 一致。
 *
 * 应用内的页面导航由这里接管（管理端自己的侧栏在嵌入模式下隐藏），
 * 只保留内容区。
 * @param props 应用目录、菜单、标签
 */
export function SolarFrames({ apps, menus, tabs }: SolarWorkspaceInjected) {
  const state = useSyncExternalStore(tabs.subscribe, tabs.getSnapshot, tabs.getSnapshot)
  const appState = useSyncExternalStore(apps.subscribe, apps.getSnapshot, apps.getSnapshot)
  const menuState = useSyncExternalStore(menus.subscribe, menus.getSnapshot, menus.getSnapshot)
  const appById = useMemo(
    () => new Map(appState.apps.map(app => [app.id, app])),
    [appState.apps],
  )
  const frames = useRef(new Map<string, HTMLIFrameElement>())

  const openedTabs = state.tabs.flatMap((tab) => {
    if (tab.appId === undefined) return []
    const app = appById.get(tab.appId)
    return app === undefined ? [] : [{ tab, app }]
  })
  const activeTab = state.tabs.find(tab => tab.id === state.activeId)
  const activeAppId = activeTab?.appId
  const activeApp = activeAppId === undefined ? undefined : appById.get(activeAppId)
  const tree = useMemo(
    () => activeApp === undefined ? [] : appMenuTree(menuState, activeApp.path),
    [activeApp, menuState],
  )
  // 当前路由在菜单树里的祖先链：每一层决定下一行显示哪些同级菜单。
  const chain = useMemo(
    () => menuChain(tree, activeTab?.route ?? ''),
    [tree, activeTab?.route],
  )

  if (openedTabs.length === 0) {
    return null
  }

  /** 切换应用内页面：直接改 iframe 的 hash，由管理端路由接管。 */
  const navigate = (path: string): void => {
    if (activeAppId === undefined) return
    const frame = frames.current.get(activeAppId)
    if (frame?.contentWindow == null) return
    frame.contentWindow.location.hash = `#${path}`
  }

  // 一行一级菜单，逐层展开当前路径上的子菜单。
  // 只有第一行常驻；第二、三行只在当前页面属于某个分组时出现，
  // 这样大多数时候只有一行，不会把内容区挤掉。
  const rows: { nodes: readonly AppMenuNode[]; activePath?: string }[] = []
  const first = chain[0]
  if (tree.length > 0) rows.push({ nodes: tree, ...(first === undefined ? {} : { activePath: first.path }) })
  for (const [level, node] of chain.entries()) {
    if (node.children.length === 0) break
    const active = chain[level + 1]
    rows.push({ nodes: node.children, ...(active === undefined ? {} : { activePath: active.path }) })
  }

  return (
    <div
      className={css.frameLayer}
      data-solar-frames=""
      style={activeAppId === undefined ? { display: 'none' } : undefined}
    >
      {activeApp !== undefined && rows.length > 0 && (
        <nav className={css.pageStrip} aria-label={activeApp.name}>
          {rows.map((row, level) => (
            <div className={css.pageRow} key={level}>
              {row.nodes.map((node) => {
                const active = row.activePath === node.path
                return (
                  <button
                    key={node.path}
                    type="button"
                    className={active ? css.pageChipActive : css.pageChip}
                    title={node.name}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      const target = firstPagePath(node)
                      if (target !== '') navigate(target)
                    }}
                  >
                    {node.name}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      )}
      <div className={css.frames}>
        {openedTabs.map(({ tab, app }) => (
          <SolarFrame
            key={app.id}
            app={app}
            visible={app.id === activeAppId}
            {...(tab.route === undefined ? {} : { initialRoute: tab.route })}
            onMount={(element) => {
              if (element === null) frames.current.delete(app.id)
              else frames.current.set(app.id, element)
            }}
            onRoute={(route) => {
              // 只记录落在该应用边界内的路由。越界时管理端会把用户弹回
              // 应用首页，而那次 hash 变化仍会被监听到；把它记进标签会让
              // 状态里留下一个永远打不开的地址。
              if (route === app.path || route.startsWith(`${app.path}/`)) {
                tabs.setRoute(tab.id, route)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 一个应用 iframe。
 *
 * `src` 只在挂载时算一次：把当前路由写进 src 会让每次路由变化都重新加载
 * iframe，用户正在填的表单会被清空。之后的路由变化由 iframe 自己维护，
 * 外层只通过 `onRoute` 记录。
 */
function SolarFrame({
  app, visible, initialRoute, onRoute, onMount,
}: {
  readonly app: SolarApp
  readonly visible: boolean
  readonly initialRoute?: string
  readonly onRoute: (route: string) => void
  readonly onMount: (element: HTMLIFrameElement | null) => void
}) {
  const [src] = useState(() => appUrl(app, initialRoute))
  return (
    <iframe
      ref={onMount}
      className={css.frame}
      style={visible ? undefined : { visibility: 'hidden', position: 'absolute', inset: 0 }}
      title={app.name}
      src={src}
      // 同源，需要脚本与表单；不放开顶层导航与弹窗。
      sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
      onLoad={(event) => {
        syncAppearance(event.currentTarget)
        watchRoute(event.currentTarget, onRoute)
      }}
    />
  )
}

/**
 * 跟随 iframe 内部路由变化。
 *
 * 管理端用 hash 路由，同源所以能直接监听；把变化记进标签，外层地址栏
 * 才能反映"正在看哪个页面"，也让刷新后能回到同一页。
 *
 * 越界跳转（守卫把用户弹回应用首页）同样会触发 hashchange，这里不需要
 * 区分——记下来的就是用户最终看到的页面。
 * @param frame 目标 iframe
 * @param onRoute 路由变化回调
 */
function watchRoute(frame: HTMLIFrameElement, onRoute: (route: string) => void): void {
  try {
    const win = frame.contentWindow
    if (win === null) return
    const read = (): string => win.location.hash.replace(/^#/, '')
    const report = (): void => {
      const next = read()
      if (next !== '') onRoute(next)
    }
    const initial = read()
    if (initial !== '') onRoute(initial)
    // onLoad 可能因站内跳转再次触发，重复绑定会让回调累积。
    const marker = '__solarRouteWatched'
    const tagged = win as unknown as Record<string, boolean>
    if (tagged[marker] === true) return
    tagged[marker] = true
    win.addEventListener('hashchange', report)
    win.addEventListener('popstate', report)
    // vue-router 改地址走 history.pushState/replaceState，浏览器不会为它们
    // 派发 hashchange。应用内点菜单、路由守卫的越界重定向都是这条路，
    // 不接管的话外层记录的页面会一直停在最后一次手点的位置。
    const history = win.history as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method]
      if (original === undefined) continue
      const bound = original.bind(win.history)
      history[method] = (...args: unknown[]): unknown => {
        const result = bound(...args)
        report()
        return result
      }
    }
  } catch {
    // 跨源或尚未就绪：忽略，路由不会被记录。
  }
}

/**
 * 常驻标签栏（挂在 shell.overlay）。
 *
 * 放在 overlay 而不是工作区面板内部：切回工作台（对话）时标签栏必须
 * 仍然可见，否则用户没法从对话回到已打开的应用。
 * @param props 标签 store、应用目录与回调
 */
export function WorkspaceTabBar({
  tabs, apps, openWorkbench, openApp, closeTab, t,
}: WorkspaceTabBarProps) {
  const state = useSyncExternalStore(tabs.subscribe, tabs.getSnapshot, tabs.getSnapshot)
  const appState = useSyncExternalStore(apps.subscribe, apps.getSnapshot, apps.getSnapshot)
  const appById = useMemo(
    () => new Map(appState.apps.map(app => [app.id, app])),
    [appState.apps],
  )

  const onNewTab = (): void => {
    const opened = new Set(state.tabs.flatMap(tab => tab.appId === undefined ? [] : [tab.appId]))
    const next = appState.apps.find(app => !opened.has(app.id)) ?? appState.apps[0]
    if (next !== undefined) openApp(next)
  }

  return (
    <div className={css.tabBarOverlay} role="tablist" aria-label={t('tabsLabel')}>
      <div className={css.tabs}>
        {state.tabs.map((tab) => {
          const active = tab.id === state.activeId
          const label = tab.pinned ? t('workbench') : tab.label
          const activate = (): void => {
            if (tab.pinned) {
              openWorkbench()
              return
            }
            const app = tab.appId === undefined ? undefined : appById.get(tab.appId)
            if (app !== undefined) openApp(app)
          }
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              className={active ? css.tabActive : css.tab}
              title={label}
              onClick={activate}
              // 中键关闭：Chrome 的老习惯，用户会下意识去点。
              onAuxClick={(event) => {
                if (event.button !== 1 || tab.pinned) return
                event.preventDefault()
                closeTab(tab)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  activate()
                }
              }}
            >
              <span className={css.tabLabel}>{label}</span>
              {!tab.pinned && (
                <button
                  type="button"
                  className={css.tabClose}
                  aria-label={`${t('closeTab')} ${label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab)
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
        <button
          type="button"
          className={css.newTab}
          aria-label={t('newTab')}
          title={t('newTab')}
          onClick={onNewTab}
        >
          +
        </button>
      </div>
      <NotificationBell t={t} />
    </div>
  )
}

/**
 * 通知铃铛。
 *
 * 从管理端顶栏移植到 agent：用户在内嵌应用里工作，通知应出现在外壳上。
 * 点击展开最近消息，点一条标记已读。
 * @param props 文案
 */
function NotificationBell({ t }: { readonly t: (key: SolarWorkspaceKey) => string }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<readonly NotifyMessage[]>([])
  const unread = unreadCount(list)

  useEffect(() => {
    let alive = true
    void fetchNotifications().then((items) => { if (alive) setList(items) })
    return () => { alive = false }
  }, [])

  return (
    <div className={css.bellWrap}>
      <button
        type="button"
        className={css.bell}
        aria-label={t('notifications')}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className={css.badge}>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className={css.bellPanel} role="dialog" aria-label={t('notifications')}>
          {list.length === 0 && <p className={css.bellEmpty}>{t('noNotifications')}</p>}
          <ul className={css.bellList}>
            {list.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.readStatus === true ? css.bellItemRead : css.bellItem}
                  onClick={() => {
                    void markNotificationRead(item.id)
                    setList(previous => previous.map(entry =>
                      entry.id === item.id ? { ...entry, readStatus: true } : entry))
                  }}
                >
                  <span className={css.bellTitle}>{item.title}</span>
                  <span className={css.bellBody}>{item.content}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * 把 agent 当前的明暗与语言同步给内嵌页面。
 *
 * 主题与语言由 agent 统一管理，管理端不重复提供开关；这里在 iframe
 * 加载完成时推送一次，保证两边一致。只向同源 iframe 发送。
 * @param frame 目标 iframe
 */
export function syncAppearance(frame: HTMLIFrameElement): void {
  try {
    const dark = document.body.hasAttribute('data-ds-dark-theme')
      || document.documentElement.classList.contains('dark')
    const locale = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'
    frame.contentWindow?.postMessage({
      type: 'solar:appearance',
      payload: { colorScheme: dark ? 'dark' : 'light', locale },
    }, window.location.origin)
  } catch {
    // 跨源或尚未就绪：忽略，管理端会用自己的默认值。
  }
}

export { WORKBENCH_TAB_ID }
