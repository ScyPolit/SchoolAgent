import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { QueryKeys } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Spinner, useToastContext } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { siblingIdxFamily, siblingKey } from '~/components/Chat/Messages/Thread/state';
import { visibleSchoolBranchLeaf } from './branch';
import { schoolRequest } from './api';
import { schoolProgressFor } from './progress';

function SchoolGenerationProgress({ message }: { message: TMessage }) {
  const localize = useLocalize();
  const progress = useAtomValue(
    useMemo(() => schoolProgressFor(message.messageId), [message.messageId]),
  );
  const [elapsed, setElapsed] = useState(0);
  const startedAt = progress?.startedAt;
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (
    !progress ||
    ['completed', 'failed', 'unknown', 'stopped'].includes(String(message.metadata?.campusStatus))
  )
    return null;
  const labels = {
    connecting: 'com_school_streamConnecting',
    processing: 'com_school_streamProcessing',
    generating: 'com_school_streamGenerating',
  } as const;
  return (
    <div
      className="text-text-secondary mx-auto mb-3 flex w-full max-w-3xl items-center gap-2 px-4 text-sm"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-4" />
      <span>{localize(labels[progress.phase])}</span>
      <span className="tabular-nums" aria-hidden="true">
        {elapsed} {localize('com_school_seconds')}
      </span>
    </div>
  );
}

export function useSchoolBranch() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const store = useStore();
  const sequence = useRef(Promise.resolve());
  const { showToast } = useToastContext();
  const mutation = useMutation((message: TMessage) =>
    schoolRequest(
      `/conversations/${encodeURIComponent(message.conversationId || '')}/messages/${encodeURIComponent(message.parentMessageId || '')}/activate`,
      'POST',
      { versionId: message.messageId },
    ),
  );
  const mutate = mutation.mutateAsync;
  return useCallback(
    (message: TMessage | undefined, commit: () => void) => {
      if (!message || message.endpoint !== 'campus') {
        commit();
        return;
      }
      sequence.current = sequence.current
        .catch(() => {})
        .then(async () => {
          try {
            const messages =
              queryClient.getQueryData<TMessage[]>([QueryKeys.messages, message.conversationId]) ||
              [];
            const leaf = visibleSchoolBranchLeaf(messages, message, (parentId) =>
              store.get(siblingIdxFamily(siblingKey(parentId))),
            );
            if (!leaf) throw new Error(localize('com_ui_error'));
            await mutate(leaf);
            // Keep every accepted selection in step with persistence. If a
            // newer queued click fails, this accepted branch stays visible.
            commit();
          } catch (e) {
            showToast({
              message: e instanceof Error ? e.message : localize('com_ui_error'),
              severity: NotificationSeverity.ERROR,
            });
          }
        });
    },
    [mutate, showToast, localize, queryClient, store],
  );
}
export default function SchoolAnswerStatus({ message }: { message: TMessage }) {
  const localize = useLocalize();
  if (message.endpoint !== 'campus' || message.isCreatedByUser) return null;
  const metadata = message.metadata || {},
    status = metadata.campusStatus,
    cancellation = metadata.cancellationState;
  if (!['failed', 'stopped', 'unknown'].includes(String(status)))
    return <SchoolGenerationProgress message={message} />;
  const failed = status === 'failed',
    confirmed = ['confirmed', 'cancelled', 'canceled'].includes(String(cancellation));
  return (
    <div className="mx-auto mb-4 w-full max-w-3xl px-4">
      <Alert variant={failed ? 'error' : 'warning'}>
        {failed && typeof metadata.errorMessage === 'string'
          ? metadata.errorMessage
          : localize(confirmed ? 'com_school_cancel_confirmed' : 'com_school_cancel_unknown')}
      </Alert>
    </div>
  );
}
