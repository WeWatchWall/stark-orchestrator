-- Migration: 017_metrics
-- Description: Metrics system for tracking node, pod, and cluster metrics
-- Stark Orchestrator

-- ============================================================================
-- Node Metrics Table
-- Stores time-series metrics for each node (CPU, memory, uptime)
-- ============================================================================

CREATE TABLE public.node_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id UUID NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
    
    -- System metrics
    uptime_seconds BIGINT NOT NULL DEFAULT 0,
    cpu_usage_percent DECIMAL(5, 2), -- 0.00 to 100.00
    memory_used_bytes BIGINT,
    memory_total_bytes BIGINT,
    memory_usage_percent DECIMAL(5, 2),
    
    -- Runtime info
    runtime_type TEXT NOT NULL, -- 'node' or 'browser'
    runtime_version TEXT, -- e.g., 'v20.10.0' for Node.js
    
    -- Resource allocation
    pods_allocated INTEGER NOT NULL DEFAULT 0,
    pods_capacity INTEGER NOT NULL DEFAULT 0,
    cpu_allocated DECIMAL(10, 2) NOT NULL DEFAULT 0,
    cpu_capacity DECIMAL(10, 2) NOT NULL DEFAULT 0,
    memory_allocated_bytes BIGINT NOT NULL DEFAULT 0,
    memory_capacity_bytes BIGINT NOT NULL DEFAULT 0,
    
    -- Worker pool stats (Node.js only)
    worker_pool_total INTEGER,
    worker_pool_busy INTEGER,
    worker_pool_idle INTEGER,
    worker_pool_pending_tasks INTEGER,
    
    -- Timestamp
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Indexes for efficient querying
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying metrics by node and time
CREATE INDEX idx_node_metrics_node_time ON public.node_metrics(node_id, recorded_at DESC);

-- Index for getting latest metrics per node
CREATE INDEX idx_node_metrics_latest ON public.node_metrics(node_id, created_at DESC);

-- Partition hint: In production, consider partitioning by time range
COMMENT ON TABLE public.node_metrics IS 'Time-series metrics for nodes. Consider partitioning by recorded_at for large services.';

-- ============================================================================
-- Pod Metrics Table
-- Stores metrics for individual pods (restarts, execution stats)
-- ============================================================================

CREATE TABLE public.pod_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pod_id UUID NOT NULL REFERENCES public.pods(id) ON DELETE CASCADE,
    node_id UUID REFERENCES public.nodes(id) ON DELETE SET NULL,
    
    -- Pod status tracking
    restart_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    
    -- Execution metrics
    execution_count INTEGER NOT NULL DEFAULT 0,
    successful_executions INTEGER NOT NULL DEFAULT 0,
    failed_executions INTEGER NOT NULL DEFAULT 0,
    total_execution_time_ms BIGINT NOT NULL DEFAULT 0,
    avg_execution_time_ms DECIMAL(10, 2),
    last_execution_at TIMESTAMPTZ,
    
    -- Resource usage (if available)
    cpu_usage_percent DECIMAL(5, 2),
    memory_used_bytes BIGINT,
    
    -- Timestamp
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying metrics by pod and time
CREATE INDEX idx_pod_metrics_pod_time ON public.pod_metrics(pod_id, recorded_at DESC);

-- Index for querying metrics by node
CREATE INDEX idx_pod_metrics_node ON public.pod_metrics(node_id, recorded_at DESC);

-- ============================================================================
-- Scheduling Metrics Table
-- Tracks scheduling attempts, successes, and failures
-- ============================================================================

CREATE TABLE public.scheduling_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Time window for aggregation
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    
    -- Scheduling stats
    scheduling_attempts INTEGER NOT NULL DEFAULT 0,
    scheduling_successes INTEGER NOT NULL DEFAULT 0,
    scheduling_failures INTEGER NOT NULL DEFAULT 0,
    
    -- Failure reasons breakdown (JSONB for flexibility)
    -- Example: { "no_nodes_available": 5, "insufficient_resources": 3, "taint_mismatch": 2 }
    failure_reasons JSONB NOT NULL DEFAULT '{}',
    
    -- Average scheduling latency
    avg_scheduling_latency_ms DECIMAL(10, 2),
    max_scheduling_latency_ms INTEGER,
    min_scheduling_latency_ms INTEGER,
    
    -- Pending pods at window end
    pending_pods_count INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by time window
CREATE INDEX idx_scheduling_metrics_window ON public.scheduling_metrics(window_start DESC);

-- ============================================================================
-- Cluster Metrics Table
-- Aggregated cluster-wide metrics (snapshots)
-- ============================================================================

