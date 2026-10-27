/**
 * 建档草稿页面。
 *
 * 挂在 `main` 面板（key 与应用面板一致，由侧栏入口打开）。页面与对话编辑
 * 同一份草稿：这里保存走 `/update`，敏感字段走 `/sensitive-fields`，
 * 都带预期版本；版本不一致时服务端拒绝，页面重新读取并提示。
 *
 * 模型看不到敏感字段的真实值——它们只在页面上由用户输入。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DraftSelectionStore } from './store.ts'
import type { Draft, DraftFieldSource } from './api.ts'
import { confirmDraft, DraftError, fetchDraft, updateDraft, writeSensitiveFields } from './api.ts'
import type { HrmOnboardingKey } from './locales.ts'
import css from './DraftPage.module.css'

/** 页面注入面。 */
export interface DraftPageInjected {
  readonly selection: DraftSelectionStore
  readonly t: (key: HrmOnboardingKey) => string
}

/** 页面 props。 */
export type DraftPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'hrmOnboarding'>
  & InjectFace<DraftPageInjected>

/** 字段的中文标签。未列出的键直接显示原名。 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: '姓名',
  mobile: '手机号',
  email: '邮箱',
  sex: '性别',
  birthday: '生日',
  idType: '证件类型',
  idNumber: '证件号',
  highestEducation: '最高学历',
  entryStatus: '入职状态',
  type: '员工类型',
  entryTime: '入职日期',
  probation: '试用期（月）',
  postName: '岗位名称',
  postLevel: '岗位职级',
  workCity: '工作城市',
  workAddress: '工作地址',
  jobNumber: '工号',
  remark: '备注',
}

/** 来源类型的标签键。 */
function sourceKey(type: string | undefined): HrmOnboardingKey {
  switch (type) {
    case 'text': return 'sourceText'
    case 'attachment': return 'sourceAttachment'
    case 'system': return 'sourceSystem'
    default: return 'sourceManual'
  }
}

/**
 * 展示值。
 *
 * 敏感字段在草稿里存的是占位符，页面不显示原文，避免把真实值渲染到
 * 可能被截图或共享的区域；需要修改时由用户重新输入。
 */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value === 'PENDING_INPUT' ? '' : value
  return String(value)
}

/**
 * 建档草稿页面。
 * @param props 注入面与文案
 */
export function DraftPage({ selection, t }: DraftPageProps) {
  const state = useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')

  const draftId = state.draftId

  const load = useCallback(async (id: number): Promise<void> => {
    setError(null)
    try {
      const next = await fetchDraft(id)
      setDraft(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    if (draftId === null) {
      setDraft(null)
      return
    }
    void load(draftId)
  }, [draftId, load])

  if (draftId === null || draft === null) {
    return (
      <div className={css.page}>
        <div className={css.empty}>
          {error ?? t('empty')}
        </div>
      </div>
    )
  }

  const fields = draft.fields ?? {}
  const sources = draft.sources ?? {}
  const awaiting = new Set(draft.awaitingInputFields ?? [])
  const missing = new Set(draft.missingFields ?? [])

  const save = async (field: string, value: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const sensitive = awaiting.has(field)
      const next = sensitive
        ? await writeSensitiveFields(draft.id, draft.version, { [field]: value })
        : await updateDraft(draft.id, draft.version, { [field]: value })
      setDraft(next)
      setEditing(null)
      setInputValue('')
      setNotice(t('saved'))
    } catch (cause) {
      if (cause instanceof DraftError && cause.message.includes('版本')) {
        // 版本冲突：重新读取，让用户看到最新内容再决定。
        await load(draft.id)
        setNotice(t('conflictHint'))
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await confirmDraft(draft.id, draft.version)
      setDraft(next)
      setNotice(t('confirmed'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.page} data-hrm-draft-page={String(draft.id)}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('title')}</h1>
          <div className={css.meta}>
            <span>#{draft.id}</span>
            <span>{t('version')} {draft.version}</span>
            <span className={draft.readyForConfirmation === true ? css.ok : css.warn}>
              {draft.readyForConfirmation === true ? t('ready') : t('notReady')}
            </span>
            {draft.targetDeptId !== null && draft.targetDeptId !== undefined && (
              <span>部门 #{draft.targetDeptId}</span>
            )}
          </div>
        </div>
        <div className={css.actions}>
          <button type="button" className={css.button} disabled={busy} onClick={() => { void load(draft.id) }}>
            {t('refresh')}
          </button>
          <button
            type="button"
            className={css.primary}
            disabled={busy || draft.readyForConfirmation !== true || draft.confirmationValid === true}
            onClick={() => { void confirm() }}
          >
            {busy ? t('confirming') : t('confirm')}
          </button>
        </div>
      </header>

      {error !== null && <div className={css.error}>{error}</div>}
      {notice !== null && <div className={css.notice}>{notice}</div>}

      {missing.size > 0 && (
        <div className={css.banner}>
          {t('missing')}：{[...missing].map(name => FIELD_LABELS[name] ?? name).join('、')}
        </div>
      )}

      <ul className={css.fields}>
        {Object.entries(fields).map(([name, value]) => {
          const source: DraftFieldSource | undefined = sources[name]
          const sensitive = awaiting.has(name)
          const isEditing = editing === name
          return (
            <li key={name} className={css.field}>
              <div className={css.fieldHead}>
                <span className={css.fieldName}>{FIELD_LABELS[name] ?? name}</span>
                <span className={css.fieldSource}>
                  {source === undefined ? '—' : t(sourceKey(source.sourceType))}
                </span>
              </div>
              {isEditing ? (
                <div className={css.editor}>
                  <input
                    className={css.input}
                    value={inputValue}
                    autoFocus
                    placeholder={sensitive ? t('sensitiveHint') : ''}
                    onChange={event => setInputValue(event.target.value)}
                  />
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy || inputValue.trim() === ''}
                    onClick={() => { void save(name, inputValue.trim()) }}
                  >
                    {t('save')}
                  </button>
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy}
                    onClick={() => { setEditing(null); setInputValue('') }}
                  >
                    {t('cancel')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={css.value}
                  onClick={() => {
                    setEditing(name)
                    setInputValue(sensitive ? '' : displayValue(value))
                  }}
                >
                  {sensitive
                    ? (displayValue(value) === '' ? t('awaiting') : '已填写（点击修改）')
                    : (displayValue(value) === '' ? '—' : displayValue(value))}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <section className={css.conflicts}>
        <h2 className={css.sectionTitle}>{t('conflicts')}</h2>
        {(draft.conflicts ?? []).length === 0
          ? <p className={css.muted}>{t('noConflicts')}</p>
          : (
            <ul className={css.conflictList}>
              {(draft.conflicts ?? []).map((conflict, index) => (
                <li key={`${conflict.fieldName ?? 'field'}-${String(index)}`}>
                  <span className={css.fieldName}>
                    {FIELD_LABELS[conflict.fieldName ?? ''] ?? conflict.fieldName ?? '—'}
                  </span>
                  {(conflict.values ?? []).map((item, itemIndex) => (
                    <code key={String(itemIndex)} className={css.conflictValue}>
                      {String(item.value ?? '—')}
                    </code>
                  ))}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
