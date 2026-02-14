"use client";

import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
    children: ReactNode;
    /** Label shown in the collapsed error (e.g. "Watchlist", "Addons") */
    section?: string;
}

interface State {
    error: Error | null;
}

/**
 * Lightweight per-section error boundary.
 * Catches render errors in children and shows a small inline fallback
 * instead of crashing the entire page.
 */
export class SectionErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        console.error(`[${this.props.section ?? "Section"}]`, error);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex items-center gap-2 rounded-sm border border-destructive/20 bg-destructive/5 px-3.5 py-2.5">
                    <AlertCircle className="size-3.5 text-destructive shrink-0" />
                    <p className="text-xs text-muted-foreground">
                        {this.props.section ? (
                            <><span className="text-foreground font-medium">{this.props.section}</span> failed to load. </>
                        ) : (
                            <>This section failed to load. </>
                        )}
                        <button
                            className="text-primary hover:underline"
                            onClick={() => this.setState({ error: null })}>
                            Retry
                        </button>
                    </p>
                </div>
            );
        }
        return this.props.children;
    }
}
