import React from 'react';
import remarkGfm from 'remark-gfm';
import ReactMarkdown from 'react-markdown';
import { render, screen } from '@testing-library/react';
import { schoolMarkdownUrlTransform } from '../markdownUrl';

describe('campus telephone links in original Markdown renderers', () => {
  it('preserves an actionable telephone link inside a Markdown table', () => {
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={schoolMarkdownUrlTransform}>
        {'| Department | Phone |\n| --- | --- |\n| Service | [Call](tel:+861012345678;ext=123) |'}
      </ReactMarkdown>,
    );
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute(
      'href',
      'tel:+861012345678;ext=123',
    );
  });
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,unsafe',
    'vbscript:unsafe',
  ])('keeps unsafe protocol %s blocked', (url) => {
    expect(schoolMarkdownUrlTransform(url)).toBe('');
  });
  it.each(['https://school.example/service', 'mailto:service@school.example', '/school/help'])(
    'preserves supported URL %s',
    (url) => {
      expect(schoolMarkdownUrlTransform(url)).toBe(url);
    },
  );
});
