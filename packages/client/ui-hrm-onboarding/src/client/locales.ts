/** HRM 建档界面文案。 */
export const zh = {
  title: '员工入职建档',
  empty: '从对话里的草稿卡片打开一份草稿。',
  open: '打开草稿',
  refresh: '重新读取',
  confirm: '确认草稿',
  confirming: '提交中…',
  saved: '已保存',
  version: '版本',
  fields: '档案字段',
  emptyValue: '未填写',
  confirmedShort: '已确认',
  viewing: '正在查看',
  missing: '必填缺失',
  awaiting: '需要你填写',
  conflicts: '字段冲突',
  noConflicts: '无冲突',
  ready: '可以提交',
  notReady: '还不能提交',
  confirmed: '已确认（等待审批通过后才创建员工）',
  sensitiveHint: '这一项只在页面里填写，不会发给模型',
  sourceManual: '手工录入',
  sourceText: '对话提取',
  sourceAttachment: '附件识别',
  sourceSystem: '系统带出',
  save: '保存',
  cancel: '取消',
  loadFailed: '读取草稿失败',
  saveFailed: '保存失败',
  conflictHint: '草稿已被别处修改，已重新读取最新内容',
}

export type HrmOnboardingKey = keyof typeof zh

/** 英文文案。 */
export const en: Record<HrmOnboardingKey, string> = {
  title: 'Employee onboarding',
  empty: 'Open a draft from its card in the conversation.',
  open: 'Open draft',
  refresh: 'Reload',
  confirm: 'Confirm draft',
  confirming: 'Submitting…',
  saved: 'Saved',
  version: 'Version',
  fields: 'Fields',
  emptyValue: 'Not filled',
  confirmedShort: 'Confirmed',
  viewing: 'viewing',
  missing: 'Required missing',
  awaiting: 'Needs your input',
  conflicts: 'Field conflicts',
  noConflicts: 'No conflicts',
  ready: 'Ready to submit',
  notReady: 'Not ready to submit',
  confirmed: 'Confirmed (the employee is created after approval)',
  sensitiveHint: 'This value is entered here only and never sent to the model',
  sourceManual: 'Entered by hand',
  sourceText: 'From conversation',
  sourceAttachment: 'From attachment',
  sourceSystem: 'From system',
  save: 'Save',
  cancel: 'Cancel',
  loadFailed: 'Failed to load the draft',
  saveFailed: 'Failed to save',
  conflictHint: 'The draft changed elsewhere; the latest version was reloaded',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** HRM 建档界面文案。 */
    hrmOnboarding: HrmOnboardingKey
  }
}
