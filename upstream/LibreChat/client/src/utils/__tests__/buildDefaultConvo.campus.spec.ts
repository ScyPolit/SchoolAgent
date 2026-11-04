import { Constants, EModelEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import buildDefaultConvo from '../buildDefaultConvo';

jest.mock('../localStorage', () => ({
  getLocalStorageItems: () => ({ lastSelectedModel: { campus: 'another-published-agent' } }),
}));
jest.mock('../endpoints', () => ({ clearModelForNonEphemeralAgent: jest.fn() }));

const campus = 'campus' as EModelEndpoint;
const history = {
  conversationId: 'c-existing-campus',
  title: '仍可查看的旧对话',
  endpoint: campus,
  endpointType: EModelEndpoint.custom,
  model: 'unpublished-original-agent',
  spec: 'unpublished-original-agent',
  modelLabel: '原智能体',
  createdAt: '',
  updatedAt: '',
} as TConversation;

test('native normalization keeps an owned historical campus model missing from the current selector catalog', () => {
  const catalog = ['another-published-agent'];
  const restored = buildDefaultConvo({
    models: catalog,
    conversation: history,
    endpoint: campus,
    lastConversationSetup: history,
  });
  expect(restored.conversationId).toBe(history.conversationId);
  expect(restored.model).toBe(history.model);
  expect(restored.spec).toBe(history.spec);
  expect(restored.endpoint).toBe(campus);
  expect(catalog).toEqual(['another-published-agent']);
});

test('a new campus draft still selects from the authorized published catalog', () => {
  const draft = { ...history, conversationId: String(Constants.NEW_CONVO) };
  const restored = buildDefaultConvo({
    models: ['another-published-agent'],
    conversation: draft,
    endpoint: campus,
    lastConversationSetup: draft,
  });
  expect(restored.model).toBe('another-published-agent');
});

test('other original endpoints retain their existing model-catalog normalization', () => {
  const original = {
    ...history,
    endpoint: EModelEndpoint.openAI,
    endpointType: undefined,
    model: 'previously-available-model',
  };
  const restored = buildDefaultConvo({
    models: ['available-model'],
    conversation: original,
    endpoint: EModelEndpoint.openAI,
    lastConversationSetup: original,
  });
  expect(restored.model).toBe('available-model');
});
