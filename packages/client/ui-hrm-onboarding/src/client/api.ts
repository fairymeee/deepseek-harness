/**
 * 建档草稿的读写。
 *
 * 页面与对话共用同一份草稿：这里只做 HTTP 调用，身份由同源 cookie 携带，
 * 请求体里没有用户/租户字段。版本不一致时服务端拒绝，页面据此提示重新读取，
 * 不能拿旧内容覆盖别人刚改过的字段。
 */

/** 一个字段的来源。 */
export interface DraftFieldSource {
  readonly sourceType?: string
  readonly sourceRef?: string | null
  readonly confidence?: number | null
  readonly status?: string
}

/** 一条字段冲突。 */
export interface DraftConflict {
  readonly fieldName?: string
  readonly values?: readonly { readonly value?: unknown; readonly sourceRef?: string | null }[]
}

/** 草稿。 */
export interface Draft {
  readonly id: number
  readonly taskId: string
  readonly targetDeptId?: number | null
  readonly status: number
  readonly version: number
  readonly fields?: Record<string, unknown>
  readonly sources?: Record<string, DraftFieldSource>
  readonly conflicts?: readonly DraftConflict[]
  readonly missingFields?: readonly string[]
  /** 需要用户在页面里填写的敏感字段（模型看不到原文）。 */
  readonly awaitingInputFields?: readonly string[]
  readonly confirmationValid?: boolean
  readonly readyForConfirmation?: boolean
  readonly updatedAt?: string
}

/** 读取失败。 */
export class DraftError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'DraftError'
  }
}

/**
 * 统一解析 Java 的 `{ code, msg, data }` 信封。
 * @param response fetch 响应
 * @returns data 字段
 * @throws DraftError 非 200 或业务码非 0
 */
async function unwrap<T>(response: Response): Promise<T> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new DraftError(`响应不是 JSON（HTTP ${response.status}）`, response.status)
  }
  if (payload === null || typeof payload !== 'object') {
    throw new DraftError('响应为空', response.status)
  }
  const record = payload as { code?: unknown; msg?: unknown; data?: unknown }
  if (record.code !== 0) {
    const message = typeof record.msg === 'string' && record.msg !== ''
      ? record.msg
      : `业务码 ${String(record.code)}`
    throw new DraftError(message, response.status)
  }
  return record.data as T
}

/** 请求头：同源 + JSON。 */
const HEADERS = { accept: 'application/json', 'tenant-id': '1', 'content-type': 'application/json' }

/**
 * 读取草稿。
 * @param id 草稿编号
 * @returns 草稿
 */
export async function fetchDraft(id: number): Promise<Draft> {
  const response = await fetch(`/admin-api/hrm/employee-agent-draft/get?id=${String(id)}`, {
    headers: { accept: 'application/json', 'tenant-id': '1' },
    credentials: 'same-origin',
  })
  return unwrap<Draft>(response)
}

/**
 * 合并字段。带预期版本，版本不一致会被服务端拒绝。
 * @param id 草稿编号
 * @param expectedVersion 当前版本
 * @param fields 要合并的字段
 * @returns 更新后的草稿
 */
export async function updateDraft(
  id: number, expectedVersion: number, fields: Record<string, unknown>,
): Promise<Draft> {
  const response = await fetch('/admin-api/hrm/employee-agent-draft/update', {
    method: 'PUT',
    headers: HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ id, expectedVersion, fields }),
  })
  return unwrap<Draft>(response)
}

/**
 * 写入敏感字段真实值。
 *
 * 这个入口刻意不对模型开放：模型只看得到占位符，真实值由用户在页面上输入。
 * @param id 草稿编号
 * @param expectedVersion 当前版本
 * @param fields 敏感字段真实值
 * @returns 更新后的草稿
 */
export async function writeSensitiveFields(
  id: number, expectedVersion: number, fields: Record<string, unknown>,
): Promise<Draft> {
  const response = await fetch('/admin-api/hrm/employee-agent-draft/sensitive-fields', {
    method: 'PUT',
    headers: HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ id, expectedVersion, fields }),
  })
  return unwrap<Draft>(response)
}

/**
 * 确认并创建员工。
 *
 * 服务端会再校验权限、草稿版本与必填项；这一步才真正产生业务写入。
 * @param id 草稿编号
 * @param expectedVersion 当前版本
 * @returns 确认后的草稿
 */
export async function confirmDraft(id: number, expectedVersion: number): Promise<Draft> {
  const response = await fetch('/admin-api/hrm/employee-agent-draft/confirm', {
    method: 'POST',
    headers: HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ id, expectedVersion }),
  })
  return unwrap<Draft>(response)
}
