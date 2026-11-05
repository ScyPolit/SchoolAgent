import { useState } from 'react';
import { Button, Checkbox, Dropdown, Input, Label, Textarea } from '@librechat/client';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

type Entry = Record<string, unknown>;
type Option = { value: string; label: string };

export function DurationChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const localize = useLocalize();
  const t = (key: string) => localize(('com_school_' + key) as TranslationKeys);
  const presets = [7, 30, 90, 180, 365];
  const [custom, setCustom] = useState(!presets.includes(value));
  return (
    <div className="flex flex-col gap-2">
      <Dropdown
        ariaLabel={label}
        value={custom ? 'custom' : String(value)}
        portal={false}
        options={[
          ...presets.map((days) => ({ value: String(days), label: t('days' + days) })),
          { value: 'custom', label: t('customDays') },
        ]}
        onChange={(next) => {
          setCustom(next === 'custom');
          if (next !== 'custom') onChange(Number(next));
        }}
      />
      {custom && (
        <Input
          type="number"
          aria-label={label}
          value={value}
          min={1}
          max={36500}
          required
          onChange={(event) => onChange(Number(event.target.value))}
        />
      )}
    </div>
  );
}

export default function ContentEditor({
  kind,
  value,
  onChange,
  groups = [],
  agents = [],
}: {
  kind: string;
  value: unknown;
  onChange: (value: unknown) => void;
  groups?: Option[];
  agents?: Option[];
}) {
  const localize = useLocalize();
  const t = (key: string) => localize(('com_school_' + key) as TranslationKeys);
  const items: (string | Entry)[] = Array.isArray(value) ? value : [];
  const defaultMainKey = kind === 'faq' || kind === 'questions' ? 'question' : 'title';
  const update = (index: number, next: string | Entry) =>
    onChange(items.map((item, i) => (i === index ? next : item)));
  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => {
        let mainKey = defaultMainKey;
        if (typeof item !== 'string') {
          const candidates =
            kind === 'questions' ? ['title', 'text', 'content', 'question'] : ['title', 'text'];
          if (kind === 'faq') candidates.unshift('question');
          mainKey =
            candidates.find((key) => typeof item[key] === 'string' && item[key]) || defaultMainKey;
        }
        const patch = (key: string, next: unknown) =>
          update(index, {
            ...(typeof item === 'string' ? { [mainKey]: item } : item),
            [key]: next,
          });
        const input = (key: string, label: string, multiline = false) => {
          const id = `content-${kind}-${index}-${key}`;
          const current =
            typeof item === 'string'
              ? item
              : String(item[key] ?? (kind === 'faq' && key === 'answer' ? item.text : '') ?? '');
          let maxLength = key === 'title' ? 500 : 2000;
          if (typeof item === 'string' || key === 'text' || key === 'content') maxLength = 12000;
          if (key === 'question') maxLength = 1000;
          return (
            <div className="flex flex-col gap-2">
              <Label htmlFor={id}>{t(label)}</Label>
              {multiline ? (
                <Textarea
                  id={id}
                  value={current}
                  maxLength={12000}
                  onChange={(event) => patch(key, event.target.value)}
                />
              ) : (
                <Input
                  id={id}
                  value={current}
                  maxLength={maxLength}
                  onChange={(event) =>
                    typeof item === 'string'
                      ? update(index, event.target.value)
                      : patch(key, event.target.value)
                  }
                />
              )}
            </div>
          );
        };
        return (
          <div
            key={index}
            className="border-border-light flex flex-col gap-4 rounded-lg border p-4"
          >
            {typeof item === 'string' ? (
              <>
                {input(mainKey, defaultMainKey === 'question' ? 'contentQuestion' : 'contentBody')}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => update(index, { [mainKey]: item })}
                >
                  {t('expandContent')}
                </Button>
              </>
            ) : (
              <>
                {input(mainKey, defaultMainKey === 'question' ? 'contentQuestion' : 'contentTitle')}
                {kind === 'faq'
                  ? input('answer', 'contentAnswer', true)
                  : kind !== 'questions' &&
                    input(kind === 'banners' ? 'description' : 'content', 'contentBody', true)}
                {kind === 'banners' && input('image', 'contentImage')}
                {kind !== 'faq' && input('url', 'contentUrl')}
                {kind === 'questions' && (
                  <div className="flex flex-col gap-2">
                    <Label>{t('contentAgent')}</Label>
                    <Dropdown
                      ariaLabel={t('contentAgent')}
                      value={String(item.agentId || 'auto')}
                      portal={false}
                      options={[{ value: 'auto', label: t('defaultAgent') }, ...agents]}
                      onChange={(next) => patch('agentId', next === 'auto' ? '' : next)}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <Label>{t('contentAudience')}</Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {groups.map((group) => {
                      const selected = Array.isArray(item.groups) ? item.groups : [];
                      const id = `content-${kind}-${index}-group-${group.value}`;
                      return (
                        <div key={group.value} className="flex items-center gap-2">
                          <Checkbox
                            id={id}
                            aria-label={group.label}
                            checked={selected.includes(group.value)}
                            onCheckedChange={(checked) =>
                              patch(
                                'groups',
                                checked
                                  ? [...selected, group.value]
                                  : selected.filter((entry) => entry !== group.value),
                              )
                            }
                          />
                          <Label htmlFor={id}>{group.label}</Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              {t('removeContent')}
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        disabled={items.length >= 100}
        onClick={() => onChange([...items, { [defaultMainKey]: '' }])}
      >
        {t('addContent')}
      </Button>
    </div>
  );
}
