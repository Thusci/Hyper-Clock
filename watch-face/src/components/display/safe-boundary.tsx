"use client";

import { Component, type ReactNode } from "react";

/**
 * Keeps one broken page or card from taking the whole face down. The failed part renders
 * `fallback` (the rest of the face keeps ticking) and retries by itself after `retryMs`,
 * so a bad value that HA corrects later heals without anyone touching the kiosk.
 */
export class SafeBoundary extends Component<{ name: string; fallback?: ReactNode; retryMs?: number; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[hyper-clock] ${this.props.name} crashed; retrying`, error);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setState({ failed: false }), this.props.retryMs ?? 30_000);
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}
