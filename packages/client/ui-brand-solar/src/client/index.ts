/** Solar 企业品牌占用者，注册到侧栏品牌 slot。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SolarBrandMark, SolarBrandName } from './Brand.tsx'

/** 必需服务：UI slot 注册表。 */
export const inject = ['slots']

/**
 * 占用 `sidebar.brand.mark` 与 `sidebar.brand.name`。
 *
 * 两个 slot 由官方 ui-sidebar 声明并提供 fallback；官方品牌只在
 * `DSH_CLIENT_BUILD_PROFILE === 'official'` 时注册，因此企业构建里本包是
 * 唯一占用者。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, SolarBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, SolarBrandName)
    }))
}
