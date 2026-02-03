"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionDivider } from "@/components/section-divider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CheckStatus, HealthResponse } from "@/lib/health";

type StatusMeta = {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    Icon: typeof CheckCircle2;
};

const STATUS_META: Record<CheckStatus, StatusMeta> = {
    ok: { label: "Operational", variant: "default", Icon: CheckCircle2 },
    degraded: { label: "Degraded", variant: "secondary", Icon: AlertTriangle },
    error: { label: "Down", variant: "destructive", Icon: XCircle },
};

const REFRESH_OPTIONS = [
    { label: "Off", value: "0" },
    { label: "1 min", value: "60000" },
    { label: "5 min", value: "300000" },
    { label: "15 min", value: "900000" },
];

const formatValue = (value: string | number | boolean | undefined) => {
    if (value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
};

const formatList = (items: string[] | undefined) => {
    if (!items || items.length === 0) return "None";
    return items.join(", ");
};

function StatusBadge({ status }: { status: CheckStatus }) {
    const meta = STATUS_META[status];
    const Icon = meta.Icon;
    return (
        <Badge variant={meta.variant}>
            <Icon className="size-3.5" />
            {meta.label}
        </Badge>
    );
}

function KeyValue({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono text-foreground text-right">{value}</span>
        </div>
    );
}

export default function StatusPage() {
    const [data, setData] = useState<HealthResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [refreshInterval, setRefreshInterval] = useState("60000");

    const fetchHealth = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/health?ts=${Date.now()}`, { cache: "no-store" });
            const json = (await response.json()) as HealthResponse;
            setData(json);
            if (!response.ok) {
                const dbError = json.checks?.db?.error;
                setError(dbError || "Health check failed");
            }
            setLastUpdated(new Date().toLocaleString());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch health status");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchHealth();
    }, [fetchHealth]);

    useEffect(() => {
        const intervalMs = Number(refreshInterval);
        if (!intervalMs) return;
        const id = setInterval(fetchHealth, intervalMs);
        return () => clearInterval(id);
    }, [fetchHealth, refreshInterval]);

    const overallStatus = data?.status ?? "error";
    const overallMeta = STATUS_META[overallStatus];
    const OverallIcon = overallMeta.Icon;

    const rawJson = useMemo(() => (data ? JSON.stringify(data, null, 2) : ""), [data]);

    return (
        <div className="mx-auto w-full max-w-5xl space-y-10 pb-16">
            <PageHeader
                icon={Activity}
                title="System Status"
                description="Live status of key services and integrations"
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground hidden sm:inline">Auto refresh</span>
                            <Select value={refreshInterval} onValueChange={setRefreshInterval}>
                                <SelectTrigger className="min-w-[110px]" size="sm">
                                    <SelectValue placeholder="Auto refresh" />
                                </SelectTrigger>
                                <SelectContent align="end">
                                    {REFRESH_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={fetchHealth} disabled={isLoading} variant="outline">
                            <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                    </div>
                }
            />

            <section className="space-y-4">
                <SectionDivider label="Overview" />
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3">
                            <OverallIcon className="size-5 text-primary" />
                            {overallMeta.label}
                        </CardTitle>
                        <CardDescription>
                            {lastUpdated ? `Last updated ${lastUpdated}` : "Checking status..."}
                        </CardDescription>
                        <CardAction>
                            <StatusBadge status={overallStatus} />
                        </CardAction>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {error ? (
                            <div className="text-xs text-destructive">Error: {error}</div>
                        ) : (
                            <div className="text-xs text-muted-foreground">
                                All checks run directly from the production environment.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </section>

            <section className="space-y-4">
                <SectionDivider label="Checks" />

                <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Environment</CardTitle>
                            <CardDescription>Runtime configuration & flags</CardDescription>
                            <CardAction>
                                {data ? <StatusBadge status={data.checks.env.status} /> : null}
                            </CardAction>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <KeyValue label="App URL" value={formatValue(data?.checks.env.appUrl)} />
                            <KeyValue
                                label="Google OAuth"
                                value={formatValue(data?.checks.env.googleOAuthEnabled)}
                            />
                            <KeyValue label="Missing" value={formatList(data?.checks.env.missing)} />
                            <KeyValue label="Warnings" value={formatList(data?.checks.env.warnings)} />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Database</CardTitle>
                            <CardDescription>Connectivity & latency</CardDescription>
                            <CardAction>
                                {data ? <StatusBadge status={data.checks.db.status} /> : null}
                            </CardAction>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <KeyValue label="Host" value={formatValue(data?.checks.db.host)} />
                            <KeyValue label="Port" value={formatValue(data?.checks.db.port)} />
                            <KeyValue label="Latency" value={formatValue(data?.checks.db.latencyMs)} />
                            <KeyValue label="Error" value={formatValue(data?.checks.db.error)} />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Auth</CardTitle>
                            <CardDescription>Better Auth configuration</CardDescription>
                            <CardAction>
                                {data ? <StatusBadge status={data.checks.auth.status} /> : null}
                            </CardAction>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <KeyValue label="Base URL" value={formatValue(data?.checks.auth.baseUrl)} />
                            <KeyValue label="Cookie Prefix" value={formatValue(data?.checks.auth.cookiePrefix)} />
                            <KeyValue
                                label="Google OAuth"
                                value={formatValue(data?.checks.auth.googleOAuthEnabled)}
                            />
                            <KeyValue label="Warnings" value={formatList(data?.checks.auth.warnings)} />
                            <KeyValue label="Errors" value={formatList(data?.checks.auth.errors)} />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Build</CardTitle>
                            <CardDescription>Deployment metadata</CardDescription>
                            <CardAction>
                                {data ? <StatusBadge status={data.checks.build.status} /> : null}
                            </CardAction>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <KeyValue label="NODE_ENV" value={formatValue(data?.checks.build.nodeEnv)} />
                            <KeyValue label="Build Time" value={formatValue(data?.checks.build.buildTime)} />
                        </CardContent>
                    </Card>
                </div>
            </section>

            <section className="space-y-4">
                <SectionDivider label="Raw" />
                <Card>
                    <CardHeader>
                        <CardTitle>Health JSON</CardTitle>
                        <CardDescription>/api/health response</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <pre className="max-h-80 overflow-auto rounded-sm border border-border/50 bg-muted/30 p-4 text-xs">
{rawJson || "Loading..."}
                        </pre>
                    </CardContent>
                </Card>
            </section>
        </div>
    );
}
