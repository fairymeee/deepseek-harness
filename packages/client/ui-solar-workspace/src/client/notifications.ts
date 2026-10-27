/**
 * 通知：从管理端顶栏移植到 agent 外壳。
 *
 * 用户在内嵌应用里工作，通知应出现在外壳上而不是被 iframe 挡住。
 * 直接复用管理端的消息接口，字段名以 Java 返回为准。
 */

/** 一条站内消息。 */
export interface NotifyMessage {
  readonly id: number
  readonly title: string
  readonly content: string
  readonly readStatus?: boolean
}

/** 管理端消息接口的一行（只声明用到的字段）。 */
interface RawMessage {
  readonly id?: unknown
  readonly templateNickname?: unknown
  readonly templateContent?: unknown
  readonly readStatus?: unknown
  readonly templateParams?: unknown
}

/** 从模板参数里取跳转路由，没有就忽略。 */
function routeOf(params: unknown): string | undefined {
  if (params === null || typeof params !== 'object') return undefined
  const route = (params as Record<string, unknown>).route
  return typeof route === 'string' ? route : undefined
}

/**
 * 拉取未读消息。
 *
 * 失败时返回空列表：通知是附属信息，不该让外壳报错。
 * @returns 消息列表
 */
export async function fetchNotifications(): Promise<readonly NotifyMessage[]> {
  try {
    const response = await fetch('/admin-api/system/notify-message/my-page?pageNo=1&pageSize=20', {
      headers: { accept: 'application/json', 'tenant-id': '1' },
      credentials: 'same-origin',
    })
    const payload: unknown = await response.json()
    if (payload === null || typeof payload !== 'object') return []
    const record = payload as { code?: unknown; data?: unknown }
    if (record.code !== 0) return []
    const data = record.data
    if (data === null || typeof data !== 'object') return []
    const list = (data as { list?: unknown }).list
    if (!Array.isArray(list)) return []
    const messages: NotifyMessage[] = []
    for (const item of list as RawMessage[]) {
      if (item === null || typeof item !== 'object') continue
      if (typeof item.id !== 'number') continue
      messages.push({
        id: item.id,
        title: typeof item.templateNickname === 'string' ? item.templateNickname : '',
        content: typeof item.templateContent === 'string' ? item.templateContent : '',
        ...(typeof item.readStatus === 'boolean' ? { readStatus: item.readStatus } : {}),
      })
      // 路由暂未用于跳转：点击只标已读，避免把用户带到未知页面。
      void routeOf(item.templateParams)
    }
    return messages
  } catch {
    return []
  }
}

/**
 * 标记一条消息已读。
 * @param id 消息编号
 */
export async function markNotificationRead(id: number): Promise<void> {
  try {
    await fetch(`/admin-api/system/notify-message/update-read?id=${String(id)}`, {
      method: 'PUT',
      headers: { 'tenant-id': '1' },
      credentials: 'same-origin',
    })
  } catch {
    // 已读状态失败不影响阅读；下次刷新会重新显示未读。
  }
}

/**
 * 未读数量。
 * @param list 消息列表
 * @returns 未读数
 */
export function unreadCount(list: readonly NotifyMessage[]): number {
  return list.filter(item => item.readStatus !== true).length
}
