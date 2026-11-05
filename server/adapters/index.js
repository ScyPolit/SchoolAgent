import { AdapterError, createDifyAdapter } from './dify.js';
import { createPolymasAdapter } from './polymas.js';

export function createAdapter(integration, fetcher) {
  if (['dify', 'dify-chatflow', 'dify-workflow'].includes(integration.platform)) {
    integration = { ...integration, config: { ...(integration.platform === 'dify-chatflow' ? { mode: 'chatflow' } : integration.platform === 'dify-workflow' ? { mode: 'workflow' } : {}), ...integration.config } };
    return createDifyAdapter(integration, fetcher);
  }
  if (integration.platform === 'polymas') return createPolymasAdapter(integration, fetcher);
  if (integration.platform !== 'demo') throw new AdapterError('PLATFORM_UNSUPPORTED', '此平台尚未实现正式适配器。', 409);
  if (process.env.ENABLE_DEMO_ADAPTER !== 'true' || process.env.NODE_ENV === 'production') throw new AdapterError('DEMO_DISABLED', '演示适配器仅允许在明确启用的非生产环境使用。', 409);
  return {
    async run({ content, history, signal, onEvent }) {
      onEvent({ type: 'dispatch', mode: 'demo' });
      onEvent({ type: 'progress', message: '开发演示模式：以下为本地固定示例，并非真实智能体回复。' });
      const text = `**开发演示 · 非真实接入**\n\n已收到：${content}\n\n此会话已有 ${history.filter(m => m.role === 'user').length} 轮历史。真实电话、办事流程和知识答案需要接入已发布的 Polymas / Dify 应用。\n\n| 功能 | 当前演示 |\n| --- | --- |\n| 会话隔离 | 服务端保存 |\n| 历史版本 | 支持切换 |\n\n[平台帮助](/#help)`;
      for (const part of text.match(/.{1,24}|\n/g)) {
        await new Promise(resolve => setTimeout(resolve, 15));
        if (signal.aborted) throw signal.reason;
        onEvent({ type: 'delta', text: part });
      }
      return { status: 'completed', mode: 'demo', answerDeltas: 0 };
    },
    async stop() { return { state: 'local_only', message: '开发演示已在本地停止。' }; }
  };
}
