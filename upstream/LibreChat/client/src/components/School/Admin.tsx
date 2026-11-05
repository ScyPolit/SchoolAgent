import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Label,
  Textarea,
  Checkbox,
  Dropdown,
  OGDialog,
  OGDialogTemplate,
  Alert,
  Spinner,
  DataTable,
} from '@librechat/client';
import type { ReactNode } from 'react';
import type { SchoolRow, SchoolUser } from './api';
import type { TranslationKeys } from '~/hooks';
import { schoolRequest, schoolKeys, schoolDownload, canSchool, useSchoolBootstrap } from './api';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import IntegrationEditor, { IntegrationTest } from './IntegrationEditor';
import ContentEditor, { DurationChoice } from './ContentEditor';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import Section from '~/components/Nav/Settings/Section';
import { useLocalize } from '~/hooks';

type NativeColumns = Parameters<typeof DataTable<SchoolRow, unknown>>[0]['columns'];

type Catalog = {
  agents: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  integrations: { id: string; name: string }[];
};
type Field = {
  key: string;
  kind?:
    | 'text'
    | 'password'
    | 'email'
    | 'number'
    | 'textarea'
    | 'json'
    | 'lines'
    | 'content'
    | 'modules'
    | 'duration'
    | 'checks'
    | 'select'
    | 'boolean';
  options?: { value: string; label: string }[];
  agentOptions?: { value: string; label: string }[];
  required?: boolean;
  initial?: unknown;
  hint?: string;
  disabled?: boolean;
  minLength?: number;
  maxLength?: number;
};
type Dict = Record<string, unknown>;
const pages = [
  ['overview', 'statistics'],
  ['users', 'users'],
  ['groups', 'groups'],
  ['agents', 'agents'],
  ['integrations', 'integrations'],
  ['homepage', 'homepage'],
  ['statistics', 'statistics'],
  ['usage', 'logs'],
  ['conversations', 'conversations'],
  ['feedback', 'feedback'],
  ['audit', 'audit'],
  ['settings', 'settings'],
] as const;
const permissionNames = [
  'users',
  'groups',
  'agents',
  'integrations',
  'credentials',
  'homepage',
  'settings',
  'statistics',
  'logs',
  'conversations',
  'content_view',
  'content_export',
  'cleanup',
  'feedback',
  'audit',
];
function text(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}
const object = (value: unknown): Dict =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const values = (row: Dict, key: string) =>
  row[key] ?? row[key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())];
function stamp(value: unknown) {
  if (!value) return '—';
  const date = typeof value === 'number' ? value : String(value);
  return new Date(date).toLocaleString();
}
function decode(value: unknown, fallback: unknown) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
function rowList(value: unknown): SchoolRow[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && 'rows' in value && Array.isArray(value.rows))
    return value.rows;
  return [];
}
function useText() {
  const localize = useLocalize();
  return (key: string) => localize(('com_school_' + key) as TranslationKeys);
}
function FieldControl({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useText();
  const label = t(field.key);
  let control: ReactNode;
  if (field.kind === 'content') {
    control = (
      <ContentEditor
        kind={field.key}
        value={value}
        onChange={onChange}
        groups={field.options}
        agents={field.agentOptions}
      />
    );
  } else if (field.kind === 'modules') {
    control = (
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          'announcements',
          'banners',
          'recommended',
          'categories',
          'cards',
          'questions',
          'faq',
          'help',
          'contact',
          'footer',
        ].map((key) => (
          <div key={key} className="flex items-center gap-2">
            <Checkbox
              id={'school-module-' + key}
              aria-label={t(key)}
              checked={object(value)[key] !== false}
              onCheckedChange={(checked) => onChange({ ...object(value), [key]: checked === true })}
            />
            <Label htmlFor={'school-module-' + key}>{t(key)}</Label>
          </div>
        ))}
      </div>
    );
  } else if (field.kind === 'duration') {
    control = <DurationChoice label={label} value={Number(value)} onChange={onChange} />;
  } else if (field.kind === 'boolean') {
    control = (
      <Checkbox
        aria-label={label}
        id={'school-' + field.key}
        checked={!!value}
        onCheckedChange={(v) => onChange(v === true)}
      />
    );
  } else if (field.kind === 'checks') {
    control = (
      <div className="grid gap-3 sm:grid-cols-2">
        {field.options?.map((option) => (
          <div key={option.value} className="flex items-center gap-2">
            <Checkbox
              id={'school-' + field.key + '-' + option.value}
              aria-label={option.label}
              checked={list(value).includes(option.value)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...list(value), option.value]
                    : list(value).filter((item) => item !== option.value),
                )
              }
            />
            <Label htmlFor={'school-' + field.key + '-' + option.value}>{option.label}</Label>
          </div>
        ))}
      </div>
    );
  } else if (field.kind === 'select') {
    control = (
      <Dropdown
        ariaLabel={label}
        value={text(value)}
        onChange={onChange}
        options={field.options || []}
        portal={false}
      />
    );
  } else if (['textarea', 'json', 'lines'].includes(field.kind || '')) {
    control = (
      <Textarea
        id={'school-' + field.key}
        rows={field.kind === 'json' ? 10 : 4}
        value={text(value)}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
      />
    );
  } else {
    control = (
      <Input
        id={'school-' + field.key}
        type={field.kind || 'text'}
        value={text(value)}
        onChange={(event) =>
          onChange(field.kind === 'number' ? Number(event.target.value) : event.target.value)
        }
        required={field.required}
        disabled={field.disabled}
        minLength={field.minLength}
        maxLength={field.maxLength}
        autoComplete={field.kind === 'password' ? 'new-password' : undefined}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={'school-' + field.key}>{label}</Label>
      {control}
      {field.hint && <p className="text-text-secondary text-xs leading-relaxed">{field.hint}</p>}
    </div>
  );
}

