import React, { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress unhandled rejections from Vite HMR socket failures in cloud container previews
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason?.message || String(event.reason || '');
  if (
    reason.includes('WebSocket closed without opened') ||
    reason.includes('vite') ||
    reason.includes('hmr')
  ) {
    event.preventDefault(); // Suppress non-fatal Vite HMR websocket noise
  }
});

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('LUMINA MUSIC ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-[#12040A] text-white flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="max-w-md w-full rounded-3xl bg-white/[0.05] border border-white/15 p-8 space-y-4 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-bold text-rose-300">LUMINA MUSIC 页面渲染异常</h2>
            <p className="text-xs text-white/70 leading-relaxed font-mono-tabular">
              {this.state.error?.message || '未知运行时错误'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-xs font-semibold text-white shadow-lg cursor-pointer"
            >
              重新加载应用
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
