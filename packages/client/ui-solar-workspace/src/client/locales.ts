/** Solar 工作台文案。 */
export const zh = {
  appsLabel: 'Solar 应用',
  workbench: '工作台',
  tabsLabel: '已打开的标签',
  closeTab: '关闭标签',
  newTab: '新建标签',
  emptyHint: '从左侧选择一个应用开始。',
  notifications: '通知',
  showAssistant: '展开助手',
  hideAssistant: '收起助手',
  history: '历史会话',
  newSession: '新建会话',
  settings: '设置',
  noNotifications: '暂无通知',
  openInNewTab: '新标签页打开',
  loading: '正在加载应用…',
  loadFailed: '应用列表加载失败',
  retry: '重试',
  empty: '当前账号没有可用的应用。',
}

export type SolarWorkspaceKey = keyof typeof zh

/** 英文文案。 */
export const en: Record<SolarWorkspaceKey, string> = {
  appsLabel: 'Solar apps',
  workbench: 'Workbench',
  tabsLabel: 'Open tabs',
  closeTab: 'Close tab',
  newTab: 'New tab',
  emptyHint: 'Pick an app from the sidebar to start.',
  notifications: 'Notifications',
  showAssistant: 'Show assistant',
  hideAssistant: 'Hide assistant',
  history: 'History',
  newSession: 'New session',
  settings: 'Settings',
  noNotifications: 'No notifications',
  openInNewTab: 'Open in new tab',
  loading: 'Loading apps…',
  loadFailed: 'Failed to load apps',
  retry: 'Retry',
  empty: 'No apps are available for this account.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Solar 工作台文案。 */
    solarWorkspace: SolarWorkspaceKey
  }
}
