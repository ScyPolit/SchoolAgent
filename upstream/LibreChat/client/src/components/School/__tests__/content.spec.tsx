import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ContentEditor, { DurationChoice } from '../ContentEditor';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    variant: _variant,
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
}));

test('legacy question text remains editable and audience changes preserve unrelated fields and unknown group IDs', () => {
  const onChange = jest.fn();
  function Harness() {
    const [value, setValue] = useState<unknown>([
      { text: '原问题', agentId: 'existing', groups: ['old-group'], url: '/help' },
    ]);
    return (
      <ContentEditor
        kind="questions"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        groups={[{ value: 'member', label: '成员' }]}
        agents={[{ value: 'existing', label: '已有智能体' }]}
      />
    );
  }
  render(<Harness />);
  const question = screen.getByRole('textbox', { name: 'com_school_contentQuestion' });
  expect(question).toHaveValue('原问题');
  fireEvent.change(question, { target: { value: '修改后问题' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '成员' }));
  expect(onChange).toHaveBeenLastCalledWith([
    { text: '修改后问题', agentId: 'existing', groups: ['old-group', 'member'], url: '/help' },
  ]);
});

test('expanding an existing plain announcement preserves its content and supports choosing audience groups', () => {
  const onChange = jest.fn();
  function Harness() {
    const [value, setValue] = useState<unknown>(['原公告']);
    return (
      <ContentEditor
        kind="announcements"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        groups={[{ value: 'member', label: '成员' }]}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'com_school_expandContent' }));
  expect(screen.getByRole('textbox', { name: 'com_school_contentTitle' })).toHaveValue('原公告');
  fireEvent.click(screen.getByRole('checkbox', { name: '成员' }));
  expect(onChange).toHaveBeenLastCalledWith([{ title: '原公告', groups: ['member'] }]);
});

test('retention choices preserve existing custom durations and selecting a preset emits a number', () => {
  const onChange = jest.fn();
  render(<DurationChoice label="保留天数" value={9999} onChange={onChange} />);
  expect(screen.getByRole('spinbutton', { name: '保留天数' })).toHaveValue(9999);
  fireEvent.change(screen.getByRole('combobox', { name: '保留天数' }), {
    target: { value: '180' },
  });
  expect(onChange).toHaveBeenCalledWith(180);
});