function Editor({
  title,
  fields,
  item,
  path,
  method,
  onClose,
  onSaved,
  previewPath,
}: {
  title: string;
  previewPath?: string;
  fields: Field[];
  item?: Dict;
  path: string;
  method: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useText();
  const [form, setForm] = useState<Dict>(() =>
    Object.fromEntries(
      fields.map((f) => {
        let fallback: unknown = '';
        if (f.kind === 'boolean') fallback = false;
        if (f.kind === 'checks') fallback = [];
        let v = values(item || {}, f.key) ?? f.initial ?? fallback;
        if (['checks', 'lines', 'json', 'content', 'modules'].includes(f.kind || ''))
          v = decode(v, f.kind === 'json' ? {} : []);
        if (f.kind === 'json') v = JSON.stringify(v, null, 2);
        if (f.kind === 'lines') v = list(v).join('\n');
        return [f.key, v];
      }),
    ),
  );
  const preview = useMutation(() => schoolRequest<unknown>(previewPath || '', 'POST', form));
  const mutation = useMutation(
    async () => {
      const body = { ...form };
      for (const f of fields) {
        if (f.kind === 'json') body[f.key] = JSON.parse(text(form[f.key]) || '{}');
        if (f.kind === 'lines')
          body[f.key] = text(form[f.key])
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        if ((f.kind === 'password' && !form[f.key]) || f.disabled) delete body[f.key];
        if (f.required && !body[f.key] && !f.disabled) throw new Error(t('required'));
      }
      if (path === '/admin/users' && !list(body.groupIds).length) delete body.groupIds;
      if (
        path.startsWith('/admin/integrations') &&
        ['dify-workflow', 'dify-chatflow'].includes(text(body.platform))
      ) {
        body.config = {
          ...object(body.config),
          mode: body.platform === 'dify-workflow' ? 'workflow' : 'chatflow',
        };
      }
      return schoolRequest(path, method, body);
    },
    {
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );
  return (
    <OGDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <OGDialogTemplate
        title={title}
        className="max-h-[90vh] max-w-3xl"
        main={
          <form
            id="school-editor"
            className="flex max-h-[65vh] flex-col gap-6 overflow-y-auto p-1"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.error instanceof Error && (
              <Alert variant="error">{mutation.error.message}</Alert>
            )}
            {previewPath && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={preview.isLoading}
                  onClick={() => preview.mutate()}
                >
                  {t('previewRetention')}
                </Button>
                {preview.error instanceof Error && (
                  <Alert variant="error">{preview.error.message}</Alert>
                )}
                {preview.data != null && (
                  <Alert variant="neutral">
                    <pre className="text-xs whitespace-pre-wrap">
                      {JSON.stringify(preview.data, null, 2)}
                    </pre>
                  </Alert>
                )}
              </>
            )}
            {fields.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                value={form[field.key]}
                onChange={(value) => setForm((prev) => ({ ...prev, [field.key]: value }))}
              />
            ))}
          </form>
        }
        buttons={
          <Button form="school-editor" type="submit" variant="submit" disabled={mutation.isLoading}>
            {mutation.isLoading ? t('saving') : t('save')}
          </Button>
        }
        selection={undefined}
      />
    </OGDialog>
  );
}
function schemas(
  page: string,
  catalog: Catalog,
  user: SchoolUser,
  t: (s: string) => string,
  editing: boolean,
): Field[] {
  const options = (rows: { id: string; name: string }[]) =>
    rows.map((r) => ({ value: r.id, label: r.name }));
  switch (page) {
    case 'users':
      return [
        { key: 'name', required: true },
        ...(!editing
          ? ([
              { key: 'email', kind: 'email', required: true },
              { key: 'password', kind: 'password', required: true, minLength: 12, maxLength: 256 },
            ] as Field[])
          : []),
        { key: 'groupIds', kind: 'checks', options: options(catalog.groups) },
        ...(editing ? ([{ key: 'active', kind: 'boolean' }] as Field[]) : []),
        ...(user.role === 'superadmin'
          ? ([
              {
                key: 'role',
                kind: 'select',
                initial: 'user',
                options: ['user', 'admin', 'superadmin'].map((value) => ({
                  value,
                  label: t(value === 'admin' ? 'administrator' : value),
                })),
              },
              {
                key: 'permissions',
                kind: 'checks',
                options: permissionNames.map((value) => ({ value, label: t(value) })),
              },
            ] as Field[])
          : []),
      ];
    case 'groups':
      return [
        { key: 'name', required: true },
        {
          key: 'agentIds',
          kind: 'checks',
          options: [{ value: '*', label: t('all') }, ...options(catalog.agents)],
        },
        {
          key: 'contentKeys',
          kind: 'checks',
          options: [
            '*',
            'announcements',
            'banners',
            'recommended',
            'categories',
            'cards',
            'questions',
            'faq',
            'help',
            'contact',
            'footer',
          ].map((value) => ({ value, label: t(value === '*' ? 'all' : value) })),
        },
      ];
    case 'agents':
      return [
        { key: 'name', required: true },
        { key: 'avatar' },
        { key: 'description', kind: 'textarea' },
        { key: 'category' },
        {
          key: 'integrationId',
          kind: 'select',
          required: true,
          options: options(catalog.integrations),
        },
        { key: 'questions', kind: 'lines' },
        { key: 'sortOrder', kind: 'number', initial: 0 },
        { key: 'recommended', kind: 'boolean' },
        { key: 'homepageVisible', kind: 'boolean', initial: true },
        { key: 'published', kind: 'boolean' },
      ];
    default:
      return [];
  }
}
function Members({
  group,
  onClose,
  onSaved,
}: {
  group: SchoolRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useText();
  const { data, error } = useQuery<{
    members: string[];
    candidates: { id: string; name: string; email: string }[];
  }>(schoolKeys.admin('members:' + group.id), () =>
    schoolRequest<{ members: string[]; candidates: { id: string; name: string; email: string }[] }>(
      `/admin/groups/${group.id}/members`,
    ),
  );
  return !data ? (
    <OGDialog open onOpenChange={onClose}>
      <OGDialogTemplate
        title={t('members')}
        main={error instanceof Error ? <Alert variant="error">{error.message}</Alert> : <Spinner />}
        selection={undefined}
      />
    </OGDialog>
  ) : (
    <Editor
      title={t('members')}
      item={{ userIds: data.members }}
      fields={[
        {
          key: 'userIds',
          kind: 'checks',
          options: data.candidates.map((u) => ({ value: u.id, label: u.name + ' · ' + u.email })),
        },
      ]}
      path={`/admin/groups/${group.id}/members`}
      method="PUT"
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
function RecordBody({ row }: { row: SchoolRow }) {
  return (
    <div className="flex flex-col gap-6">
      {list(row.allMessages || row.messages).map((raw, i) => {
        const m = object(raw);
        return (
          <Section key={text(m.id) || i} heading={String(i + 1)}>
            <div className="px-4 py-3">
              <MarkdownLite codeExecution={false} content={text(m.content)} />
              {list(m.versions).map((rawVersion, j) => {
                const v = object(rawVersion);
                return (
                  <div className="border-border-light mt-5 border-t pt-4" key={text(v.id) || j}>
                    <p className="text-text-secondary mb-3 text-xs">
                      {text(v.status)} · {text(v.id)}
                    </p>
                    <MarkdownLite codeExecution={false} content={text(v.content)} />
                    {typeof v.error === 'string' && v.error && (
                      <Alert variant="error">{text(v.error)}</Alert>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
function ImportUsers({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useText();
  const [source, setSource] = useState('');
  const mutation = useMutation(
    async () => {
      let rows: unknown;
      if (source.trim().startsWith('[')) rows = JSON.parse(source);
      else {
        const data: string[][] = [];
        let row: string[] = [],
          cell = '',
          quoted = false;
        for (let i = 0; i < source.length; i++) {
          const c = source[i];
          if (c === '"') {
            if (quoted && source[i + 1] === '"') {
              cell += '"';
              i++;
            } else quoted = !quoted;
          } else if (c === ',' && !quoted) {
            row.push(cell);
            cell = '';
          } else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && source[i + 1] === '\n') i++;
            row.push(cell);
            if (row.some((s) => s.trim())) data.push(row);
            row = [];
            cell = '';
          } else cell += c;
        }
        if (quoted) throw new Error(t('invalidJson'));
        row.push(cell);
        if (row.some((s) => s.trim())) data.push(row);
        const header = data.shift() || [];
        rows = data.map((cells) =>
          Object.fromEntries(
            header.map((h, i) => [
              h.trim(),
              h.trim() === 'groupIds'
                ? (cells[i]?.trim() || '')
                    .split('|')
                    .map((value) => value.trim())
                    .filter(Boolean)
                : cells[i]?.trim() || '',
            ]),
          ),
        );
      }
      return schoolRequest<{ results: { email: string; success: boolean; error?: string }[] }>(
        '/admin/users/import',
        'POST',
        { rows },
      );
    },
    { onSuccess: onSaved },
  );
  return (
    <OGDialog open onOpenChange={onClose}>
      <OGDialogTemplate
        title={t('import')}
        main={
          <div className="flex flex-col gap-4">
            <Alert variant="neutral">{t('importHint')}</Alert>
            <Textarea
              aria-label={t('import')}
              rows={9}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            {mutation.error instanceof Error && (
              <Alert variant="error">{mutation.error.message}</Alert>
            )}
            {mutation.data?.results.map((r, i) => (
              <Alert key={i} variant={r.success ? 'success' : 'error'}>
                {r.email} · {r.error || t('success')}
              </Alert>
            ))}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            disabled={!source.trim() || mutation.isLoading}
            onClick={() => mutation.mutate()}
          >
            {t('import')}
          </Button>
        }
        selection={undefined}
      />
    </OGDialog>
  );
}
function Resource({ page, user, catalog }: { page: string; user: SchoolUser; catalog: Catalog }) {
  const t = useText(),
    queryClient = useQueryClient();
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [applied, setApplied] = useState<Record<string, string>>({}),
    [editor, setEditor] = useState<SchoolRow | null | false>(false),
    [members, setMembers] = useState<SchoolRow | null>(null),
    [testing, setTesting] = useState<SchoolRow | null>(null),
    [importing, setImporting] = useState(false),
    [detail, setDetail] = useState<SchoolRow | null>(null),
    [error, setError] = useState(''),
    [purge, setPurge] = useState<SchoolRow[] | null>(null),
    [confirm, setConfirm] = useState('');
  const query = new URLSearchParams(Object.entries(applied).filter(([, v]) => v));
  const resource = useQuery<unknown>(
    [...schoolKeys.admin(page), query.toString()],
    () => schoolRequest(`/admin/${page}?${query}`),
    { retry: false },
  );
  const refresh = () => {
    void queryClient.invalidateQueries();
  };
  const action = useMutation(
    ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) =>
      schoolRequest<unknown>(path, method, body),
  );
  async function act(path: string, method = 'POST', body?: unknown) {
    setError('');
    try {
      const result = await action.mutateAsync({ path, method, body });
      refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
      return undefined;
    }
  }
  const rows = rowList(resource.data),
    editable = ['users', 'groups', 'agents', 'integrations'].includes(page),
    filtersVisible = ['statistics', 'usage', 'conversations'].includes(page);
  const canCredentials = canSchool(user, 'credentials');
  const columns: NativeColumns = [
    {
      id: 'name',
      accessorFn: (record) =>
        [
          record.name,
          record.title,
          record.email,
          record.agentName,
          record.action,
          record.id,
          record.actorId,
          record.traceId,
        ]
          .map(text)
          .join(' '),
      header: t(page),
      cell: ({ row }) => (
        <div>
          <p className="font-medium">
            {row.original.name ||
              row.original.title ||
              text(row.original.agentName) ||
              text(row.original.action) ||
              row.original.id}
          </p>
          <p className="text-text-secondary mt-1 text-xs">
            {row.original.email || text(row.original.agentId) || text(row.original.target)}
          </p>
        </div>
      ),
    },
    {
      id: 'metadata',
      header: t('details'),
      cell: ({ row }) => {
        const r = row.original;
        let executionLabel = t('notDispatched');
        if (r.executionRequested) executionLabel = t('dispatched');
        if (r.executionMode === 'demo') executionLabel = t('demo');
        return (
          <div className="text-text-secondary space-y-1 text-xs">
            {[
              'role',
              'category',
              'platform',
              'ownerType',
              'actorType',
              'actorId',
              'ownerId',
              'versionId',
              'conversationId',
              'kind',
              'errorCode',
              'traceId',
            ]
              .filter((key) => r[key] != null)
              .map((key) => (
                <p key={key}>
                  {t(key)}: {text(r[key])}
                </p>
              ))}
            <p>{stamp(r.startedAt || r.createdAt || r.created_at)}</p>
            {r.durationMs != null && (
              <p>
                {t('duration')}: {Number(r.durationMs) / 1000} {t('seconds')}
              </p>
            )}
            {r.executionMode != null && <p>{executionLabel}</p>}
            {r.capabilities != null && (
              <details>
                <summary>{t('capabilities')}</summary>
                <pre className="max-w-sm overflow-auto text-xs">
                  {JSON.stringify(r.capabilities, null, 2)}
                </pre>
              </details>
            )}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: t('status'),
      cell: ({ row }) => {
        const record = row.original;
        let status = stamp(record.createdAt || record.created_at || record.startedAt);
        if (record.hiddenAt) status = t('hidden');
        if (typeof record.active === 'boolean') status = t(record.active ? 'active' : 'inactive');
        if (typeof record.published === 'boolean')
          status = t(record.published ? 'published' : 'unpublished');
        if (typeof record.status === 'string') status = t(record.status);
        return <div className="text-xs">{status}</div>;
      },
    },
    {
      id: 'actions',
      header: t('actions'),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-wrap justify-end gap-2">
            {['feedback', 'audit', 'usage'].includes(page) && (
              <Button variant="outline" onClick={() => setDetail(r)}>
                {t('details')}
              </Button>
            )}
            {editable && (page !== 'integrations' || canCredentials) && (
              <Button variant="outline" onClick={() => setEditor(r)}>
                {t('edit')}
              </Button>
            )}
            {page === 'users' && (
              <Button
                variant="outline"
                onClick={() =>
                  act(`/admin/users/${r.id}/reset-password`).then((result) => {
                    if (result) setDetail({ id: r.id, ...object(result) });
                  })
                }
              >
                {t('resetPassword')}
              </Button>
            )}
            {page === 'groups' && (
              <Button variant="outline" onClick={() => setMembers(r)}>
                {t('members')}
              </Button>
            )}
            {page === 'integrations' && canCredentials && (
              <Button variant="outline" disabled={action.isLoading} onClick={() => setTesting(r)}>
                {t('test')}
              </Button>
            )}
            {['groups', 'agents'].includes(page) && (
              <Button
                variant="outline"
                onClick={() => {
                  setPurge([r]);
                  setConfirm('');
                }}
              >
                {t(page === 'agents' ? 'unpublish' : 'delete')}
              </Button>
            )}
            {page === 'conversations' && canSchool(user, 'content_view') && (
              <Button
                variant="outline"
                onClick={() =>
                  act(`/admin/conversations/${r.id}`, 'GET').then((result) => {
                    if (result) setDetail(result as SchoolRow);
                  })
                }
              >
                {t('viewContent')}
              </Button>
            )}
            {page === 'conversations' &&
              canSchool(user, 'content_view') &&
              canSchool(user, 'content_export') &&
              ['md', 'pdf', 'png'].map((format) => (
                <Button
                  key={format}
                  variant="outline"
                  onClick={() =>
                    schoolDownload(`/admin/conversations/${r.id}/export?format=${format}`).catch(
                      (e) => setError(e.message),
                    )
                  }
                >
                  {format.toUpperCase()}
                </Button>
              ))}
            {page === 'feedback' && (
              <Button variant="outline" onClick={() => setEditor(r)}>
                {t('process')}
              </Button>
            )}
          </div>
        );
      },
    },
  ];
  const stats = object(object(resource.data).totals);
  const statisticColumns: NativeColumns = [
    {
      id: 'group',
      header: t('details'),
      accessorFn: (record) =>
        text(record.agentName || record.day || record.kind || record.userType),
      cell: ({ row }) =>
        text(
          row.original.agentName || row.original.day || row.original.kind || row.original.userType,
        ),
    },
    ...[
      'people',
      'conversations',
      'attempts',
      'calls',
      'demoCalls',
      'configRejected',
      'success',
      'failed',
      'stopped',
      'unknown',
      'avgDurationMs',
    ].map((key) => ({
      accessorKey: key,
      header: t(key),
      cell: ({ row }: { row: { original: SchoolRow } }) =>
        row.original[key] == null ? '—' : text(row.original[key]),
    })),
  ];
  return (
    <div className="flex flex-col gap-6">
      {error && <Alert variant="error">{error}</Alert>}
      {resource.error instanceof Error && <Alert variant="error">{resource.error.message}</Alert>}
      {filtersVisible && (
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const next = { ...filters };
            if (next.from) next.from = String(new Date(next.from + 'T00:00:00').getTime());
            if (next.to) next.to = String(new Date(next.to + 'T23:59:59.999').getTime());
            setApplied(next);
          }}
        >
          {(['from', 'to'] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <Label>{t(key)}</Label>
              <Input
                type="date"
                aria-label={t(key)}
                value={filters[key] || ''}
                onChange={(e) => setFilters((v) => ({ ...v, [key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label>{t('agentId')}</Label>
            <Dropdown
              ariaLabel={t('agentId')}
              value={filters.agentId || ''}
              onChange={(v) => setFilters((s) => ({ ...s, agentId: v }))}
              options={[
                { value: '', label: t('all') },
                ...catalog.agents.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t('userType')}</Label>
            <Dropdown
              ariaLabel={t('userType')}
              value={filters.userType || ''}
              onChange={(v) => setFilters((s) => ({ ...s, userType: v }))}
              options={['', 'user', 'guest'].map((value) => ({ value, label: t(value || 'all') }))}
            />
          </div>
          {page === 'conversations' && (
            <>
              <Input
                aria-label={t('ownerId')}
                placeholder={t('ownerId')}
                value={filters.ownerId || ''}
                onChange={(e) => setFilters((s) => ({ ...s, ownerId: e.target.value }))}
              />
              {canSchool(user, 'content_view') && (
                <Input
                  aria-label={t('search')}
                  placeholder={t('search')}
                  value={filters.q || ''}
                  onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))}
                />
              )}
            </>
          )}
          <Button type="submit" variant="outline">
            {t('filter')}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap gap-3">
        {editable && (page !== 'integrations' || canCredentials) && (
          <Button variant="submit" onClick={() => setEditor(null)}>
            {t('create')}
          </Button>
        )}
        {page === 'users' && (
          <Button variant="outline" onClick={() => setImporting(true)}>
            {t('import')}
          </Button>
        )}
        {page === 'feedback' && (
          <Dropdown
            ariaLabel={t('status')}
            value={filters.status || ''}
            onChange={(v) => {
              setFilters({ status: v });
              setApplied({ status: v });
            }}
            options={['', 'open', 'processing', 'resolved', 'closed'].map((value) => ({
              value,
              label: t(value || 'all'),
            }))}
          />
        )}
        <Button variant="outline" onClick={() => resource.refetch()}>
          {t('refresh')}
        </Button>
      </div>
      {resource.isLoading && <Spinner />}
      {!resource.isLoading && page === 'statistics' && (
        <>
          <Alert variant="neutral">{t('statisticsHint')}</Alert>
          <Section heading={t('statistics')}>
            <div className="grid gap-4 p-4 sm:grid-cols-3">
              {Object.entries(stats).map(([key, value]) => (
                <div key={key}>
                  <p className="text-text-secondary text-xs">{t(key)}</p>
                  <p className="mt-2 text-2xl font-medium">{String(value ?? 0)}</p>
                </div>
              ))}
            </div>
          </Section>
          {['byAgent', 'byDay', 'byKind', 'byUserType'].map((group) => (
            <Section key={group} heading={t(group)}>
              <DataTable
                columns={statisticColumns}
                data={rowList(object(resource.data)[group])}
                enableSearch={false}
                enableRowSelection={false}
                showCheckboxes={false}
              />
            </Section>
          ))}
        </>
      )}
      {!resource.isLoading && page === 'overview' && (
        <Section heading={t('overview')}>
          <div className="grid gap-6 p-4 sm:grid-cols-3">
            {['userCount', 'agentCount', 'conversationCount', 'callCount', 'demoCalls', 'attempts']
              .filter((key) => object(resource.data)[key] != null)
              .map((key) => (
                <div key={key}>
                  <Label>{t(key)}</Label>
                  <p className="mt-2 text-3xl">{text(object(resource.data)[key])}</p>
                </div>
              ))}
          </div>
        </Section>
      )}
      {!resource.isLoading && !['overview', 'statistics'].includes(page) && (
        <DataTable
          columns={columns}
          data={rows}
          enableSearch={[
            'users',
            'groups',
            'agents',
            'integrations',
            'feedback',
            'audit',
            'usage',
          ].includes(page)}
          filterColumn="name"
          enableRowSelection={page === 'conversations' && canSchool(user, 'cleanup')}
          showCheckboxes={page === 'conversations' && canSchool(user, 'cleanup')}
          onDelete={
            page === 'conversations' && canSchool(user, 'cleanup')
              ? async (selected) => {
                  setPurge(selected);
                  setConfirm('');
                }
              : undefined
          }
        />
      )}
      {editor !== false && page === 'integrations' && (
        <IntegrationEditor
          item={editor || undefined}
          onClose={() => setEditor(false)}
          onSaved={refresh}
        />
      )}
      {editor !== false && page !== 'integrations' && (
        <Editor
          title={t(editor ? 'edit' : 'create')}
          fields={
            page === 'feedback'
              ? [
                  {
                    key: 'status',
                    kind: 'select',
                    options: ['open', 'processing', 'resolved', 'closed'].map((value) => ({
                      value,
                      label: t(value),
                    })),
                  },
                  { key: 'notes', kind: 'textarea' },
                ]
              : schemas(page, catalog, user, t, !!editor)
          }
          item={editor || undefined}
          path={`/admin/${page}${editor ? '/' + editor.id : ''}`}
          method={editor ? 'PATCH' : 'POST'}
          onClose={() => setEditor(false)}
          onSaved={refresh}
        />
      )}
      {members && <Members group={members} onClose={() => setMembers(null)} onSaved={refresh} />}
      {testing && (
        <IntegrationTest item={testing} onClose={() => setTesting(null)} onTested={refresh} />
      )}
      {importing && <ImportUsers onClose={() => setImporting(false)} onSaved={refresh} />}
      {detail && (
        <OGDialog open onOpenChange={() => setDetail(null)}>
          <OGDialogTemplate
            title={detail.title || detail.name || t('details')}
            className="max-w-4xl"
            main={
              <div className="max-h-[65vh] overflow-y-auto">
                {detail.messages ? (
                  <RecordBody row={detail} />
                ) : (
                  <pre className="text-xs whitespace-pre-wrap">
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                )}
              </div>
            }
            selection={undefined}
          />
        </OGDialog>
      )}
      {purge && (
        <OGDialog open onOpenChange={() => setPurge(null)}>
          <OGDialogTemplate
            title={t(
              ({ conversations: 'purge', agents: 'unpublish' } as Record<string, string>)[page] ||
                'delete',
            )}
            main={
              <div className="flex flex-col gap-5">
                <Alert variant="warning">
                  {t(
                    (
                      { conversations: 'purgeHint', agents: 'unpublishHint' } as Record<
                        string,
                        string
                      >
                    )[page] || 'deleteHint',
                  )}
                </Alert>
                <Label>
                  {t('confirmHint')}
                  <Input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="CONFIRM"
                  />
                </Label>
              </div>
            }
            buttons={
              <Button
                variant="destructive"
                disabled={confirm !== 'CONFIRM' || action.isLoading}
                onClick={async () => {
                  const result =
                    page === 'conversations'
                      ? await act('/admin/conversations/purge', 'POST', {
                          ids: purge.map((r) => r.id),
                          confirm: true,
                        })
                      : await act(`/admin/${page}/${purge[0].id}`, 'DELETE');
                  if (result) setPurge(null);
                }}
              >
                {t('confirm')}
              </Button>
            }
            selection={undefined}
          />
        </OGDialog>
      )}
    </div>
  );
}
function SettingsPage({
  page,
  user,
  catalog,
}: {
  page: string;
  user: SchoolUser;
  catalog: Catalog;
}) {
  const t = useText(),
    queryClient = useQueryClient();
  const data = useQuery<Dict>(
    schoolKeys.admin('settings'),
    () => schoolRequest('/admin/settings'),
    { retry: false },
  );
  const [editing, setEditing] = useState(''),
    [to, setTo] = useState(''),
    [result, setResult] = useState<unknown>(null);
  const action = useMutation(
    ({ path, body }: { path: string; body: unknown }) => schoolRequest(path, 'POST', body),
    { onSuccess: setResult },
  );
  const groups = catalog.groups.map((g) => ({ value: g.id, label: g.name }));
  const keys = page === 'homepage' ? ['homepage'] : ['smtp', 'retention', 'defaults'];
  function fields(key: string): Field[] {
    if (key === 'homepage')
      return [
        { key: 'schoolName' },
        { key: 'platformName' },
        { key: 'logo' },
        { key: 'themeColor', disabled: true, hint: t('nativeThemeHint') },
        { key: 'welcome' },
        { key: 'subtitle' },
        ...['announcements', 'banners', 'questions', 'faq'].map(
          (key) =>
            ({
              key,
              kind: 'content',
              options: groups,
              agentOptions: catalog.agents.map((agent) => ({ value: agent.id, label: agent.name })),
            }) as Field,
        ),
        { key: 'modules', kind: 'modules' },
        { key: 'help', kind: 'textarea' },
        { key: 'contact', kind: 'textarea' },
        { key: 'footer', kind: 'textarea' },
      ];
    if (key === 'smtp')
      return [
        { key: 'host' },
        { key: 'port', kind: 'number' },
        {
          key: 'encryption',
          kind: 'select',
          options: [
            ['starttls', 'smtpStarttls'],
            ['tls', 'smtpTls'],
            ['none', 'smtpNone'],
          ].map(([value, label]) => ({ value, label: t(label) })),
        },
        { key: 'from' },
        { key: 'username' },
        { key: 'password', kind: 'password', hint: t('secretHint'), maxLength: 16000 },
        { key: 'clearPassword', kind: 'boolean' },
      ];
    if (key === 'retention')
      return ['guestBrowserDays', 'guestServerDays', 'usageDays', 'auditDays', 'shareDays']
        .map((key) => ({ key, kind: 'duration' }) as Field)
        .concat([{ key: 'confirmShortening', kind: 'boolean', hint: t('retentionHint') }]);
    return [
      { key: 'guestGroupId', kind: 'select', options: groups },
      { key: 'userGroupId', kind: 'select', options: groups },
    ];
  }
  const refresh = () => {
    void queryClient.invalidateQueries();
  };
  return (
    <div className="flex flex-col gap-6">
      {data.isLoading && <Spinner />}
      {data.error instanceof Error && <Alert variant="error">{data.error.message}</Alert>}
      {!data.isLoading &&
        !data.error &&
        keys.map((key) => (
          <Section key={key} heading={t(key)}>
            <div className="flex flex-col gap-4 px-4 py-3">
              <p className="text-text-secondary text-sm leading-relaxed">{t(key + 'Hint')}</p>
              <Button
                variant="outline"
                disabled={
                  (key === 'smtp' && !canSchool(user, 'credentials')) ||
                  (key === 'defaults' && user.role !== 'superadmin')
                }
                onClick={() => setEditing(key)}
              >
                {t('edit')}
              </Button>
              {key === 'smtp' && canSchool(user, 'credentials') && (
                <div className="flex flex-wrap gap-3">
                  <Input
                    type="email"
                    aria-label={t('testTo')}
                    placeholder={t('testTo')}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!to || action.isLoading}
                    onClick={() => action.mutate({ path: '/admin/smtp/test', body: { to } })}
                  >
                    {t('testMail')}
                  </Button>
                </div>
              )}
              {key === 'retention' && canSchool(user, 'cleanup') && (
                <Button
                  variant="outline"
                  disabled={action.isLoading}
                  onClick={() =>
                    action.mutate({ path: '/admin/retention/preview', body: data.data?.retention })
                  }
                >
                  {t('previewRetention')}
                </Button>
              )}
            </div>
          </Section>
        ))}
      {action.error instanceof Error && <Alert variant="error">{action.error.message}</Alert>}
      {result != null && (
        <Alert variant="neutral">
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
        </Alert>
      )}
      {editing && (
        <Editor
          title={t(editing)}
          fields={fields(editing)}
          item={object(data.data?.[editing])}
          path={'/admin/settings/' + editing}
          previewPath={
            editing === 'retention' && canSchool(user, 'cleanup')
              ? '/admin/retention/preview'
              : undefined
          }
          method="PUT"
          onClose={() => setEditing('')}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
export default function SchoolAdmin() {
  const t = useText();
  const { data: bootstrap, isLoading, error: bootstrapError, refetch } = useSchoolBootstrap();
  const user = bootstrap?.user;
  const [page, setPage] = useState('');
  const catalog = useQuery<Catalog>(schoolKeys.catalog, () => schoolRequest('/admin/catalog'), {
    enabled: !!user && ['admin', 'superadmin'].includes(user.role),
    retry: false,
  });
  const allowed = pages.filter(([, permission]) => canSchool(user, permission));
  const current = allowed.some(([key]) => key === page) ? page : allowed[0]?.[0] || '';
  if (isLoading) return <Spinner />;
  if (bootstrapError instanceof Error)
    return (
      <main className="text-text-primary flex h-full flex-col gap-4 p-6">
        <OpenSidebar />
        <Alert variant="error">{bootstrapError.message}</Alert>
        <Button variant="outline" onClick={() => void refetch()}>
          {t('refresh')}
        </Button>
      </main>
    );
  if (!user || !['admin', 'superadmin'].includes(user.role))
    return (
      <main className="text-text-primary flex h-full flex-col gap-4 p-6">
        <OpenSidebar />
        <Alert variant="warning">{t('permissionDenied')}</Alert>
      </main>
    );
  return (
    <main className="text-text-primary bg-surface-primary-alt flex h-full min-w-0 flex-col overflow-hidden">
      <header className="border-border-light flex shrink-0 items-center gap-3 border-b p-4">
        <OpenSidebar />
        <h1 className="text-lg font-medium">{t('admin')}</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <nav
          className="border-border-light flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:w-48 md:flex-col md:border-e md:border-b-0"
          aria-label={t('admin')}
        >
          {allowed.map(([key]) => (
            <Button
              key={key}
              variant="nav"
              size="row"
              className="justify-start"
              aria-current={current === key ? 'page' : undefined}
              onClick={() => setPage(key)}
            >
              {t(key)}
            </Button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-5 md:p-7">
          <h2 className="mb-6 text-xl font-medium">{t(current)}</h2>
          {catalog.isLoading && <Spinner />}
          {catalog.error instanceof Error && <Alert variant="error">{catalog.error.message}</Alert>}
          {!catalog.isLoading &&
            !catalog.error &&
            catalog.data &&
            current &&
            (['settings', 'homepage'].includes(current) ? (
              <SettingsPage key={current} page={current} user={user} catalog={catalog.data} />
            ) : (
              <Resource key={current} page={current} user={user} catalog={catalog.data} />
            ))}
        </div>
      </div>
    </main>
  );
}
