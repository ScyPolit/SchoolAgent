// Derived from LibreChat v0.8.1, MIT. See third_party/librechat/NOTICE.md.
import React from 'react';

export default class MarkdownErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidUpdate(prevProps) {
    if (prevProps.content !== this.props.content && this.state.hasError) this.setState({ hasError: false });
  }
  render() {
    if (this.state.hasError) return <div className="markdown-fallback">{this.props.content}</div>;
    return this.props.children;
  }
}
