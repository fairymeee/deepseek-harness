import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Solar 品牌标记。
 *
 * 官方 `ui-brand-official` 只在官方构建里占用这两个 slot；企业构建由本包
 * 作为唯一占用者，因此不与官方组件竞争。
 */
export function SolarBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      fill="none"
    >
      <rect fill="#2457d6" height="24" rx="6" width="24" />
      <path
        d="M16.4 8.6a4.6 4.6 0 0 0-3.1-1.1c-1.9 0-3.2.9-3.2 2.3 0 1.3.9 1.9 2.8 2.3 2.6.5 3.9 1.3 3.9 3.3 0 2.1-1.8 3.5-4.3 3.5-1.6 0-3.1-.5-4.2-1.4l1-1.5c.9.8 2 1.2 3.2 1.2 1.5 0 2.4-.7 2.4-1.7 0-1-.7-1.5-2.6-1.9-2.7-.6-4.1-1.4-4.1-3.6 0-2.2 1.8-3.6 4.5-3.6 1.5 0 2.9.4 3.9 1.2z"
        fill="#ffffff"
      />
    </svg>
  )
}

/** Solar 品牌名称，不带独立图标。 */
export function SolarBrandName() {
  return (
    <span
      style={{
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      Solar Agent
    </span>
  )
}

/** 新会话首屏的品牌图形，尺寸由宿主传入。 */
export function SolarHeroMark({ size, className }: { readonly size: number; readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      viewBox="0 0 24 24"
      width={size}
      fill="none"
    >
      <rect fill="#2457d6" height="24" rx="6" width="24" />
      <path
        d="M16.4 8.6a4.6 4.6 0 0 0-3.1-1.1c-1.9 0-3.2.9-3.2 2.3 0 1.3.9 1.9 2.8 2.3 2.6.5 3.9 1.3 3.9 3.3 0 2.1-1.8 3.5-4.3 3.5-1.6 0-3.1-.5-4.2-1.4l1-1.5c.9.8 2 1.2 3.2 1.2 1.5 0 2.4-.7 2.4-1.7 0-1-.7-1.5-2.6-1.9-2.7-.6-4.1-1.4-4.1-3.6 0-2.2 1.8-3.6 4.5-3.6 1.5 0 2.9.4 3.9 1.2z"
        fill="#ffffff"
      />
    </svg>
  )
}
