import React from 'react';
import { Provider, createStore } from 'jotai';
import { QueryKeys } from 'librechat-data-provider';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import { buildThreadIndex, resolveThreadRows } from '~/utils/thread';
import { siblingIdxFamily, siblingKey } from '~/components/Chat/Messages/Thread/state';
import { useSchoolBranch } from '../Answer';
import { visibleSchoolBranchLeaf } from '../branch';
import { schoolRequest } from '../api';

const mockToast = jest.fn();
jest.mock('@librechat/client', () => ({
  Alert: () => null,
  useToastContext: () => ({ showToast: mockToast }),
}));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('../api', () => ({ schoolRequest: jest.fn() }));
jest.mock('~/components/Chat/Messages/Thread/state', () => {
  const { atom } = jest.requireActual<typeof import('jotai')>('jotai');
  const { atomFamily } = jest.requireActual<typeof import('jotai/utils')>('jotai/utils');
  return {
    siblingKey: (key: string) => key ?? '__null_parent__',
    siblingIdxFamily: atomFamily(() => atom(0)),
  };
});

const message = (id: string, parent: string, user = false) =>
  ({
    messageId: id,
    parentMessageId: parent,
    conversationId: 'c-one',
    text: id,
    isCreatedByUser: user,
    sender: user ? '用户' : '智能体',
    endpoint: 'campus',
    createdAt: '2026-11-04T00:00:00Z',
  }) as TMessage;
const user = message('m-first', 'no-parent', true),
  original = message('v-original', user.messageId),
  child = message('m-child', original.messageId, true),
  childAnswer = message('v-child', child.messageId),
  regenerated = message('v-regenerated', user.messageId);
const graph = [user, original, child, childAnswer, regenerated];

beforeEach(() => {
  jest.mocked(schoolRequest).mockResolvedValue({});
  mockToast.mockClear();
});

function setup(messages = graph) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const store = createStore();
  queryClient.setQueryData([QueryKeys.messages, 'c-one'], messages);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useSchoolBranch(), { wrapper });
  const selectedRows = () =>
    resolveThreadRows(
      buildThreadIndex(messages),
      'c-one',
      (parent) => store.get(siblingIdxFamily(siblingKey(parent))),
      null,
    );
  return { ...hook, store, queryClient, selectedRows };
}

test('switching an ancestor persists the same descendant leaf the original thread displays', async () => {
  const { result, store, selectedRows } = setup();
  expect(selectedRows().at(-1)?.message.messageId).toBe(regenerated.messageId);
  const commit = jest.fn(() => store.set(siblingIdxFamily(siblingKey(user.messageId)), 1));
  act(() => result.current(original, commit));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(schoolRequest).toHaveBeenCalledWith(
    '/conversations/c-one/messages/m-child/activate',
    'POST',
    { versionId: childAnswer.messageId },
  );
  expect(selectedRows().map((row) => row.message.messageId)).toEqual([
    user.messageId,
    original.messageId,
    child.messageId,
    childAnswer.messageId,
  ]);
});

test('edited user siblings also persist their selected descendant branch before the native switch', async () => {
  const edited = message('m-edited', 'no-parent', true),
    editedAnswer = message('v-edited', edited.messageId);
  const { result, store, selectedRows } = setup([...graph, edited, editedAnswer]);
  store.set(siblingIdxFamily(siblingKey(user.messageId)), 1);
  const commit = jest.fn(() => store.set(siblingIdxFamily(siblingKey('c-one')), 1));
  act(() => result.current(user, commit));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(schoolRequest).toHaveBeenCalledWith(
    '/conversations/c-one/messages/m-child/activate',
    'POST',
    { versionId: childAnswer.messageId },
  );
  expect(selectedRows().at(-1)?.message.messageId).toBe(childAnswer.messageId);
});

test('descendant selections follow saved reversed indexes rather than always choosing newest', () => {
  const otherChild = message('m-other', original.messageId, true),
    otherAnswer = message('v-other', otherChild.messageId),
    regeneratedChild = message('v-child-regenerated', child.messageId);
  const messages = [...graph, regeneratedChild, otherChild, otherAnswer];
  const indexes = new Map([
    [original.messageId, 1],
    [child.messageId, 1],
  ]);
  const leaf = visibleSchoolBranchLeaf(messages, original, (parent) => indexes.get(parent) || 0);
  expect(leaf?.messageId).toBe(childAnswer.messageId);
  expect(visibleSchoolBranchLeaf(messages, original, () => 100)?.messageId).toBe(
    otherAnswer.messageId,
  );
  expect(visibleSchoolBranchLeaf([], original, () => 0)).toBeUndefined();
});

test('a rejected branch activation leaves the original native selection visible', async () => {
  const { result, selectedRows } = setup();
  jest.mocked(schoolRequest).mockRejectedValueOnce(new Error('权限已变化'));
  const commit = jest.fn();
  act(() => result.current(original, commit));
  await waitFor(() => expect(mockToast).toHaveBeenCalled());
  expect(commit).not.toHaveBeenCalled();
  expect(selectedRows().at(-1)?.message.messageId).toBe(regenerated.messageId);
});

test('a newer queued rejection retains the last accepted visible branch', async () => {
  const { result, store, selectedRows } = setup();
  let accept!: (value: unknown) => void;
  jest
    .mocked(schoolRequest)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error('后续切换被拒绝'));
  const accepted = jest.fn(() => store.set(siblingIdxFamily(siblingKey(user.messageId)), 1));
  const rejected = jest.fn(() => store.set(siblingIdxFamily(siblingKey(user.messageId)), 0));
  act(() => {
    result.current(original, accepted);
    result.current(regenerated, rejected);
  });
  await waitFor(() => expect(accept).toBeDefined());
  await act(async () => accept({}));
  await waitFor(() => expect(mockToast).toHaveBeenCalled());
  expect(accepted).toHaveBeenCalledTimes(1);
  expect(rejected).not.toHaveBeenCalled();
  expect(selectedRows().at(-1)?.message.messageId).toBe(childAnswer.messageId);
});
