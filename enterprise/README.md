# Solar 企业发行层

本目录只放**不修改上游源码**的企业定制：profile 覆盖层、品牌插件、以及后续的业务插件。

## 组成

| 路径 | 作用 |
| --- | --- |
| `profiles/solar-web.patch.yml` | Web/桌面 profile 的企业覆盖层：供应商、默认模型、关闭的出口与工具 |
| `packages/client/ui-brand-solar`（在 `packages/` 下） | 侧栏品牌 slot 的企业占用者 |

## 品牌替换原理

官方 `ui-brand-official` 的注册函数带一个编译期开关：

```js
function apply(ctx) {
  if ({}.DSH_CLIENT_BUILD_PROFILE !== "official") return
  ...
}
```

非官方构建下它不注册，`sidebar.brand.mark` / `sidebar.brand.name` 由
`ui-brand-solar` 唯一占用。因此品牌定制是**官方预留的扩展点**，不是对 UI 源码的侵入式修改。

## 升级流程

1. 记录当前基线提交与自有改动：`git log --oneline upstream/master..HEAD`
2. 拉取上游：`git fetch upstream && git merge upstream/master`
3. 冲突几乎只出现在 `packages/bundle/web-app/cordis.patch.yml`（注册行）与 `pnpm-lock.yaml`
4. 重新构建：`DSH_CLIENT_COMMIT_HASH=<sha> pnpm run build`
5. 验证：启动 web profile，确认品牌与模型正确

## 不做什么

- 不修改 `packages/client/*` 官方组件的布局与交互
- 不修改 `apps/desktop` 的窗口与生命周期逻辑
- 需要这类改动时，单独记录补丁并评估升级成本
