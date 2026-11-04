import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import {ThemeProvider} from './vendor/librechat/ThemeProvider.jsx';
import './vendor/librechat/theme.css';
import './styles.css';

class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <main className="fatal"><h1>页面暂时无法显示</h1><p>请刷新页面重试。如问题持续，请联系平台管理员。</p><button className="button primary" onClick={() => location.reload()}>重新加载</button></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider><Boundary><App/></Boundary></ThemeProvider></React.StrictMode>);
