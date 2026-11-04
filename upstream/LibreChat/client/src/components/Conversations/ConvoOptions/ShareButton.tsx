import React, { useState, useEffect, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { QRCodeSVG } from 'qrcode.react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useGetSharedLinkQuery } from 'librechat-data-provider/react-query';
import {
  ESide,
  Input,
  Alert,
  Label,
  Switch,
  Spinner,
  OGDialog,
  InfoHoverCard,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import { useGetLatestMessage, useLatestMessageId } from '~/hooks/Messages/useLatestMessage';
import { useGetStartupConfig, fetchConversationMessages } from '~/data-provider';
import SharedLinkCopyButton from './SharedLinkCopyButton';
import SharedLinkButton from './SharedLinkButton';
import { buildShareLinkUrl } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

type ShareTargetErrorCode = 'TARGET_MESSAGE_NOT_FOUND' | 'NO_MESSAGES';

const createShareTargetError = (
  code: ShareTargetErrorCode,
): Error & { code: ShareTargetErrorCode } => Object.assign(new Error(code), { code });

export default function ShareButton({
  conversationId,
  open,
  onOpenChange,
  triggerRef,
  children,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  triggerRef?: React.RefObject<HTMLButtonElement>;
  children?: React.ReactNode;
}) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const canSnapshotFiles = startupConfig?.sharedLinksSnapshotFilesEnabled === true;
  const queryClient = useQueryClient();
  const [showQR, setShowQR] = useState(true);
  const [sharedLink, setSharedLink] = useState('');
  const [snapshotFiles, setSnapshotFiles] = useState(true);
  const [shareDays, setShareDays] = useState('');
  const days = shareDays.trim() ? Number(shareDays) : undefined;
  const invalidDays = days !== undefined && (!Number.isInteger(days) || days < 1 || days > 36500);
  const shareFilesSwitchRef = React.useRef<HTMLButtonElement>(null);
  const activeConversationId = useRecoilValue(store.conversationIdByIndex(0));
  const activeLatestMessageId = useLatestMessageId(0);
  const getActiveLatestMessage = useGetLatestMessage(0);
  /** `useLatestMessageId` resolves the active pane's branch tail, so it only describes
   * this dialog's conversation when the two match. Sharing another conversation from
   * the list sends no target, which shares it in full instead of a foreign message. */
  const isActiveConversation = activeConversationId === conversationId;
  const latestMessageId = isActiveConversation ? activeLatestMessageId : null;
  const resolveTargetMessageId = useCallback(async (): Promise<string> => {
    let selectedMessageId = getActiveLatestMessage()?.messageId ?? latestMessageId;

    if (!selectedMessageId) {
      await queryClient.fetchQuery(
        [QueryKeys.messages, conversationId],
        () => fetchConversationMessages(conversationId),
        { staleTime: 0 },
      );
      selectedMessageId = getActiveLatestMessage()?.messageId ?? null;
    }

    if (!selectedMessageId) {
      throw createShareTargetError('NO_MESSAGES');
    }

    const persistedMessages = await dataService.getMessageById(conversationId, selectedMessageId);
    if (!persistedMessages.some((message) => message.messageId === selectedMessageId)) {
      throw createShareTargetError('TARGET_MESSAGE_NOT_FOUND');
    }

    return selectedMessageId;
  }, [conversationId, getActiveLatestMessage, latestMessageId, queryClient]);
  const { data: share, isLoading } = useGetSharedLinkQuery(conversationId);
  const shareId = share?.shareId ?? '';

  // Keyed on the conversation too: this dialog outlives a switch between conversations,
  // so a link built for the previous one must not stay in the copy field.
  useEffect(() => {
    setSharedLink(shareId ? buildShareLinkUrl(shareId) : '');
  }, [conversationId, shareId]);

  // Reflect an existing link's stored "share files" choice so the control isn't
  // misleading, and fall back to the enabled default for a conversation with no link
  // or a legacy link that stored no choice, rather than inheriting the last one.
  useEffect(() => {
    setSnapshotFiles(
      share?.success === true && typeof share.snapshotFiles === 'boolean'
        ? share.snapshotFiles
        : true,
    );
  }, [conversationId, share?.success, share?.snapshotFiles]);

  const button =
    isLoading === true ? null : (
      <SharedLinkButton
        share={share}
        conversationId={conversationId}
        targetMessageId={latestMessageId ?? undefined}
        resolveTargetMessageId={isActiveConversation ? resolveTargetMessageId : undefined}
        showQR={showQR}
        setShowQR={setShowQR}
        sharedLink={sharedLink}
        setSharedLink={setSharedLink}
        snapshotFiles={canSnapshotFiles ? snapshotFiles : undefined}
        days={days}
        invalidDays={invalidDays}
      />
    );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      {children}
      <OGDialogContent
        className="flex max-h-[90vh] w-11/12 max-w-md flex-col gap-0 overflow-hidden p-0 shadow-2xl"
        onOpenAutoFocus={(event) => {
          if (shareFilesSwitchRef.current) {
            event.preventDefault();
            shareFilesSwitchRef.current.focus();
          }
        }}
      >
        <OGDialogHeader className="shrink-0 px-6 pe-14 pt-6 pb-0 text-start">
          <div className="flex items-center gap-2">
            <OGDialogTitle className="text-xl font-semibold tracking-tight">
              {localize('com_ui_share_link_to_chat')}
            </OGDialogTitle>
            <InfoHoverCard
              icon="info"
              side={ESide.Bottom}
              text={
                share?.success === true
                  ? localize('com_ui_share_update_message')
                  : localize('com_ui_share_create_message')
              }
            />
          </div>
          <OGDialogDescription className="sr-only">
            {share?.success === true
              ? localize('com_ui_share_update_message')
              : localize('com_ui_share_create_message')}
          </OGDialogDescription>
        </OGDialogHeader>

        {isLoading === true ? (
          <div className="flex min-h-72 items-center justify-center px-6 pb-6">
            <Spinner className="size-6" />
          </div>
        ) : (
          <div
            id="share-conversation-dialog"
            className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pt-6 pb-6"
          >
            <div className="space-y-2">
              <Label htmlFor="school-share-days">{localize('com_school_share_days')}</Label>
              <Input
                id="school-share-days"
                type="number"
                min={1}
                max={36500}
                step={1}
                value={shareDays}
                onChange={(event) => setShareDays(event.target.value)}
                placeholder={localize('com_school_share_default')}
                aria-invalid={invalidDays}
                aria-describedby="school-share-note"
              />
              {invalidDays && (
                <p role="alert" className="text-text-destructive text-sm">
                  {localize('com_school_share_days_error')}
                </p>
              )}
              <p id="school-share-note" className="text-text-secondary text-sm">
                {localize('com_school_share_note')}
              </p>
              {share && 'expiresAt' in share && typeof share.expiresAt === 'string' && (
                <p className="text-text-secondary text-sm">
                  {localize('com_school_share_expires')}:{' '}
                  {new Date(share.expiresAt).toLocaleString()}
                </p>
              )}
            </div>
            <Alert variant="info" icon={false}>
              {localize('com_school_share_network')}
            </Alert>
            {canSnapshotFiles && (
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <Label
                    id="share-files-label"
                    htmlFor="share-files-switch"
                    className="cursor-pointer text-sm font-medium"
                  >
                    {localize('com_ui_share_files')}
                  </Label>
                  <InfoHoverCard
                    icon="info"
                    side={ESide.Bottom}
                    text={`${localize('com_ui_share_files_description')}${
                      shareId ? ` ${localize('com_ui_share_files_update_note')}` : ''
                    }`}
                  />
                </div>
                <Switch
                  ref={shareFilesSwitchRef}
                  id="share-files-switch"
                  checked={snapshotFiles}
                  onCheckedChange={setSnapshotFiles}
                  aria-labelledby="share-files-label"
                />
              </div>
            )}

            {showQR && shareId && (
              <div className="flex min-h-56 items-center justify-center py-1">
                <div className="bg-surface-qr min-w-0 rounded-2xl p-3 shadow-xs">
                  {/* size is only the no-CSS fallback; the rem width is what renders,
                      so the code follows the dialog instead of staying at 200px. */}
                  <QRCodeSVG
                    value={sharedLink}
                    size={200}
                    className="h-auto w-[12.5rem] max-w-full"
                    marginSize={1}
                    title={localize('com_ui_share_qr_code_description')}
                  />
                </div>
              </div>
            )}

            {shareId && <SharedLinkCopyButton sharedLink={sharedLink} />}

            <div className="pt-1">{button}</div>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
