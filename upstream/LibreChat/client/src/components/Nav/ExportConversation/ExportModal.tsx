import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Input,
  Label,
  Button,
  OGDialog,
  Dropdown,
  Alert,
  OGDialogTemplate,
} from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import { schoolDownload } from '~/components/School/api';
import { useAuthContext, useLocalize } from '~/hooks';

const TYPE_OPTIONS = [
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'png', label: 'PNG (.png)' },
];
/** Original LibreChat export dialog, with the school's permission-checked server export formats. */
export default function ExportModal({
  open,
  onOpenChange,
  conversation,
  triggerRef,
  children,
}: {
  open: boolean;
  conversation: TConversation | null;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  triggerRef?: React.RefObject<HTMLButtonElement>;
  children?: React.ReactNode;
}) {
  const localize = useLocalize(),
    navigate = useNavigate();
  const { user } = useAuthContext();
  const [filename, setFilename] = useState(''),
    [type, setType] = useState('md'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setFilename(conversation?.title || 'conversation');
    setError('');
    setType('md');
  }, [open, conversation?.title]);
  useEffect(() => {
    if (!open) triggerRef?.current?.focus();
  }, [open, triggerRef]);
  async function exportConversation() {
    if (user?.provider === 'school-guest') {
      onOpenChange(false);
      navigate('/login');
      return;
    }
    if (!conversation?.conversationId) return;
    setBusy(true);
    setError('');
    try {
      await schoolDownload(
        `/conversations/${encodeURIComponent(conversation.conversationId)}/export?format=${type}`,
        `${filename}.${type}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : localize('com_ui_error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      {children}
      <OGDialogTemplate
        title={localize('com_nav_export_conversation')}
        className="max-w-full sm:max-w-2xl"
        main={
          <div className="flex w-full flex-col gap-6">
            {error && <Alert variant="error">{error}</Alert>}
            <div className="grid w-full gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="filename">{localize('com_nav_export_filename')}</Label>
                <Input
                  id="filename"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="type">{localize('com_nav_export_type')}</Label>
                <Dropdown
                  ariaLabel={localize('com_nav_export_type')}
                  value={type}
                  onChange={setType}
                  options={TYPE_OPTIONS}
                  portal={false}
                />
              </div>
            </div>
            <Alert variant="neutral">
              {localize(
                user?.provider === 'school-guest'
                  ? 'com_school_login_required'
                  : 'com_school_export_note',
              )}
            </Alert>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={exportConversation} disabled={busy}>
            {localize(user?.provider === 'school-guest' ? 'com_auth_login' : 'com_endpoint_export')}
          </Button>
        }
        selection={undefined}
      />
    </OGDialog>
  );
}