CREATE TABLE public.cluster_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Node counts
    nodes_total INTEGER NOT NULL DEFAULT 0,
    nodes_online INTEGER NOT NULL DEFAULT 0,
    nodes_offline INTEGER NOT NULL DEFAULT 0,
    nodes_unhealthy INTEGER NOT NULL DEFAULT 0,
    nodes_draining INTEGER NOT NULL DEFAULT 0,
    
    -- Pod counts
    pods_total INTEGER NOT NULL DEFAULT 0,
    pods_pending INTEGER NOT NULL DEFAULT 0,
    pods_scheduled INTEGER NOT NULL DEFAULT 0,
    pods_starting INTEGER NOT NULL DEFAULT 0,
    pods_running INTEGER NOT NULL DEFAULT 0,
    pods_stopping INTEGER NOT NULL DEFAULT 0,
    pods_stopped INTEGER NOT NULL DEFAULT 0,
    pods_failed INTEGER NOT NULL DEFAULT 0,
    pods_evicted INTEGER NOT NULL DEFAULT 0,
    
    -- Desired vs running (for services)
    pods_desired INTEGER NOT NULL DEFAULT 0,
    
    -- Aggregate resource capacity
    total_cpu_capacity DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_memory_capacity_bytes BIGINT NOT NULL DEFAULT 0,
    total_pods_capacity INTEGER NOT NULL DEFAULT 0,
    
    -- Aggregate resource usage
    total_cpu_allocated DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_memory_allocated_bytes BIGINT NOT NULL DEFAULT 0,
    total_pods_allocated INTEGER NOT NULL DEFAULT 0,
    
    -- Utilization percentages
    cpu_utilization_percent DECIMAL(5, 2),
    memory_utilization_percent DECIMAL(5, 2),
    pods_utilization_percent DECIMAL(5, 2),
    
    -- Scheduling health
    scheduling_failures_last_hour INTEGER NOT NULL DEFAULT 0,
    avg_scheduling_latency_ms DECIMAL(10, 2),
    
    -- Restart metrics
    total_pod_restarts INTEGER NOT NULL DEFAULT 0,
    pods_with_restarts INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamp
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying latest cluster metrics
CREATE INDEX idx_cluster_metrics_time ON public.cluster_metrics(recorded_at DESC);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to get latest node metrics for all nodes
CREATE OR REPLACE FUNCTION public.get_latest_node_metrics()
RETURNS SETOF public.node_metrics
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT DISTINCT ON (node_id) *
    FROM public.node_metrics
    ORDER BY node_id, recorded_at DESC;
$$;

-- Function to get latest pod metrics for all pods
CREATE OR REPLACE FUNCTION public.get_latest_pod_metrics()
RETURNS SETOF public.pod_metrics
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT DISTINCT ON (pod_id) *
    FROM public.pod_metrics
    ORDER BY pod_id, recorded_at DESC;
$$;

-- Function to calculate and insert cluster metrics snapshot
CREATE OR REPLACE FUNCTION public.calculate_cluster_metrics()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_id UUID;
    node_stats RECORD;
    pod_stats RECORD;
    resource_stats RECORD;
    service_stats RECORD;
    restart_stats RECORD;
