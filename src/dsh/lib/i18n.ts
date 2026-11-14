/**
 * Host-side copy for strings the plugin itself sends to the phone.
 *
 * The browser surfaces have their own dictionaries (`src/dsh/client/i18n.ts`
 * for the DSH panel and `src/svelte/lib/i18n.svelte.ts` for the console). The
 * Host cannot import either: one is a browser module factory and the other is
 * a Vite bundle, while this file is compiled into `lib/`. It therefore keeps
 * the same layout — one flat key -> text object per language plus a DICTS
 * table — so all three dictionaries stay readable and a new language can be
 * added the same way in each.
 *
 * These keys cover only text the Host generates and ships with a payload
 * (session fallbacks, answer validation, the pre-app pairing page).
 */

import type { PluginLocale } from './settings.js';

export const zh = {
  answerWaiting: '正在等待你的回答',
  answerCountMismatch: '回答数量不匹配：需要 {expected} 项，收到 {received} 项',
  answerDuplicate: '回答项重复或缺少问题编号',
  answerUnknownQuestion: '回答项不属于当前问题',
  answerSingleChoice: '单选题只能选择一个选项',
  answerOptionGone: '选择的选项已不在问题中',
  answerMissingQuestion: '回答缺少问题',
  answerExpired: '这个问题已经结束或不在等待回答',
  answerNeedsDsh: '这个问题需要在 DSH 中回答',
  answerMissingId: '缺少问题编号，无法回答',
  answerUnsupported: '当前 DSH 不支持远程回答',
  answerNotWaiting: '这个问题已经不再等待回答',
  answerPushOff: '推送问询已关闭',
  answerInvalid: '回答格式无效',
  approvalPrompt: '需要允许 {tool} 执行',
  approvalTool: '工具',
  newSession: '新会话',
  turnFailed: '本轮运行出错',
  turnBlocked: '本轮被阻止',
  pairingTitle: '需要配对',
  pairingBody: '请从 DSH 侧边栏的远程控制台重新扫码。',
} as const;

export type HostMessageKey = keyof typeof zh;

export const en: Record<HostMessageKey, string> = {
  answerWaiting: 'Waiting for your answer',
  answerCountMismatch: 'Answer count mismatch: expected {expected}, received {received}',
  answerDuplicate: 'Duplicate answer or missing question id',
  answerUnknownQuestion: 'An answer does not belong to the current question',
  answerSingleChoice: 'A single-choice question accepts one option',
  answerOptionGone: 'A selected option is no longer part of the question',
  answerMissingQuestion: 'An answer is missing for one question',
  answerExpired: 'This question has finished or is no longer waiting',
  answerNeedsDsh: 'Answer this question in DSH',
  answerMissingId: 'The question id is missing; cannot answer',
  answerUnsupported: 'This DSH build does not support remote answers',
  answerNotWaiting: 'This question is no longer waiting for an answer',
  answerPushOff: 'Pushed inquiries are turned off',
  answerInvalid: 'The answer format is invalid',
  approvalPrompt: 'Allow {tool} to run',
  approvalTool: 'the tool',
  newSession: 'New session',
  turnFailed: 'This turn failed',
  turnBlocked: 'This turn was blocked',
  pairingTitle: 'Pairing required',
  pairingBody: 'Scan the QR code again from the Remote control panel in the DSH sidebar.',
};

/** Every shipped dictionary, keyed by locale code. */
export const DICTS: Record<PluginLocale, Record<HostMessageKey, string>> = { zh, en };

/** Translate one Host message; unknown placeholders stay verbatim. */
export function hostMessage(
  locale: PluginLocale,
  key: HostMessageKey,
  params?: Record<string, string | number>,
): string {
  const template = DICTS[locale]?.[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
