/**
 * HRM 建档界面，浏览器侧。
 *
 * 两块：
 *   - `main` 面板 `hrm-onboarding`：草稿页面，与对话编辑同一份草稿；
 *   - `tool.call.toolview`（key `scene_invoke`）：对话里的"打开草稿"卡片。
 *
 * 卡片只认已注册的界面标识。模型不构造页面地址，也不决定打开哪个页面——
 * 它只拿业务对象编号，界面由场景配置声明、客户端校验后打开。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { DraftSelectionStore } from './store.ts'
import { DraftCard, type DraftCardInjected } from './DraftCard.tsx'
import { DraftPage, type DraftPageInjected } from './DraftPage.tsx'
import { en, zh } from './locales.ts'

export { DraftSelectionStore, readSurface } from './store.ts'
export type { SurfaceRef } from './store.ts'
export { DraftPage } from './DraftPage.tsx'
export { DraftCard } from './DraftCard.tsx'

/** 文案命名空间。 */
export const NS = 'hrmOnboarding'

/** 草稿页面的面板 id。 */
export const DRAFT_PANEL = 'hrm-onboarding'

/** 本包提供的界面标识；卡片只接受这些。 */
export const SURFACES = ['hrm.employee-onboarding.draft'] as const

/** 需要官方 slot 注册表与面板导航。 */
export const inject = ['slots', 'layout', 'locale']

/**
 * 挂载 HRM 建档界面。
 * @param ctx 客户端根上下文
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hrm-onboarding: dictionaries')
  const t = ctx.locale.bind(NS)
  const selection = new DraftSelectionStore()

  /** 打开草稿：切到草稿面板。 */
  const openDraft = (draftId: number): void => {
    selection.open(draftId)
    ctx.layout.selectPanel(DRAFT_PANEL as never)
  }

  // 草稿页面：一个 main 面板，侧栏入口按 id 打开它。
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: DRAFT_PANEL,
    locale: NS,
    inject: (): DraftPageInjected => ({ selection, t }),
  }, DraftPage))

  // 对话里的卡片：按工具名派发，只处理场景调用。
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'scene_invoke',
    locale: NS,
    inject: (): DraftCardInjected => ({
      selection,
      openDraft,
      registeredSurfaces: SURFACES,
      t,
    }),
  }, DraftCard))
}