BEGIN
    -- Get node statistics
    SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'online') AS online,
        COUNT(*) FILTER (WHERE status = 'offline') AS offline,
        COUNT(*) FILTER (WHERE status = 'unhealthy') AS unhealthy,
        COUNT(*) FILTER (WHERE status = 'draining') AS draining
    INTO node_stats
    FROM public.nodes;

    -- Get pod statistics
    SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
        COUNT(*) FILTER (WHERE status = 'starting') AS starting,
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'stopping') AS stopping,
        COUNT(*) FILTER (WHERE status = 'stopped') AS stopped,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'evicted') AS evicted
    INTO pod_stats
    FROM public.pods;

    -- Get resource capacity and allocation from nodes
    SELECT
        COALESCE(SUM((allocatable->>'cpu')::DECIMAL), 0) AS cpu_capacity,
        COALESCE(SUM((allocatable->>'memory')::BIGINT), 0) AS memory_capacity,
        COALESCE(SUM((allocatable->>'pods')::INTEGER), 0) AS pods_capacity,
        COALESCE(SUM((allocated->>'cpu')::DECIMAL), 0) AS cpu_allocated,
        COALESCE(SUM((allocated->>'memory')::BIGINT), 0) AS memory_allocated,
        COALESCE(SUM((allocated->>'pods')::INTEGER), 0) AS pods_allocated
    INTO resource_stats
    FROM public.nodes
    WHERE status IN ('online', 'draining');

    -- Get desired pods from services
    SELECT
        COALESCE(SUM(replicas), 0) AS desired
    INTO service_stats
    FROM public.services
    WHERE status = 'active';

    -- Get restart statistics from pod_metrics
    SELECT
        COALESCE(SUM(restart_count), 0) AS total_restarts,
        COUNT(*) FILTER (WHERE restart_count > 0) AS pods_with_restarts
    INTO restart_stats
    FROM public.get_latest_pod_metrics();

    -- Insert new cluster metrics record
    INSERT INTO public.cluster_metrics (
        nodes_total, nodes_online, nodes_offline, nodes_unhealthy, nodes_draining,
        pods_total, pods_pending, pods_scheduled, pods_starting, pods_running,
        pods_stopping, pods_stopped, pods_failed, pods_evicted, pods_desired,
        total_cpu_capacity, total_memory_capacity_bytes, total_pods_capacity,
        total_cpu_allocated, total_memory_allocated_bytes, total_pods_allocated,
        cpu_utilization_percent, memory_utilization_percent, pods_utilization_percent,
        total_pod_restarts, pods_with_restarts
    )
    VALUES (
        node_stats.total, node_stats.online, node_stats.offline, node_stats.unhealthy, node_stats.draining,
        pod_stats.total, pod_stats.pending, pod_stats.scheduled, pod_stats.starting, pod_stats.running,
        pod_stats.stopping, pod_stats.stopped, pod_stats.failed, pod_stats.evicted, service_stats.desired,
        resource_stats.cpu_capacity, resource_stats.memory_capacity, resource_stats.pods_capacity,
        resource_stats.cpu_allocated, resource_stats.memory_allocated, resource_stats.pods_allocated,
        CASE WHEN resource_stats.cpu_capacity > 0 
             THEN ROUND((resource_stats.cpu_allocated / resource_stats.cpu_capacity * 100)::DECIMAL, 2) 
             ELSE 0 END,
        CASE WHEN resource_stats.memory_capacity > 0 
             THEN ROUND((resource_stats.memory_allocated::DECIMAL / resource_stats.memory_capacity * 100), 2) 
             ELSE 0 END,
        CASE WHEN resource_stats.pods_capacity > 0 
             THEN ROUND((resource_stats.pods_allocated::DECIMAL / resource_stats.pods_capacity * 100), 2) 
             ELSE 0 END,
        restart_stats.total_restarts, restart_stats.pods_with_restarts
    )
    RETURNING id INTO new_id;

    RETURN new_id;
END;
$$;

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- Enable RLS
ALTER TABLE public.node_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pod_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cluster_metrics ENABLE ROW LEVEL SECURITY;

-- Node metrics: Anyone can read, nodes and admins can insert
CREATE POLICY "Anyone can read node_metrics"
    ON public.node_metrics FOR SELECT
    USING (true);

CREATE POLICY "Nodes and admins can insert node_metrics"
    ON public.node_metrics FOR INSERT
    WITH CHECK (public.has_any_role(ARRAY['node', 'admin']));

-- Pod metrics: Anyone can read, nodes and admins can insert
CREATE POLICY "Anyone can read pod_metrics"
    ON public.pod_metrics FOR SELECT
    USING (true);

CREATE POLICY "Nodes and admins can insert pod_metrics"
    ON public.pod_metrics FOR INSERT
    WITH CHECK (public.has_any_role(ARRAY['node', 'admin']));

-- Scheduling metrics: Anyone can read, admins can insert
CREATE POLICY "Anyone can read scheduling_metrics"
    ON public.scheduling_metrics FOR SELECT
    USING (true);

CREATE POLICY "Admins can insert scheduling_metrics"
    ON public.scheduling_metrics FOR INSERT
    WITH CHECK (public.has_role('admin'));

-- Cluster metrics: Anyone can read, admins can insert
CREATE POLICY "Anyone can read cluster_metrics"
    ON public.cluster_metrics FOR SELECT
    USING (true);

CREATE POLICY "Admins can insert cluster_metrics"
    ON public.cluster_metrics FOR INSERT
    WITH CHECK (public.has_role('admin'));

-- ============================================================================
-- Cleanup function for old metrics (retention policy)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_old_metrics(retention_days INTEGER DEFAULT 7)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    cutoff_date TIMESTAMPTZ;
BEGIN
    cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;
    
    DELETE FROM public.node_metrics WHERE recorded_at < cutoff_date;
    DELETE FROM public.pod_metrics WHERE recorded_at < cutoff_date;
    DELETE FROM public.scheduling_metrics WHERE window_end < cutoff_date;
    DELETE FROM public.cluster_metrics WHERE recorded_at < cutoff_date;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_metrics IS 'Call periodically to clean up old metrics. Default retention is 7 days.';
