import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IntegrationEditor, { IntegrationTest } from '../IntegrationEditor';
import { schoolRequest } from '../api';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('../api', () => ({
  schoolRequest: jest.fn(),
  useSchoolBootstrap: () => ({ data: { development: false } }),
}));
jest.mock('@librechat/client', () => ({
  Alert: ({ children }: React.PropsWithChildren) => <div role="alert">{children}</div>,
  Button: ({
    variant: _variant,
    children,
    ...props
  }: React.PropsWithChildren<
    React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }
  >) => <button {...props}>{children}</button>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props} />,
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
  Dropdown: ({
    ariaLabel,
    value,
    options,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  OGDialog: ({ children }: React.PropsWithChildren) => <div role="dialog">{children}</div>,
  OGDialogTemplate: ({
    title,
    main,
    buttons,
  }: {
    title: string;
    main: React.ReactNode;
    buttons: React.ReactNode;
  }) => (
    <>
      <h1>{title}</h1>
      {main}
      {buttons}
    </>
  ),
}));

const key = (name: string) => 'com_school_' + name;
function setup(element: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
beforeEach(() => {
  jest.mocked(schoolRequest).mockReset();
  jest.mocked(schoolRequest).mockResolvedValue({});
});

test('editing a custom workflow preserves mappings, extra configuration and blank stored credentials', async () => {
  const onSaved = jest.fn(),
    onClose = jest.fn();
  const config = {
    mode: 'tool',
    queryField: 'business_question',
    historyField: 'dialogue',
    answerField: 'main.text',
    inputs: { locale: 'zh-CN' },
    customFlag: true,
    responseMode: 'blocking',
    keyEncoding: 'md5-bytes',
    encryption: 'aes-ecb-zero',
  };
  setup(
    <IntegrationEditor
      item={{
        id: 'existing',
        name: 'Workflow',
        platform: 'polymas',
        appId: 'bot-code',
        baseUrl: 'https://polymas.example.test',
        hasSecret: true,
        config,
      }}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  expect(screen.getByRole('textbox', { name: key('queryField') })).toHaveValue('business_question');
  expect(screen.getByRole('textbox', { name: key('answerField') })).toHaveValue('main.text');
  fireEvent.submit(document.getElementById('school-integration-editor')!);
  await waitFor(() => expect(schoolRequest).toHaveBeenCalledTimes(1));
  expect(schoolRequest).toHaveBeenCalledWith(
    '/admin/integrations/existing',
    'PATCH',
    expect.objectContaining({
      appId: 'bot-code',
      credentials: { gatewayAppId: '', appKey: '', paramKey: '' },
      config: { ...config, authHeader: 'raw' },
      clearSecret: false,
    }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('platform and protocol choices reveal the correct Polymas fields and reset unrelated credentials', async () => {
  setup(<IntegrationEditor onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.queryByRole('option', { name: key('demoPlatform') })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(key('apiKey')), { target: { value: 'old-dify-key' } });
  fireEvent.change(screen.getByRole('combobox', { name: key('platform') }), {
    target: { value: 'polymas' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: key('polymasMode') }), {
    target: { value: 'assistant' },
  });
  expect(screen.getByLabelText(key('paramKey'))).toBeInTheDocument();
  expect(screen.queryByLabelText(key('apiKey'))).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(key('name')), { target: { value: 'Assistant' } });
  fireEvent.change(screen.getByLabelText(key('appCode')), { target: { value: 'published-bot' } });
  fireEvent.change(screen.getByLabelText(key('gatewayAppId')), { target: { value: 'gateway-id' } });
  fireEvent.change(screen.getByLabelText(key('appKey')), { target: { value: 'test-only-key' } });
  fireEvent.change(screen.getByLabelText(key('paramKey')), {
    target: { value: 'test-only-param' },
  });
  fireEvent.submit(document.getElementById('school-integration-editor')!);
  await waitFor(() => expect(schoolRequest).toHaveBeenCalledTimes(1));
  expect(schoolRequest).toHaveBeenCalledWith(
    '/admin/integrations',
    'POST',
    expect.objectContaining({
      platform: 'polymas',
      appId: 'published-bot',
      credentials: {
        gatewayAppId: 'gateway-id',
        appKey: 'test-only-key',
        paramKey: 'test-only-param',
      },
      config: expect.objectContaining({
        mode: 'assistant',
        encryption: 'aes-ecb-zero',
        responseMode: 'streaming',
      }),
    }),
  );
  expect(JSON.stringify(jest.mocked(schoolRequest).mock.calls)).not.toContain('old-dify-key');
});

test('tool history choices support question context and restore a valid separate variable without losing mappings', async () => {
  setup(
    <IntegrationEditor
      item={{
        id: 'advanced',
        name: 'Advanced assistant',
        platform: 'polymas',
        appId: 'published-bot',
        config: { mode: 'tool', queryField: 'question', answerField: 'text' },
      }}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />,
  );
  expect(screen.queryByRole('combobox', { name: key('historyField') })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: key('historyMode') }), {
    target: { value: 'field' },
  });
  expect(screen.getByRole('combobox', { name: key('historyField') })).toHaveValue('history');
  fireEvent.change(screen.getByRole('combobox', { name: key('historyMode') }), {
    target: { value: 'question' },
  });
  expect(screen.queryByRole('combobox', { name: key('historyField') })).not.toBeInTheDocument();
  expect(screen.getByText(key('historyInQuestionHint'))).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: key('toolTextMode') }), {
    target: { value: 'delta' },
  });
  fireEvent.submit(document.getElementById('school-integration-editor')!);
  await waitFor(() => expect(schoolRequest).toHaveBeenCalledTimes(1));
  expect(schoolRequest).toHaveBeenCalledWith(
    '/admin/integrations/advanced',
    'PATCH',
    expect.objectContaining({
      config: expect.objectContaining({
        historyMode: 'question',
        historyField: 'history',
        queryField: 'question',
        answerField: 'text',
        toolTextMode: 'delta',
      }),
    }),
  );
});

test('malformed fixed inputs keep the editor open and never submit a request', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const onClose = jest.fn();
  setup(
    <IntegrationEditor
      item={{
        id: 'dify',
        name: 'Dify',
        platform: 'dify-workflow',
        baseUrl: 'https://dify.example.test/v1',
        config: { mode: 'workflow' },
      }}
      onClose={onClose}
      onSaved={jest.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText(key('defaultInputs')), { target: { value: '[]' } });
  fireEvent.submit(document.getElementById('school-integration-editor')!);
  expect(await screen.findByText(key('inputsObjectRequired'))).toBeInTheDocument();
  expect(schoolRequest).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test('dialog sends exactly one chosen prompt only after Run and reports separate unverified capabilities', async () => {
  jest.mocked(schoolRequest).mockResolvedValue({
    message: '单次请求完成',
    capabilities: { output: { state: 'complete' } },
  });
  setup(
    <IntegrationTest
      item={{ id: 'published', name: 'Published' }}
      onClose={jest.fn()}
      onTested={jest.fn()}
    />,
  );
  expect(schoolRequest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: key('testPrompt') }), {
    target: { value: 'hello' },
  });
  fireEvent.click(screen.getByRole('button', { name: key('runTest') }));
  await waitFor(() => expect(schoolRequest).toHaveBeenCalledTimes(1));
  expect(schoolRequest).toHaveBeenCalledWith('/admin/integrations/published/test', 'POST', {
    prompt: key('testHelloPrompt'),
  });
  expect(await screen.findByText(key('testedComplete'))).toBeInTheDocument();
  expect(screen.getByText(key('specializedTestsPending'))).toBeInTheDocument();
});
