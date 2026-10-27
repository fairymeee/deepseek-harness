/**
 * 场景包工具：把"模型能用哪些能力"收敛成少量业务意图动作。
 *
 * 为什么不是把后台接口目录直接给模型：
 *   - 后台有一千多个 CRUD 接口，全量暴露既占上下文，也让模型倾向于拼凑请求；
 *   - 场景声明的是"能完成什么业务动作"，不是"能调哪个 URL"；
 *   - 权限判断留在服务端，场景配置不能扩大授权。
 *
 * 四个状态在这里的落点：
 *   installed / enabled / authorized —— 由 Java 的 /scenes 接口给出；
 *   loaded —— 本模块按任务记录，scene_invoke 只接受已载入场景里的动作。
 *
 * 身份边界：用户令牌与任务号由宿主按会话注入环境变量，工具参数里没有任何
 * 身份字段。模型只能选动作和填业务参数。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 工具名。 */
export const name = 'scene-tools'

/** 依赖的宿主服务。 */
export const inject = ['tools']

/**
 * 不声明 Config。
 *
 * 宿主把 Java 地址与用户令牌按会话注入环境变量，插件直接读即可；
 * 声明 Config 需要 Schemastery schema（带 validate 的对象），而企业插件
 * 目录不在包依赖里，为一个地址引一套配置校验不划算。
 */

/**
 * 每个任务已载入的场景。
 *
 * key 是任务标识，value 是"工具标识 → 场景标识"的映射。载入只影响本任务，
 * 任务结束随进程回收；不做持久化，避免旧场景在新任务里静默生效。
 */
const loadedByTask = new Map()

/**
 * 读取当前任务标识。
 *
 * @param exec 工具执行上下文
 * @returns 任务标识；拿不到时返回 null
 */
function currentTaskId(exec) {
  const agent = exec?.agent
  const id = agent?.id
  return typeof id === 'string' && id !== '' ? id : null
}

/**
 * 读取用户令牌。
 *
 * @returns 令牌；未配置时返回空串
 */
function userToken() {
  const token = process.env.SOLAR_USER_TOKEN
  return typeof token === 'string' ? token : ''
}

/**
 * 调用 Java 接口。
 *
 * 转发的是用户自己的令牌：权限与审计和浏览器里点页面完全一致。
 *
 * @param config 插件配置
 * @param path 路径，例如 /admin-api/system/agent/tools/scenes
 * @param init fetch 选项
 * @returns 解析后的 data 字段
 * @throws Error 网络失败、非 200、业务码非 0
 */
async function callJava(path, init = {}) {
  const base = (process.env.SOLAR_JAVA_BASE_URL ?? '').replace(/\/$/, '')
  if (base === '') throw new Error('javaBaseUrl 未配置')
  const token = userToken()
  if (token === '') throw new Error('缺少用户令牌')

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'tenant-id': process.env.SOLAR_TENANT_ID ?? '1',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Java 返回 HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`Java 返回了非 JSON 响应: ${text.slice(0, 120)}`)
  }
  if (payload?.code !== 0) {
    throw new Error(payload?.msg ?? `业务码 ${String(payload?.code)}`)
  }
  return payload.data
}

/**
 * 把任意结构渲染成模型可读的文本。
 *
 * @param value 工具返回值
 * @returns 内容块
 */
function renderJson(value) {
  return [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }]
}

