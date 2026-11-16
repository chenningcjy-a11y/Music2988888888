import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('LUMINA MUSIC UI runtime error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-screen bg-[#12040a] text-white flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-3xl bg-white/[0.06] border border-white/15 p-6 sm:p-8 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-300">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-semibold text-white">界面渲染出现异常</h1>
            </div>
            <p className="text-sm text-white/75 leading-relaxed">
              LUMINA MUSIC 捕获到一个前端运行时错误，已阻止页面白屏。详情如下：
            </p>
            <pre className="p-3 rounded-xl bg-black/45 border border-white/10 text-xs text-rose-200 overflow-x-auto whitespace-pre-wrap break-words font-mono-tabular">
              {this.state.error?.message || '未知渲染错误'}
            </pre>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-xl bg-rose-500/80 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                重新加载页面
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-medium text-white/85 cursor-pointer"
              >
                尝试恢复视图
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
