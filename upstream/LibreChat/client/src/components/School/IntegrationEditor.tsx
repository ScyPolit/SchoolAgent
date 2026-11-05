import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Dropdown,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Textarea,
} from '@librechat/client';
import type { ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';
import type { SchoolRow } from './api';
import { schoolRequest, useSchoolBootstrap } from './api';
import { useLocalize } from '~/hooks';

type Config = Record<string, unknown>;
const record = (value: unknown): Config =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Config) : {};
const string = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

function VariableChoice({
  label,
  value,
  choices,
  onChange,
  optional = false,
}: {
  label: string;
  value: string;
  choices: string[];
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  const localize = useLocalize();
  const t = (key: string) => localize(('com_school_' + key) as TranslationKeys);
  const [custom, setCustom] = useState(!!value && !choices.includes(value));
  const options = [
    ...(optional ? [{ value: 'none', label: t('noHistoryInput') }] : []),
    ...choices.map((entry) => ({ value: entry, label: entry })),
    { value: 'custom', label: t('customVariable') },
  ];
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Dropdown
        ariaLabel={label}
        value={custom ? 'custom' : value || (optional ? 'none' : choices[0])}
        options={options}
        portal={false}
        onChange={(next) => {
          setCustom(next === 'custom');
          onChange(next === 'custom' || next === 'none' ? '' : next);
        }}
      />
      {custom && (
        <Input
          aria-label={label}
          value={value}
          maxLength={200}
          required={!optional}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

export default function IntegrationEditor({
  item,
  onClose,
  onSaved,
}: {
  item?: SchoolRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const localize = useLocalize();
  const t = (key: string) => localize(('com_school_' + key) as TranslationKeys);
  const { data: bootstrap } = useSchoolBootstrap();
  const initial = record(item?.config);
  const [platform, setPlatform] = useState(string(item?.platform, 'dify-chatflow'));
  const [name, setName] = useState(item?.name || '');
  const [baseUrl, setBaseUrl] = useState(string(item?.baseUrl ?? item?.base_url));
  const [appCode, setAppCode] = useState(string(item?.appId ?? item?.app_id));
  const [config, setConfig] = useState<Config>(initial);
  const [apiKey, setApiKey] = useState('');
  const [gatewayAppId, setGatewayAppId] = useState('');
  const [appKey, setAppKey] = useState('');
  const [paramKey, setParamKey] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [inputs, setInputs] = useState(JSON.stringify(initial.inputs || {}, null, 2));
  const polymas = platform === 'polymas';
  const demo = platform === 'demo';
  const difyMode =
    platform === 'dify-workflow' || config.mode === 'workflow' ? 'workflow' : 'chatflow';
  const polymasMode = config.mode === 'assistant' ? 'assistant' : 'tool';
  const mode = polymas ? polymasMode : difyMode;
  const mapped = mode === 'workflow' || mode === 'tool';
  const responseMode = string(config.responseMode, 'streaming');
  const encryption = string(config.encryption, mode === 'assistant' ? 'aes-ecb-zero' : 'plain');
  const update = (key: string, value: unknown) =>
    setConfig((previous) => ({ ...previous, [key]: value }));
  const mutation = useMutation(
    async () => {
      const extras: unknown = JSON.parse(inputs || '{}');
      if (!extras || typeof extras !== 'object' || Array.isArray(extras))
        throw new Error(t('inputsObjectRequired'));
      const next: Config = {
        ...config,
        mode,
        inputs: extras,
        responseMode: mode === 'assistant' ? 'streaming' : responseMode,
      };
      if (mapped) {
        next.queryField = string(config.queryField, 'query');
        next.answerField = string(config.answerField, 'answer');
        next.historyField = string(config.historyField);
        if (!next.queryField || !next.answerField) throw new Error(t('required'));
      }
      if (polymas) {
        next.encryption = encryption;
        next.authHeader = string(config.authHeader, 'raw');
      }
      let credentials: Config = apiKey ? { apiKey } : {};
      if (polymas) credentials = { credentials: { gatewayAppId, appKey, paramKey } };
      return schoolRequest(
        `/admin/integrations${item ? '/' + item.id : ''}`,
        item ? 'PATCH' : 'POST',
        {
          name,
          platform,
          baseUrl: polymas ? baseUrl || 'https://openapi.polymas.com' : baseUrl,
          appId: appCode,
          config: next,
          clearSecret,
          ...credentials,
        },
      );
    },
    {
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );

  function field(key: string, control: ReactNode, hint?: string) {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={'integration-' + key}>{t(key)}</Label>
        {control}
        {hint && <p className="text-text-secondary text-xs leading-relaxed">{hint}</p>}
      </div>
    );
  }
  function select(
    key: string,
    value: string,
    choices: [string, string][],
    change: (value: string) => void,
  ) {
    return field(
      key,
      <Dropdown
        ariaLabel={t(key)}
        value={value}
        options={choices.map(([value, label]) => ({ value, label: t(label) }))}
        onChange={change}
        portal={false}
      />,
    );
  }
  function secret(key: string, value: string, change: (value: string) => void) {
    return field(
      key,
      <Input
        id={'integration-' + key}
        type="password"
        value={value}
        maxLength={16000}
        autoComplete="new-password"
        onChange={(event) => change(event.target.value)}
      />,
      t('secretHint'),
    );
  }
  return (
    <OGDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <OGDialogTemplate
        title={t(item ? 'editIntegration' : 'createIntegration')}
        className="max-h-[90vh] max-w-3xl"
        main={
          <form
            id="school-integration-editor"
            className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto p-1"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <p className="text-text-secondary text-sm leading-relaxed">{t('integrationGuide')}</p>
            {mutation.error instanceof Error && (
              <Alert variant="error">{mutation.error.message}</Alert>
            )}
            {field(
              'name',
              <Input
                id="integration-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
              />,
            )}
            {select(
              'platform',
              platform,
              [
                ['dify-chatflow', 'difyChatflow'],
                ['dify-workflow', 'difyWorkflow'],
                ['polymas', 'polymasPlatform'],
                ...(platform === 'dify' ? [['dify', 'difyLegacy'] as [string, string]] : []),
                ...(bootstrap?.development || demo
                  ? [['demo', 'demoPlatform'] as [string, string]]
                  : []),
              ],
              (value) => {
                setPlatform(value);
                const nextDifyMode = value === 'dify-workflow' ? 'workflow' : 'chatflow';
                setConfig({ mode: value === 'polymas' ? 'tool' : nextDifyMode });
                setBaseUrl(value === 'polymas' ? 'https://openapi.polymas.com' : '');
                setAppCode('');
                setApiKey('');
                setGatewayAppId('');
                setAppKey('');
                setParamKey('');
                setInputs('{}');
                setClearSecret(false);
              },
            )}
            {polymas &&
              select(
                'polymasMode',
                mode,
                [
                  ['tool', 'polymasTool'],
                  ['assistant', 'polymasAssistant'],
                ],
                (value) => {
                  setConfig((previous) => ({
                    ...previous,
                    mode: value,
                    encryption: value === 'assistant' ? 'aes-ecb-zero' : 'plain',
                  }));
                },
              )}
            {!demo && (
              <>
                {field(
                  'baseUrl',
                  <Input
                    id="integration-baseUrl"
                    type="url"
                    value={baseUrl}
                    placeholder={
                      polymas ? 'https://openapi.polymas.com' : 'https://dify.example.edu/v1'
                    }
                    required={!polymas}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />,
                  t(polymas ? 'polymasUrlHint' : 'difyUrlHint'),
                )}
                {polymas ? (
                  <>
                    {field(
                      'appCode',
                      <Input
                        id="integration-appCode"
                        value={appCode}
                        required
                        maxLength={200}
                        onChange={(event) => setAppCode(event.target.value)}
                      />,
                      t('appCodeHint'),
                    )}
                    {secret('gatewayAppId', gatewayAppId, setGatewayAppId)}
                    {secret('appKey', appKey, setAppKey)}
                    {select(
                      'parameterEncryption',
                      encryption,
                      [
                        ['plain', 'plainParameters'],
                        ['aes-ecb-zero', 'encryptedParameters'],
                      ],
                      (value) => update('encryption', value),
                    )}
                    {encryption === 'aes-ecb-zero' && secret('paramKey', paramKey, setParamKey)}
                  </>
                ) : (
                  secret('apiKey', apiKey, setApiKey)
                )}
                {!!item?.hasSecret && (
                  <p className="text-text-secondary text-sm">{t('credentialsSaved')}</p>
                )}
                {mode !== 'assistant' &&
                  select(
                    'responseMode',
                    responseMode,
                    [
                      ['streaming', 'sseResponse'],
                      ['blocking', 'blockingResponse'],
                    ],
                    (value) => update('responseMode', value),
                  )}
                {mapped && (
                  <>
                    <p className="text-text-secondary text-sm leading-relaxed">
                      {t('variableGuide')}
                    </p>
                    <VariableChoice
                      label={t('queryField')}
                      value={string(config.queryField, 'query')}
                      choices={['query', 'question', 'prompt', 'input']}
                      onChange={(value) => update('queryField', value)}
                    />
                    <VariableChoice
                      label={t('historyField')}
                      value={string(config.historyField)}
                      choices={['history', 'chat_history', 'conversation_history']}
                      optional
                      onChange={(value) => update('historyField', value)}
                    />
                    <VariableChoice
                      label={t('answerField')}
                      value={string(config.answerField, 'answer')}
                      choices={['answer', 'result', 'text', 'output', 'content']}
                      onChange={(value) => update('answerField', value)}
                    />
                    {!config.historyField && <Alert variant="neutral">{t('singleTurnHint')}</Alert>}
                  </>
                )}
                {mode === 'assistant' && <Alert variant="neutral">{t('polymasHistoryHint')}</Alert>}
                {polymas && <Alert variant="neutral">{t('polymasCancellationHint')}</Alert>}
                <details className="border-border-light rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t('advancedIntegration')}
                  </summary>
                  <div className="mt-4 flex flex-col gap-5">
                    {polymas && (
                      <>
                        {select(
                          'authorizationFormat',
                          string(config.authHeader, 'raw'),
                          [
                            ['raw', 'rawAuthorization'],
                            ['bearer', 'bearerAuthorization'],
                          ],
                          (value) => update('authHeader', value),
                        )}
                        {encryption === 'aes-ecb-zero' && (
                          <>
                            {select(
                              'aesKeyEncoding',
                              string(config.keyEncoding, 'md5-hex'),
                              [
                                ['md5-hex', 'md5HexKey'],
                                ['md5-bytes', 'md5BytesKey'],
                              ],
                              (value) => update('keyEncoding', value),
                            )}
                            <p className="text-text-secondary text-xs">
                              {t('aesVerificationHint')}
                            </p>
                          </>
                        )}
                        {field(
                          'gatewayPath',
                          <Input
                            id="integration-gatewayPath"
                            value={string(config.path)}
                            onChange={(event) => update('path', event.target.value)}
                          />,
                          t('gatewayPathHint'),
                        )}
                        {mode === 'assistant' && (
                          <>
                            {select(
                              'assistantTextMode',
                              string(config.textMode, 'final'),
                              [
                                ['final', 'finalTextOnly'],
                                ['delta', 'deltaText'],
                                ['snapshot', 'snapshotText'],
                              ],
                              (value) => update('textMode', value),
                            )}
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox
                                aria-label={t('saveRemoteHistory')}
                                checked={config.saveHistory !== false}
                                onCheckedChange={(value) => update('saveHistory', value === true)}
                              />
                              {t('saveRemoteHistory')}
                            </label>
                          </>
                        )}
                      </>
                    )}
                    {field(
                      'defaultInputs',
                      <Textarea
                        id="integration-defaultInputs"
                        value={inputs}
                        onChange={(event) => setInputs(event.target.value)}
                        rows={5}
                      />,
                      t('defaultInputsHint'),
                    )}
                    {!!item?.hasSecret && (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          aria-label={t('clearSecret')}
                          checked={clearSecret}
                          onCheckedChange={(value) => setClearSecret(value === true)}
                        />
                        {t('clearSecret')}
                      </label>
                    )}
                  </div>
                </details>
              </>
            )}
          </form>
        }
        buttons={
          <Button
            form="school-integration-editor"
            type="submit"
            variant="submit"
            disabled={mutation.isLoading}
          >
            {t(mutation.isLoading ? 'saving' : 'save')}
          </Button>
        }
        selection={undefined}
      />
    </OGDialog>
  );
}

export function IntegrationTest({
  item,
  onClose,
  onTested,
}: {
  item: SchoolRow;
  onClose: () => void;
  onTested: () => void;
}) {
  const localize = useLocalize();
  const t = (key: string) => localize(('com_school_' + key) as TranslationKeys);
  const [prompt, setPrompt] = useState('brief');
  const prompts: Record<string, string> = {
    brief: t('testBriefPrompt'),
    hello: t('testHelloPrompt'),
  };
  const mutation = useMutation(
    () =>
      schoolRequest<{ message: string; capabilities: Config }>(
        `/admin/integrations/${item.id}/test`,
        'POST',
        { prompt: prompts[prompt] },
      ),
    { onSuccess: onTested, retry: false },
  );
  const output = record(mutation.data?.capabilities.output);
  let outputLabel = 'testedComplete';
  if (output.state === 'incremental') outputLabel = 'testedIncremental';
  if (output.state === 'demo') outputLabel = 'testedDemo';
  return (
    <OGDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <OGDialogTemplate
        title={t('testIntegration')}
        main={
          <div className="flex flex-col gap-5">
            <p className="font-medium">{item.name}</p>
            <p className="text-text-secondary text-sm leading-relaxed">
              {t('testIntegrationHint')}
            </p>
            <Dropdown
              ariaLabel={t('testPrompt')}
              value={prompt}
              portal={false}
              options={Object.entries(prompts).map(([value, label]) => ({ value, label }))}
              onChange={setPrompt}
            />
            {mutation.error instanceof Error && (
              <Alert variant="error">{mutation.error.message}</Alert>
            )}
            {mutation.data && (
              <Alert variant="neutral">
                <div className="flex flex-col gap-3">
                  <p>{mutation.data.message}</p>
                  <p>{t(outputLabel)}</p>
                  <p>{t('specializedTestsPending')}</p>
                </div>
              </Alert>
            )}
          </div>
        }
        buttons={
          <Button variant="submit" disabled={mutation.isLoading} onClick={() => mutation.mutate()}>
            {t(mutation.isLoading ? 'testing' : 'runTest')}
          </Button>
        }
        selection={undefined}
      />
    </OGDialog>
  );
}
