/**
 * Solar 工作区，宿主侧入口。
 *
 * 空的 `apply` 给 Loader 一个宿主侧的行，浏览器那一半通过
 * `exports["./client"]` 提供。没有这个导出，Loader 会报
 * "failed to import"。
 */

/** 注册浏览器包，不增加宿主行为。 */
export function apply(): void {}
