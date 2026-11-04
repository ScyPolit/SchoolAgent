import React from 'react';
import {Moon,Sun,Monitor} from 'lucide-react';
import {useTheme} from './vendor/librechat/ThemeProvider.jsx';

export default function ThemeSelector({compact=false}) {
 const {theme,setTheme}=useTheme();
 const Icon=theme==='dark'?Moon:theme==='light'?Sun:Monitor;
 return <label className={`theme-selector ${compact?'compact':''}`}><Icon size={17}/><span>外观</span><select aria-label="界面外观" value={theme} onChange={e=>setTheme(e.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>;
}
