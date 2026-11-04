import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  Button,
} from '@librechat/client';
import { schoolRequest, useSchoolBootstrap } from './api';
import { useLocalize } from '~/hooks';

export default function SchoolMigration() {
  const localize = useLocalize(),
    queryClient = useQueryClient();
  const { data } = useSchoolBootstrap();
  const accountId = data?.user?.id;
  const [decided, setDecided] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    try {
      setDecided(
        !!accountId && sessionStorage.getItem('school-migration:' + accountId) === 'decided',
      );
    } catch {
      setDecided(false);
    }
  }, [accountId]);
  const open = !!data?.user && data.guestMigrationCount > 0 && !decided;
  async function migrate(consent: boolean) {
    setBusy(true);
    setError('');
    try {
      await schoolRequest('/guest/migrate', 'POST', { consent });
      try {
        sessionStorage.setItem('school-migration:' + data!.user!.id, 'decided');
      } catch {
        // Private browsing may disable storage; the current mounted session still remembers the choice.
      }
      setDecided(true);
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : localize('com_ui_error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{localize('com_school_migration_title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {localize('com_school_migration_body', { 0: data?.guestMigrationCount || 0 })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <Alert variant="error">{error}</Alert>}
        <AlertDialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => migrate(false)}>
            {localize('com_school_migration_decline')}
          </Button>
          <Button variant="submit" disabled={busy} onClick={() => migrate(true)}>
            {localize('com_school_migration_accept')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
