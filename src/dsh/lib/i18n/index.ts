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

import type { PluginLocale } from '../settings/index.js';

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
  quickqaEmptyText: '没有识别到可用的文字',
  quickqaVoiceNotReady: 'DSH 语音输入未就绪，请先启用插件并准备好语音模型',
  quickqaBusy: '上一个问题还在回答中',
  quickqaUnknownSession: '这个会话已失效，请重新开始',
  quickqaUnsupported: '当前 DSH 不支持快速问答',
  quickqaFollowUnsupported: '当前 DSH 不支持持续接收回答',
  quickqaCreateFailed: '无法创建会话：{error}',
  quickqaPromptFailed: '无法发送给模型',
  quickqaRunFailed: '回答过程中出错',
  quickqaTurnStopped: '本轮回答已停止',
  quickqaTranscribeFailed: '语音转写失败',
  quickqaTranscribeEmpty: '没有识别到语音内容',
  quickqaTranscribeTooLarge: '录音太长了，请缩短后重试',
  quickqaImageNotAllowed: '快速问答的图片附加已关闭',
  quickqaImageExpired: '附加的图片已失效，请重新选择',
  quickqaImageModel: '当前模型不支持图片',
  quickqaImageRejected: '图片无法发送，请换一张',
  quickqaImageTooLarge: '图片太大了',
  quickqaImageUnsupported: '不支持这种图片格式',
  quickqaImageInvalid: '图片内容无效',
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
  quickqaEmptyText: 'No usable text was recognized',
  quickqaVoiceNotReady: 'DSH voice input is not ready. Enable the plugin and prepare its speech model first.',
  quickqaBusy: 'The previous question is still being answered',
  quickqaUnknownSession: 'This conversation has expired. Start a new one.',
  quickqaUnsupported: 'Quick Q&A is not available in this DSH build',
  quickqaFollowUnsupported: 'Streaming answers are not available in this DSH build',
  quickqaCreateFailed: 'Could not create a conversation: {error}',
  quickqaPromptFailed: 'Could not send the question to the model',
  quickqaRunFailed: 'The answer failed',
  quickqaTurnStopped: 'This answer was stopped',
  quickqaTranscribeFailed: 'Speech transcription failed',
  quickqaTranscribeEmpty: 'No speech was recognized',
  quickqaTranscribeTooLarge: 'The recording is too long; shorten it and try again',
  quickqaImageNotAllowed: 'Image attachments are turned off for Quick Q&A',
  quickqaImageExpired: 'The attached image expired; choose it again',
  quickqaImageModel: 'The selected model does not accept images',
  quickqaImageRejected: 'The image could not be sent; try another one',
  quickqaImageTooLarge: 'The image is too large',
  quickqaImageUnsupported: 'This image format is not supported',
  quickqaImageInvalid: 'The image content is invalid',
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
