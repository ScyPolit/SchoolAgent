import { CircleHelp, Download } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogClose,
  OGDialogTrigger,
  OGDialogTemplate,
} from '@librechat/client';
import guide from '../../../../../../docs/polymas-onboarding.md?raw';
import guideUrl from '../../../../../../docs/polymas-onboarding.md?url';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { useLocalize } from '~/hooks';

export default function IntegrationGuide({ compact = false }: { compact?: boolean }) {
  const localize = useLocalize();
  const title = localize('com_school_onboardingGuide');

  return (
    <OGDialog>
      <OGDialogTrigger asChild>
        <Button
          type="button"
          variant={compact ? 'quiet' : 'outline'}
          size={compact ? 'icon-sm' : 'sm'}
          aria-label={title}
          title={title}
        >
          <CircleHelp className="size-4" aria-hidden="true" />
          {!compact && localize('com_school_onboardingGuideShort')}
        </Button>
      </OGDialogTrigger>
      <OGDialogTemplate
        title={title}
        description={localize('com_school_onboardingGuideHint')}
        className="flex max-h-[85dvh] max-w-4xl flex-col overflow-hidden"
        headerClassName="shrink-0"
        mainClassName="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        footerClassName="shrink-0"
        showCancelButton={false}
        showCloseButton
        main={
          <article className="markdown prose max-w-none px-1" aria-label={title}>
            <MarkdownLite content={guide} codeExecution={false} />
          </article>
        }
        buttons={
          <>
            <Button variant="outline" asChild>
              <a href={guideUrl} download="Polymas-智能体上架说明.md">
                <Download className="size-4" aria-hidden="true" />
                {localize('com_school_downloadGuide')}
              </a>
            </Button>
            <OGDialogClose asChild>
              <Button type="button" variant="submit">
                {localize('com_ui_close')}
              </Button>
            </OGDialogClose>
          </>
        }
      />
    </OGDialog>
  );
}
