// Derived from LibreChat v0.8.1, MIT. See third_party/librechat/NOTICE.md.
import { memo } from 'react';
import remarkGfm from 'remark-gfm';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import MarkdownErrorBoundary from './MarkdownErrorBoundary.jsx';

// Keep the phone protocol explicit. No raw HTML, images, script execution or artifacts.
const schema = { ...defaultSchema, protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto', 'tel'] } };
function safeUrl(value) { return /^(https?:|mailto:|tel:|\/|#)/i.test(value) ? value : ''; }
const MarkdownLite = memo(({ content = '' }) => {
  const rehypePlugins = [[rehypeSanitize, schema]];
  return (
    <MarkdownErrorBoundary content={content}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}
        urlTransform={safeUrl}
        components={{
          a: ({ node, href, children, ...props }) => <a {...props} href={href}
            target={href?.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>,
          img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : '[图片]'}</span>,
        }}>
        {content}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
});
MarkdownLite.displayName = 'LibreChatMarkdownLite';
export default MarkdownLite;