/**
 * 挂载场景工具。
 *
 * @param ctx 宿主上下文
 * @param config 插件配置
 */
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'scene_list',
    description:
      '列出当前用户可用的业务场景，以及每个场景里的动作。'
      + '先调用它确认能做什么；返回的工具需要先 scene_load 才能调用。',
    parameters: {},
    output: {
      schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
      render: (_args, value) => renderJson(value),
    },
    async execute() {
      const scenes = await callJava('/admin-api/system/agent/tools/scenes')
      return Array.isArray(scenes) ? scenes : []
    },
  }))

  ctx.tools.register(defineTool({
    name: 'scene_load',
    description:
      '载入一个业务场景，之后才能调用它里面的动作。'
      + '同一任务重复载入返回同样的工具列表；载入不会创建或修改任何业务数据。',
    parameters: {
      scene: { type: 'string', required: true, description: '场景标识，取自 scene_list 的 code' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const taskId = currentTaskId(exec)
      if (taskId === null) throw new Error('无法确定当前任务')

      const scenes = await callJava('/admin-api/system/agent/tools/scenes')
      const scene = (Array.isArray(scenes) ? scenes : []).find(item => item?.code === args.scene)
      if (scene === undefined) {
        throw new Error(`场景不可用：${String(args.scene)}。先调用 scene_list 看可用场景。`)
      }

      const loaded = loadedByTask.get(taskId) ?? new Map()
      for (const tool of scene.tools ?? []) {
        if (typeof tool?.code === 'string') loaded.set(tool.code, scene.code)
      }
      loadedByTask.set(taskId, loaded)

      return {
        scene: scene.code,
        version: scene.version,
        tools: (scene.tools ?? []).map(tool => ({
          code: tool.code,
          name: tool.name,
          description: tool.description,
          riskLevel: tool.riskLevel,
          // 把参数契约一并给出：没有它模型只能猜参数名。
          // 标了 x-source=task 的字段由运行时注入，不需要也不允许提供。
          inputSchema: parseSchema(tool.inputSchema),
          // 有对应界面的动作会带这个标识：调用成功后客户端据此打开业务页面。
          ...(typeof tool.resultSurface === 'string' && tool.resultSurface !== ''
            ? { surface: tool.resultSurface }
            : {}),
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'scene_invoke',
    description:
      '调用已载入场景中的一个动作。只能调用 scene_load 返回过的动作；'
      + '参数按该动作自己的说明填写。写操作完成后应重新读取草稿再向用户汇报。',
    parameters: {
      tool: { type: 'string', required: true, description: '动作标识，取自 scene_load 返回的 tools' },
      arguments: { type: 'object', additionalProperties: true, description: '动作参数；无参数时省略' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const taskId = currentTaskId(exec)
      if (taskId === null) throw new Error('无法确定当前任务')

      const loaded = loadedByTask.get(taskId)
      const sceneCode = loaded?.get(args.tool)
      if (sceneCode === undefined) {
        // 未载入的动作一律拒绝：场景名不能当万能通行证。
        throw new Error(`动作未载入：${String(args.tool)}。先 scene_load 对应场景。`)
      }

      const scenes = await callJava('/admin-api/system/agent/tools/scenes')
      const scene = (Array.isArray(scenes) ? scenes : []).find(item => item?.code === sceneCode)
      const tool = (scene?.tools ?? []).find(item => item?.code === args.tool)
      if (tool === undefined) {
        // 载入后权限被收回或场景被停用：按不可用处理，不放行。
        throw new Error(`动作当前不可用：${String(args.tool)}。可能权限已变更，请重新 scene_list。`)
      }

      const body = args.arguments ?? {}
      const schema = parseSchema(tool.inputSchema)
      const problems = validateAgainst(schema, body)
      if (problems.length > 0) {
        // 参数不合契约就拒绝，不转发。实测不校验时模型会反复猜参数名，
        // 还会用编造的 id 建出垃圾数据。
        throw new Error(`参数不符合该动作的契约：${problems.join('；')}`)
      }

      const method = String(tool.httpMethod ?? 'GET').toUpperCase()
      const endpoint = String(tool.endpoint ?? '')
      if (!endpoint.startsWith('/admin-api/')) {
        throw new Error(`动作配置异常：endpoint 必须是 /admin-api/ 开头，实际为 ${endpoint}`)
      }

      // 任务号由运行时注入：它标识"这次对话"，不是业务参数，模型不该编造。
      const payload = { ...body, ...injectTaskFields(schema, taskId) }

      const result = method === 'GET'
        ? await callJava((() => {
          const query = new URLSearchParams()
          for (const [key, value] of Object.entries(payload)) {
            if (value !== undefined && value !== null) query.set(key, String(value))
          }
          const suffix = query.toString() === '' ? '' : `?${query.toString()}`
          return `${endpoint}${suffix}`
        })())
        : await callJava(endpoint, { method, body: JSON.stringify(payload) })

      const shaped = applyView(result, tool.resultView)
      return withSurface(shaped, tool.resultSurface, taskId)
    },
  }))
}

/** 字段的中文名，用于把结果翻译成业务语言。 */
const FIELD_LABELS = {
  name: '姓名', mobile: '手机号', email: '邮箱', sex: '性别', birthday: '生日',
  idType: '证件类型', idNumber: '证件号', highestEducation: '最高学历',
  entryStatus: '入职状态', type: '员工类型', entryTime: '入职日期',
  probation: '试用期月数', postName: '岗位名称', postLevel: '岗位职级',
  workCity: '工作城市', workAddress: '工作地址', jobNumber: '工号', remark: '备注',
  // 不是员工字段但会出现在缺失项里
  targetDeptId: '部门',
  attachments: '附件',
}

/**
 * 把字段名翻成中文。
 * @param key 字段键
 * @returns 中文名；没有映射时原样返回
 */
function labelOf(key) {
  return FIELD_LABELS[key] ?? key
}

/**
 * 把建档草稿整形为面向业务的形状。
 *
 * Java 返回的是接口结构（status 数字码、readyForConfirmation、
 * missingFields 等）。模型会把这些英文键原样写进回复，用户看不懂。
 * 这里只留业务上真正需要的信息，并附一句现成的话，模型通常直接沿用。
 *
 * @param draft Java 返回的草稿
 * @returns 面向业务的结果
 */
function viewHrmDraft(draft) {
  const missing = Array.isArray(draft.missingFields) ? draft.missingFields : []
  const awaiting = Array.isArray(draft.awaitingInputFields) ? draft.awaitingInputFields : []
  const conflicts = Array.isArray(draft.conflicts) ? draft.conflicts : []
  const confirmed = draft.confirmationValid === true
  const ready = draft.readyForConfirmation === true

  const parts = []
  if (confirmed) parts.push('这份草稿你已经确认过')
  if (missing.length > 0) parts.push(`还差${missing.map(labelOf).join('、')}`)
  if (awaiting.length > 0) parts.push(`有${awaiting.map(labelOf).join('、')}需要你在页面上填写`)
  if (conflicts.length > 0) parts.push(`有${String(conflicts.length)}处信息互相矛盾需要核对`)
  if (ready && !confirmed) parts.push('资料齐全，可以提交')
  if (ready && confirmed) parts.push('等审批通过后才会创建员工')

  return {
    draftId: draft.id,
    fields: draft.fields ?? {},
    missing: missing.map(labelOf),
    needsUserInput: awaiting.map(labelOf),
    conflicts: conflicts.map(item => labelOf(item?.fieldName)),
    // 页面要用版本号做乐观锁；模型只用来回传，不解读
    version: draft.version,
    note: parts.length > 0 ? `${parts.join('；')}。` : '草稿已更新。',
  }
}

/**
 * 按配置整形结果。
 * @param result Java 返回的数据
 * @param view 整形器标识；未配置时原样返回
 * @returns 整形后的结果
 */
function applyView(result, view) {
  if (view === 'hrm.draft' && result !== null && typeof result === 'object' && !Array.isArray(result)) {
    return viewHrmDraft(result)
  }
  return result
}

/**
 * 给结果附上界面引用。
 *
 * 客户端据此渲染"打开草稿"这类入口：模型不需要构造页面地址，只拿业务对象
 * 编号；打开哪个界面由场景配置决定，客户端只接受已注册的标识。
 *
 * @param result Java 返回的数据
 * @param surfaceId 界面标识；未配置时原样返回
 * @param taskId 当前任务编号
 * @returns 附带 surface 的结果
 */
function withSurface(result, surfaceId, taskId) {
  if (typeof surfaceId !== 'string' || surfaceId === '') return result
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return result
  // 整形后的结果用业务化的键名（draftId），原始结构用 id，两者都认。
  const objectId = result.draftId ?? result.id
  if (objectId === undefined || objectId === null) return result
  return {
    ...result,
    surface: {
      id: surfaceId,
      objectId: String(objectId),
      taskId,
    },
  }
}

/**
 * 解析工具的参数 schema。
 *
 * @param raw 数据库里的 JSON 文本
 * @returns 解析后的对象；为空或损坏时返回 null（表示不校验）
 */
function parseSchema(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 按 schema 做最小必要校验。
 *
 * 只查三件事：必填缺失、出现未知参数、基本类型不符。这三类是实测中模型
 * 最容易犯的错，也是造成无效请求与垃圾数据的主因。不做完整 JSON Schema
 * 实现——服务端仍会按 Bean Validation 再校验一次。
 *
 * @param schema 参数 schema；null 表示不校验
 * @param value 模型给的参数
 * @returns 问题列表；空表示通过
 */
function validateAgainst(schema, value) {
  if (schema === null) return []
  const problems = []
  const properties = schema.properties ?? {}
  const required = Array.isArray(schema.required) ? schema.required : []

  for (const key of required) {
    if (value[key] === undefined || value[key] === null || value[key] === '') {
      problems.push(`缺少必填参数 ${key}${describeParam(properties[key])}`)
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (properties[key] === undefined && !isInjected(properties[key])) {
        problems.push(`不认识的参数 ${key}（可用：${Object.keys(properties).join(', ')}）`)
      }
    }
  }
  for (const [key, spec] of Object.entries(properties)) {
    const item = value[key]
    if (item === undefined || item === null) continue
    const type = spec?.type
    if (type === 'integer' && !Number.isInteger(item)) {
      problems.push(`${key} 必须是整数`)
    } else if (type === 'string' && typeof item !== 'string') {
      problems.push(`${key} 必须是字符串`)
    } else if (type === 'object' && (typeof item !== 'object' || Array.isArray(item))) {
      problems.push(`${key} 必须是对象`)
    } else if (type === 'boolean' && typeof item !== 'boolean') {
      problems.push(`${key} 必须是布尔值`)
    }
  }

  // 跨字段约束：若干对象的键集合必须完全一致。
  // 建档草稿要求每个字段都有来源，缺一个服务端就整单拒绝；在这里提前
  // 报清楚，比让模型从"字段不合法"里反推要省得多。
  const sameKeys = Array.isArray(schema['x-same-keys']) ? schema['x-same-keys'] : []
  if (sameKeys.length >= 2) {
    const [first, ...rest] = sameKeys
    const base = value[first]
    if (base !== null && typeof base === 'object') {
      const baseKeys = Object.keys(base).sort()
      for (const other of rest) {
        const target = value[other]
        if (target === null || typeof target !== 'object') continue
        const targetKeys = Object.keys(target).sort()
        const missing = baseKeys.filter(key => !targetKeys.includes(key))
        const extra = targetKeys.filter(key => !baseKeys.includes(key))
        if (missing.length > 0) {
          problems.push(`${other} 缺少 ${missing.join(', ')} 对应的条目（必须与 ${first} 的键完全一致）`)
        }
        if (extra.length > 0) {
          problems.push(`${other} 多出 ${extra.join(', ')}（${first} 里没有这些键）`)
        }
      }
    }
  }
  return problems
}

/**
 * 参数说明，用于错误提示。
 *
 * @param spec 参数定义
 * @returns 附带说明的文本
 */
function describeParam(spec) {
  const text = spec?.description
  return typeof text === 'string' && text !== '' ? `（${text}）` : ''
}

/**
 * 该参数是否由运行时注入。
 *
 * @param spec 参数定义
 * @returns 是否为注入参数
 */
function isInjected(spec) {
  return spec?.['x-source'] === 'task'
}

/**
 * 生成运行时注入的参数。
 *
 * @param schema 参数 schema
 * @param taskId 当前任务编号
 * @returns 需要合并进请求体的键值
 */
function injectTaskFields(schema, taskId) {
  const injected = {}
  for (const [key, spec] of Object.entries(schema?.properties ?? {})) {
    if (isInjected(spec)) injected[key] = taskId
  }
  return injected
}
