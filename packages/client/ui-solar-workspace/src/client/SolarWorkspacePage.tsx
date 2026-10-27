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
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SolarApp, SolarAppsStore } from './apps.ts'
import type { SolarWorkspaceKey } from './locales.ts'
import { appUrl } from './apps.ts'
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
  /**
   * 渲染位置。
   *
   * `inline`：并进会话头最左侧，会话可见时用——和会话标题同一行，不重叠。
   * `overlay`：浮在内容区顶部，应用标签激活时用（此时会话头不在）。
   */
  readonly variant?: 'overlay' | 'inline'
}

/** 完整 props。 */
export type SolarWorkspaceProps =
  PropsRuntime<'main'>
  & PropsLocale<'solarWorkspace'>
  & InjectFace<SolarWorkspaceInjected>

/**
 * 工作区面板占位。
 *
 * iframe 实际渲染在 shell.overlay 的常驻层里（见 SolarFrames）。这里只留
 * 一个透明占位：面板存在才能让 layout 保持"选中了某个应用"的状态，但不
 * 能带背景——否则会盖住 overlay 层，整个内容区变暗。
 * @param props 运行时、注入面与文案
 */
export function SolarWorkspace({ apps, tabs, t }: SolarWorkspaceProps) {
  const state = useSyncExternalStore(tabs.subscribe, tabs.getSnapshot, tabs.getSnapshot)
  const appState = useSyncExternalStore(apps.subscribe, apps.getSnapshot, apps.getSnapshot)
  const openedCount = state.tabs.filter(tab => tab.appId !== undefined).length

  if (openedCount > 0) {
    return <div className={css.placeholder} data-solar-workspace="" />
  }

  // 一个应用都没打开：给一句提示，避免空白。
  return (
    <div className={css.page} data-solar-workspace="">
      <div className={css.frames}>
        <div className={css.empty}>
          {appState.error !== undefined ? appState.error : t('emptyHint')}
        </div>
      </div>
    </div>
  )
}

/**
 * 应用 iframe 容器（常驻）。
 *
 * 挂在 `shell.overlay` 而不是工作区面板里：面板在切回工作台时会被卸载，
 * 挂在里面的 iframe 跟着销毁。overlay 是 shell 级的，切到对话页也还在。
 *
 * 停在工作台时用 `display: none` 隐藏而不是返回 null——返回 null 同样会
 * 卸载整棵子树。
 * @param props 应用目录与标签
 */
export function SolarFrames({ apps, tabs }: SolarWorkspaceInjected) {
  const state = useSyncExternalStore(tabs.subscribe, tabs.getSnapshot, tabs.getSnapshot)
  const appState = useSyncExternalStore(apps.subscribe, apps.getSnapshot, apps.getSnapshot)
  const appById = useMemo(
    () => new Map(appState.apps.map(app => [app.id, app])),
    [appState.apps],
  )

  const openedTabs = state.tabs.flatMap((tab) => {
    if (tab.appId === undefined) return []
    const app = appById.get(tab.appId)
    return app === undefined ? [] : [{ tab, app }]
  })
  const activeTab = state.tabs.find(tab => tab.id === state.activeId)
  const activeAppId = activeTab?.appId

  if (openedTabs.length === 0) {
    return null
  }

  return (
    <div
      className={css.frameLayer}
      data-solar-frames=""
      style={activeAppId === undefined ? { display: 'none' } : undefined}
    >
      <div className={css.frames}>
        {openedTabs.map(({ tab, app }) => (
          <SolarFrame
            key={app.id}
            app={app}
            visible={app.id === activeAppId}
            {...(tab.route === undefined ? {} : { initialRoute: tab.route })}
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
  app, visible, initialRoute, onRoute,
}: {
  readonly app: SolarApp
  readonly visible: boolean
  readonly initialRoute?: string
  readonly onRoute: (route: string) => void
}) {
  const [src] = useState(() => appUrl(app, initialRoute))
  return (
    <iframe
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
    const initial = read()
    if (initial !== '') onRoute(initial)
    // onLoad 可能因站内跳转再次触发，重复绑定会让回调累积。
    const marker = '__solarRouteWatched'
    const tagged = win as unknown as Record<string, boolean>
    if (tagged[marker] === true) return
    tagged[marker] = true
    win.addEventListener('hashchange', () => {
      const next = read()
      if (next !== '') onRoute(next)
    })
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
  tabs, apps, openWorkbench, openApp, closeTab, t, variant = 'overlay',
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

  // 会话可见时不画 overlay：标签此时并进会话头（inline），再画一条会压在
  // 会话标题上，两段文字叠在一起。
  const activeTab = state.tabs.find(tab => tab.id === state.activeId)
  if (variant === 'overlay' && activeTab?.appId === undefined) return null

  return (
    <div
      className={variant === 'inline' ? css.tabBarInline : css.tabBarOverlay}
      role="tablist"
      aria-label={t('tabsLabel')}
    >
      <div className={css.tabs}>
        {state.tabs.map((tab) => {
          const active = tab.id === state.activeId
          const label = tab.pinned ? t('workbench') : tab.label
          return (
            <div key={tab.id} className={css.tabWrap}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? css.tabActive : css.tab}
                onClick={() => {
                  if (tab.pinned) {
                    openWorkbench()
                    return
                  }
                  const app = tab.appId === undefined ? undefined : appById.get(tab.appId)
                  if (app !== undefined) openApp(app)
                }}
              >
                {label}
              </button>
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
      {variant === 'overlay' && <NotificationBell t={t} />}
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
