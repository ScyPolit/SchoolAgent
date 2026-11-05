import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import SchoolAnswerStatus from '../Answer';
import { readSchoolProgress, schoolProgressFor, updateSchoolProgress } from '../progress';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('@librechat/client', () => ({
  Alert: () => null,
  Spinner: () => <span aria-hidden="true" />,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

test('progress remains scoped to its answer and clears without affecting another active conversation', () => {
  const store = createStore();
  const message = {
    messageId: 'answer-one',
    conversationId: 'conversation-one',
    parentMessageId: 'question-one',
    text: '',
    endpoint: 'campus',
    isCreatedByUser: false,
    metadata: { campusStatus: 'running' },
  } as TMessage;
  store.set(updateSchoolProgress, {
    messageId: 'answer-two',
    progress: { phase: 'processing', startedAt: Date.now() },
  });
  const view = render(
    <Provider store={store}>
      <SchoolAnswerStatus message={message} />
    </Provider>,
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() =>
    store.set(updateSchoolProgress, {
      messageId: 'answer-one',
      progress: { phase: 'generating', startedAt: Date.now() },
    }),
  );
  expect(screen.getByRole('status')).toHaveTextContent('com_school_streamGenerating');
  act(() => store.set(updateSchoolProgress, { messageId: 'answer-one' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(store.get(schoolProgressFor('answer-two'))?.phase).toBe('processing');
  view.unmount();
});

test('progress accepts only known phases and finite timestamps, excluding arbitrary model text', () => {
  const valid = {
    event: 'on_agent_update',
    data: {
      runId: 'answer',
      campusProgress: { phase: 'connecting', startedAt: 1000, message: 'private model text' },
    },
  };
  expect(readSchoolProgress(valid)).toEqual({
    messageId: 'answer',
    progress: { phase: 'connecting', startedAt: 1000 },
  });
  expect(
    readSchoolProgress({
      ...valid,
      data: { ...valid.data, campusProgress: { phase: 'invented', startedAt: 1000 } },
    }),
  ).toBeUndefined();
  expect(
    readSchoolProgress({
      ...valid,
      data: { ...valid.data, campusProgress: { phase: 'connecting', startedAt: Infinity } },
    }),
  ).toBeUndefined();
});
