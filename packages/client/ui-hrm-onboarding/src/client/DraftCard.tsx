/**
 * 对话里的草稿卡片。
 *
 * 挂在 `tool.call.toolview`（按工具名派发）上：场景动作返回了界面引用时，
 * 在工具结果下方给一个"打开草稿"入口，点开进入同一份草稿的业务页面。
 *
 * 只认已注册的界面标识；结果里没有 surface 就退回官方通用卡片。
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DraftSelectionStore } from './store.ts'
import { readSurface } from './store.ts'
import type { HrmOnboardingKey } from './locales.ts'
import css from './DraftPage.module.css'

/** 卡片注入面。 */
export interface DraftCardInjected {
  readonly selection: DraftSelectionStore
  /** 打开草稿页面（切到该面板）。 */
  readonly openDraft: (draftId: number) => void
  readonly registeredSurfaces: readonly string[]
  readonly t: (key: HrmOnboardingKey) => string
}

/** 卡片 props。 */
export type DraftCardProps = PropsRuntime<'tool.call.toolview'> & InjectFace<DraftCardInjected>

/**
 * 从结果内容里取纯文本。
 * @param content 结果内容块
 * @returns 文本；没有文本块时返回空串
 */
function textOf(content: readonly unknown[] | undefined): string {
  if (content === undefined) return ''
  for (const block of content) {
    if (block !== null && typeof block === 'object') {
      const item = block as { type?: unknown; text?: unknown }
      if (item.type === 'text' && typeof item.text === 'string') return item.text
    }
  }
  return ''
}

/**
 * 草稿卡片。
 * @param props 工具调用阶段数据与注入面
 */
export function DraftCard({
  phase, block, selection, openDraft, registeredSurfaces, t,
}: DraftCardProps): ReactNode {
  // 只在有结果时渲染入口；调用进行中交给通用卡片。
  if (phase !== 'result') return null
  const surface = readSurface(textOf(block.content), registeredSurfaces)
  if (surface === undefined) return null
  const draftId = Number(surface.objectId)
  if (!Number.isSafeInteger(draftId) || draftId <= 0) return null

  return (
    <div className={css.card} data-hrm-draft-card={surface.objectId}>
      <div className={css.cardText}>
        <span className={css.cardTitle}>{t('title')}</span>
        <span className={css.cardMeta}>
          #{surface.objectId}
          {selection.getSnapshot().draftId === draftId ? ' · 正在查看' : ''}
        </span>
      </div>
      <button
        type="button"
        className={css.cardButton}
        onClick={() => { openDraft(draftId) }}
      >
        {t('open')}
      </button>
    </div>
  )
}
