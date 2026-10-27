/**
 * 侧栏应用图标。
 *
 * 只渲染图标本身，**不要**再包一层 button：官方侧栏已经用一个
 * `button.panelRow` 包住条目，点击由它按面板 id 派发。再套一层 button
 * 会形成嵌套按钮（HTML 非法），也会出现两个可点区域。
 *
 * 侧栏是深色底，图标必须显式给描边色：继承 `currentColor` 在暗色主题下
 * 对比度不足，看起来像"没有图标"。
 *
 * 用内联 SVG 而不是图标库：这里只需要十来个通用图形，引整套图标包不值得。
 */
import type { SolarApp } from './apps.ts'

/** 注入给图标组件的属性。 */
export interface SolarAppIconProps {
  readonly app: SolarApp
  /** 官方侧栏给的目标边长。 */
  readonly size?: number
  /** 当前是否为选中面板。 */
  readonly active?: boolean
}

/** 图形名到 SVG 路径的映射。 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  // 齿轮：系统管理
  gear: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  ],
  // 分支：工作流程
  branch: [
    'M6 3v12',
    'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M18 9a9 9 0 0 1-9 9',
  ],
  // 人：HRM
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  // 网格：CRM / PMS
  grid: [
    'M3 3h7v7H3z',
    'M14 3h7v7h-7z',
    'M14 14h7v7h-7z',
    'M3 14h7v7H3z',
  ],
  // 文档：OA
  doc: [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z',
    'M14 2v6h6',
    'M8 13h8',
    'M8 17h5',
  ],
  // 服务器：基础设施
  server: [
    'M4 4h16v6H4z',
    'M4 14h16v6H4z',
    'M8 7h.01',
    'M8 17h.01',
  ],
}

/** 菜单图标标识到图形名的保守映射。 */
const ICON_MAP: Readonly<Record<string, string>> = {
  'ep:tools': 'gear',
  'ep:setting': 'gear',
  'ep:monitor': 'server',
  'fa:medium': 'branch',
  'simple-icons:civicrm': 'grid',
}

/**
 * 选一个图形。
 *
 * 认不出的不猜，统一用网格图标：宁可看起来普通，也不要渲染成空白按钮。
 * @param icon 菜单图标标识
 * @returns 图形名
 */
function pickGlyph(icon: string | null | undefined): string {
  if (icon === null || icon === undefined) return 'grid'
  return ICON_MAP[icon] ?? 'grid'
}

/**
 * 一个应用图标。
 * @param props 应用与官方侧栏给的展示参数
 */
export function SolarAppIcon({ app, size = 18, active = false }: SolarAppIconProps) {
  const paths = GLYPHS[pickGlyph(app.icon)] ?? GLYPHS.grid ?? []
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        // 显式上色：继承 currentColor 在暗色侧栏上几乎看不见。
        color: active
          ? 'var(--dsw-alias-label-primary, #f5f5f5)'
          : 'var(--dsw-alias-label-secondary, #9ca3af)',
        display: 'block',
      }}
    >
      {paths.map(path => <path key={path} d={path} />)}
    </svg>
  )
}
