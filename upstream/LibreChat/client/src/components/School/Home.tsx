import { useNavigate } from 'react-router-dom';
import { Button, Alert } from '@librechat/client';
import type { ReactNode } from 'react';
import { contentText, safeSchoolHref, useSchoolBootstrap } from './api';
import { useLocalize } from '~/hooks';

/** School content added to the original Agent Marketplace, without replacing its cards or navigation. */
export default function SchoolHome({ children }: { children?: ReactNode }) {
  const { data, error, refetch } = useSchoolBootstrap();
  const localize = useLocalize();
  const navigate = useNavigate();
  if (error instanceof Error)
    return (
      <>
        <Alert variant="error">
          {error.message}
          <Button variant="outline" onClick={() => void refetch()}>
            {localize('com_school_refresh')}
          </Button>
        </Alert>
        {children}
      </>
    );
  if (!data) return <>{children}</>;
  const hp = data.homepage,
    m = hp.modules || {};
  return (
    <section
      className="text-text-primary flex min-w-0 flex-col gap-5 pb-6"
      aria-label={hp.platformName}
    >
      <div className="py-4">
        <p className="text-text-secondary mb-3 text-sm">{hp.schoolName}</p>
        {hp.logo && safeSchoolHref(hp.logo) && (
          <img className="mb-4 h-12 w-auto" src={safeSchoolHref(hp.logo)} alt={hp.schoolName} />
        )}
        <h2 className="text-text-primary text-2xl leading-tight font-semibold sm:text-3xl">
          {hp.welcome}
        </h2>
        <p className="text-text-secondary mt-2 text-sm">{hp.subtitle}</p>
      </div>
      {!data.user && (
        <Alert variant="neutral" icon={false}>
          {localize('com_school_guest_retention', { 0: data.retention.guestBrowserDays })}
        </Alert>
      )}
      {m.banners !== false &&
        hp.banners.map((banner, i) => (
          <Alert key={i} variant="neutral" icon={false}>
            <div className="flex items-center gap-4">
              {typeof banner !== 'string' && banner.image && (
                <img
                  className="max-h-24 w-28 rounded-lg object-cover"
                  src={safeSchoolHref(banner.image)}
                  alt=""
                />
              )}
              <div>
                <h3 className="font-medium">{contentText(banner)}</h3>
                {typeof banner !== 'string' && banner.description && (
                  <p className="mt-2 text-sm">{banner.description}</p>
                )}
                {typeof banner !== 'string' && safeSchoolHref(banner.url) && (
                  <Button asChild variant="outline" className="mt-3">
                    <a href={safeSchoolHref(banner.url)} target="_blank" rel="noopener noreferrer">
                      {hp.schoolName}
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </Alert>
        ))}
      {m.announcements !== false &&
        hp.announcements.map((a, i) => (
          <Alert key={i} variant="neutral">
            <p>
              {typeof a !== 'string' && safeSchoolHref(a.url) ? (
                <a className="underline" href={safeSchoolHref(a.url)}>
                  {contentText(a)}
                </a>
              ) : (
                contentText(a)
              )}
            </p>
            {typeof a !== 'string' && a.title && a.content && <p className="mt-1">{a.content}</p>}
          </Alert>
        ))}
      {m.questions !== false && hp.questions.length > 0 && (
        <div className="flex flex-wrap gap-2 [&>button]:h-auto [&>button]:text-start [&>button]:whitespace-normal">
          {hp.questions.map((q, i) => {
            const agent =
              typeof q !== 'string' && q.agentId
                ? data.agents.find((a) => a.id === q.agentId)
                : data.agents.find((a) => a.recommended) || data.agents[0];
            return (
              <Button
                key={i}
                variant="outline"
                disabled={!agent}
                onClick={() => {
                  if (agent)
                    navigate(
                      `/c/new?endpoint=campus&model=${encodeURIComponent(agent.id)}&prompt=${encodeURIComponent(contentText(q))}`,
                    );
                }}
              >
                {contentText(q)}
              </Button>
            );
          })}
        </div>
      )}
      {children && (
        <div className="min-w-0 py-2">
          <h2 className="mb-4 text-lg font-semibold">{localize('com_school_chooseAgent')}</h2>
          {children}
        </div>
      )}
      {m.faq !== false &&
        hp.faq.map((faq, i) => (
          <details className="border-border-light rounded-lg border p-3 text-sm" key={i}>
            <summary className="cursor-pointer font-medium">
              {typeof faq === 'string' ? faq : faq.question || faq.title}
            </summary>
            <p className="text-text-secondary mt-3 leading-relaxed">
              {typeof faq === 'string' ? '' : faq.answer || faq.text}
            </p>
          </details>
        ))}
      {((m.help !== false && hp.help) ||
        (m.contact !== false && hp.contact) ||
        (m.footer !== false && hp.footer)) && (
        <footer className="border-border-light text-text-secondary flex flex-col gap-2 border-t pt-4 text-xs leading-relaxed">
          {m.help !== false && hp.help && <p>{hp.help}</p>}
          {m.contact !== false && hp.contact && <p>{hp.contact}</p>}
          {m.footer !== false && hp.footer && <p>{hp.footer}</p>}
        </footer>
      )}
    </section>
  );
}
