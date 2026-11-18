CREATE FUNCTION public.queue_deleted_storage_object() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE cleanup_key text;
BEGIN
  IF TG_TABLE_NAME = 'asset' THEN
    cleanup_key := OLD.object_key;
  ELSE
    cleanup_key := OLD.background_object_key;
  END IF;
  IF cleanup_key IS NOT NULL THEN
    INSERT INTO storage_cleanup (object_key) VALUES (cleanup_key)
      ON CONFLICT (object_key) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TABLE public.account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp without time zone,
    refresh_token_expires_at timestamp without time zone,
    scope text,
    password text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.activity (
    id text NOT NULL,
    task_id text NOT NULL,
    type text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    content text,
    user_id text,
    external_user_name text,
    external_user_avatar text,
    external_source text,
    external_url text,
    event_data jsonb,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.apikey (
    id text NOT NULL,
    name text,
    start text,
    prefix text,
    key text NOT NULL,
    user_id text,
    refill_interval integer,
    refill_amount integer,
    last_refill_at timestamp without time zone,
    enabled boolean DEFAULT true,
    rate_limit_enabled boolean DEFAULT true,
    rate_limit_time_window integer DEFAULT 86400000,
    rate_limit_max integer DEFAULT 10,
    request_count integer DEFAULT 0,
    remaining integer,
    last_request timestamp without time zone,
    expires_at timestamp without time zone,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    permissions text,
    metadata text,
    config_id text DEFAULT 'default'::text NOT NULL,
    reference_id text NOT NULL
);

CREATE TABLE public.asset (
    id text NOT NULL,
    workspace_id text NOT NULL,
    project_id text NOT NULL,
    task_id text,
    activity_id text,
    object_key text NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    kind text DEFAULT 'image'::text NOT NULL,
    surface text DEFAULT 'description'::text NOT NULL,
    created_by text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.billing_event (
    id text NOT NULL,
    event_type text NOT NULL,
    processed_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.billing_reminder_sent (
    id text NOT NULL,
    workspace_id text NOT NULL,
    reminder_type text NOT NULL,
    trial_ends_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    user_id text NOT NULL
);

CREATE TABLE public.calendar_feed (
    id text NOT NULL,
    project_id text NOT NULL,
    token text NOT NULL,
    label_ids jsonb NOT NULL,
    time_zone text DEFAULT 'UTC'::text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public."column" (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    icon text,
    color text,
    is_final boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.comment (
    id text NOT NULL,
    task_id text NOT NULL,
    user_id text NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.custom_field_definition (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    default_value text,
    options jsonb,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.custom_field_value (
    id text NOT NULL,
    task_id text NOT NULL,
    field_id text NOT NULL,
    value text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.data_migration (
    id text NOT NULL,
    completed_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.device_code (
    id text NOT NULL,
    device_code text NOT NULL,
    user_code text NOT NULL,
    user_id text,
    expires_at timestamp without time zone NOT NULL,
    status text NOT NULL,
    last_polled_at timestamp without time zone,
    polling_interval integer,
    client_id text,
    scope text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.external_link (
    id text NOT NULL,
    task_id text NOT NULL,
    integration_id text,
    resource_type text NOT NULL,
    external_id text NOT NULL,
    url text NOT NULL,
    title text,
    metadata text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.github_import (
    integration_id text NOT NULL,
    run_id text NOT NULL,
    state jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.import_run (
    id text NOT NULL,
    workspace_id text NOT NULL,
    user_id text,
    source text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    include_comments boolean DEFAULT true NOT NULL,
    message text,
    projects jsonb NOT NULL,
    error text,
    heartbeat_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    finished_at timestamp without time zone
);

CREATE TABLE public.integration (
    id text NOT NULL,
    project_id text NOT NULL,
    type text NOT NULL,
    config text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.invitation (
    id text NOT NULL,
    workspace_id text NOT NULL,
    email text NOT NULL,
    role text,
    team_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    inviter_id text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    project_access text DEFAULT 'all'::text NOT NULL,
    project_ids text[] DEFAULT '{}'::text[] NOT NULL
);

CREATE TABLE public.job_lease (
    name text NOT NULL,
    owner text NOT NULL,
    expires_at timestamp without time zone NOT NULL
);

CREATE TABLE public.label (
    id text NOT NULL,
    name text NOT NULL,
    color text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    task_id text,
    workspace_id text NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    deletion_started_at timestamp without time zone
);

CREATE TABLE public.mcp_oauth_state (
    id text NOT NULL,
    kind text NOT NULL,
    key text NOT NULL,
    payload jsonb NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.notification (
    id text NOT NULL,
    title text,
    content text,
    type text DEFAULT 'info'::text NOT NULL,
    is_read boolean DEFAULT false,
    resource_id text,
    resource_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text NOT NULL,
    event_data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.project (
    id text NOT NULL,
    workspace_id text NOT NULL,
    slug text NOT NULL,
    icon text DEFAULT 'Layout'::text,
    name text NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    is_public boolean DEFAULT false,
    archived_at timestamp without time zone,
    last_task_number integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    background_object_key text,
    background_mime_type text,
    background_version text,
    phases_enabled boolean DEFAULT false NOT NULL,
    sprints_enabled boolean DEFAULT false NOT NULL,
    start_date timestamp without time zone,
    end_date timestamp without time zone
);

CREATE TABLE public.project_bookmark (
    id text NOT NULL,
    project_id text NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.project_phase (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    start_date timestamp without time zone,
    end_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    parent_id text,
    kind text DEFAULT 'folder'::text NOT NULL,
    archived_at timestamp without time zone
);

CREATE TABLE public.project_recent_access (
    id text NOT NULL,
    project_id text NOT NULL,
    user_id text NOT NULL,
    item_type text NOT NULL,
    item_id text NOT NULL,
    title text NOT NULL,
    parent_label text,
    accessed_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.project_sprint (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    goal text,
    status text DEFAULT 'planned'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    start_date timestamp without time zone,
    end_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    phase_id text
);

CREATE TABLE public.session (
    id text NOT NULL,
    user_id text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    token text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    ip_address text,
    user_agent text,
    active_organization_id text,
    active_team_id text,
    impersonated_by text
);

CREATE TABLE public.storage_cleanup (
    object_key text NOT NULL,
    last_attempt_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.task (
    id text NOT NULL,
    project_id text NOT NULL,
    "position" integer DEFAULT 0,
    number integer DEFAULT 1,
    title text NOT NULL,
    description text,
    status text DEFAULT 'to-do'::text NOT NULL,
    priority text DEFAULT 'low'::text NOT NULL,
    due_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    assignee_id text,
    column_id text,
    start_date timestamp without time zone,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    phase_id text,
    sprint_id text,
    estimated_minutes integer
);

CREATE TABLE public.task_estimate_allocation (
    id text NOT NULL,
    task_id text NOT NULL,
    user_id text NOT NULL,
    estimated_minutes integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.task_relation (
    id text NOT NULL,
    source_task_id text NOT NULL,
    target_task_id text NOT NULL,
    relation_type text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.task_reminder_sent (
    id text NOT NULL,
    task_id text NOT NULL,
    reminder_type text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.team (
    id text NOT NULL,
    name text NOT NULL,
    workspace_id text NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone
);

CREATE TABLE public.team_member (
    id text NOT NULL,
    team_id text NOT NULL,
    user_id text NOT NULL,
    created_at timestamp without time zone
);

CREATE TABLE public.time_entry (
    id text NOT NULL,
    task_id text NOT NULL,
    description text,
    start_time timestamp without time zone NOT NULL,
    end_time timestamp without time zone,
    duration integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    user_id text,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.time_entry_audit (
    id text NOT NULL,
    time_entry_id text NOT NULL,
    task_id text NOT NULL,
    actor_user_id text,
    action text NOT NULL,
    before_data jsonb,
    after_data jsonb,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.trial_grant (
    email_hash text NOT NULL,
    trial_ends_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    is_anonymous boolean DEFAULT false,
    locale text,
    role text,
    banned boolean DEFAULT false,
    ban_reason text,
    ban_expires timestamp without time zone
);

CREATE TABLE public.user_avatar (
    id text NOT NULL,
    user_id text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    data bytea NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.user_notification_preference (
    id text NOT NULL,
    user_id text NOT NULL,
    email_enabled boolean DEFAULT false NOT NULL,
    ntfy_enabled boolean DEFAULT false NOT NULL,
    ntfy_server_url text,
    ntfy_topic text,
    ntfy_token text,
    gotify_enabled boolean DEFAULT false NOT NULL,
    gotify_server_url text,
    gotify_token text,
    webhook_enabled boolean DEFAULT false NOT NULL,
    webhook_url text,
    webhook_secret text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    task_assignment_enabled boolean DEFAULT true NOT NULL,
    task_comment_enabled boolean DEFAULT true NOT NULL,
    task_status_change_enabled boolean DEFAULT true NOT NULL,
    due_date_reminder_enabled boolean DEFAULT true NOT NULL,
    due_date_reminder_lead_time_minutes integer DEFAULT 1440 NOT NULL
);

CREATE TABLE public.user_notification_workspace_project (
    id text NOT NULL,
    workspace_id text NOT NULL,
    workspace_rule_id text NOT NULL,
    project_id text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.user_notification_workspace_rule (
    id text NOT NULL,
    user_id text NOT NULL,
    workspace_id text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    email_enabled boolean DEFAULT false NOT NULL,
    ntfy_enabled boolean DEFAULT false NOT NULL,
    gotify_enabled boolean DEFAULT false NOT NULL,
    webhook_enabled boolean DEFAULT false NOT NULL,
    project_mode text DEFAULT 'all'::text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.workflow_rule (
    id text NOT NULL,
    project_id text NOT NULL,
    integration_type text NOT NULL,
    event_type text NOT NULL,
    column_id text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.workspace (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp without time zone NOT NULL,
    slug text NOT NULL,
    logo text,
    metadata text
);

CREATE TABLE public.workspace_billing (
    id text NOT NULL,
    workspace_id text NOT NULL,
    founding_free boolean DEFAULT false NOT NULL,
    trial_ends_at timestamp without time zone,
    creem_customer_id text,
    creem_subscription_id text,
    creem_product_id text,
    plan text,
    billing_interval text,
    status text,
    seats integer DEFAULT 1 NOT NULL,
    current_period_end timestamp without time zone,
    canceled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.workspace_member (
    id text NOT NULL,
    workspace_id text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp without time zone NOT NULL,
    user_id text NOT NULL
);

CREATE TABLE public.workspace_member_access (
    id text NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    project_access text DEFAULT 'all'::text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.workspace_member_capacity (
    id text NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    minutes_per_day integer DEFAULT 480 NOT NULL,
    working_days_per_week integer DEFAULT 5 NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.workspace_member_project (
    id text NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    project_id text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

CREATE TABLE public.workspace_role (
    id text NOT NULL,
    workspace_id text NOT NULL,
    role text NOT NULL,
    permission text NOT NULL,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_task_external_source_external_url_unique UNIQUE (task_id, external_source, external_url);

ALTER TABLE ONLY public.apikey
    ADD CONSTRAINT apikey_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_object_key_unique UNIQUE (object_key);

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_event
    ADD CONSTRAINT billing_event_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_reminder_sent
    ADD CONSTRAINT billing_reminder_sent_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_reminder_sent
    ADD CONSTRAINT billing_reminder_sent_user_type_unique UNIQUE (user_id, reminder_type);

ALTER TABLE ONLY public.calendar_feed
    ADD CONSTRAINT calendar_feed_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_feed
    ADD CONSTRAINT calendar_feed_token_unique UNIQUE (token);

ALTER TABLE ONLY public."column"
    ADD CONSTRAINT column_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT comment_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.custom_field_definition
    ADD CONSTRAINT custom_field_definition_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.custom_field_value
    ADD CONSTRAINT custom_field_value_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.custom_field_value
    ADD CONSTRAINT custom_field_value_task_field_unique UNIQUE (task_id, field_id);

ALTER TABLE ONLY public.data_migration
    ADD CONSTRAINT data_migration_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.device_code
    ADD CONSTRAINT device_code_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.external_link
    ADD CONSTRAINT external_link_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.github_import
    ADD CONSTRAINT github_import_pkey PRIMARY KEY (integration_id);

ALTER TABLE ONLY public.import_run
    ADD CONSTRAINT import_run_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration
    ADD CONSTRAINT integration_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration
    ADD CONSTRAINT integration_project_type_unique UNIQUE (project_id, type);

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.job_lease
    ADD CONSTRAINT job_lease_pkey PRIMARY KEY (name);

ALTER TABLE ONLY public.label
    ADD CONSTRAINT label_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.label
    ADD CONSTRAINT label_task_name_unique UNIQUE (task_id, name);

ALTER TABLE ONLY public.mcp_oauth_state
    ADD CONSTRAINT mcp_oauth_state_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_bookmark
    ADD CONSTRAINT project_bookmark_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_phase
    ADD CONSTRAINT project_phase_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_recent_access
    ADD CONSTRAINT project_recent_access_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_sprint
    ADD CONSTRAINT project_sprint_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_workspace_id_id_unique UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_unique UNIQUE (token);

ALTER TABLE ONLY public.storage_cleanup
    ADD CONSTRAINT storage_cleanup_pkey PRIMARY KEY (object_key);

ALTER TABLE ONLY public.task_estimate_allocation
    ADD CONSTRAINT task_estimate_allocation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_project_number_unique UNIQUE (project_id, number);

ALTER TABLE ONLY public.task_relation
    ADD CONSTRAINT task_relation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_reminder_sent
    ADD CONSTRAINT task_reminder_sent_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_reminder_sent
    ADD CONSTRAINT task_reminder_sent_task_type_unique UNIQUE (task_id, reminder_type);

ALTER TABLE ONLY public.team_member
    ADD CONSTRAINT team_member_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.time_entry_audit
    ADD CONSTRAINT time_entry_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT time_entry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.trial_grant
    ADD CONSTRAINT trial_grant_pkey PRIMARY KEY (email_hash);

ALTER TABLE ONLY public.user_avatar
    ADD CONSTRAINT user_avatar_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_avatar
    ADD CONSTRAINT user_avatar_user_id_unique UNIQUE (user_id);

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);

ALTER TABLE ONLY public.user_notification_preference
    ADD CONSTRAINT user_notification_preference_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_notification_preference
    ADD CONSTRAINT user_notification_preference_user_id_unique UNIQUE (user_id);

ALTER TABLE ONLY public.user_notification_workspace_project
    ADD CONSTRAINT user_notification_workspace_project_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_notification_workspace_project
    ADD CONSTRAINT user_notification_workspace_project_rule_project_unique UNIQUE (workspace_rule_id, project_id);

ALTER TABLE ONLY public.user_notification_workspace_rule
    ADD CONSTRAINT user_notification_workspace_rule_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_notification_workspace_rule
    ADD CONSTRAINT user_notification_workspace_rule_user_workspace_unique UNIQUE (user_id, workspace_id);

ALTER TABLE ONLY public.user_notification_workspace_rule
    ADD CONSTRAINT user_notification_workspace_rule_workspace_id_id_unique UNIQUE (workspace_id, id);

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workflow_rule
    ADD CONSTRAINT workflow_rule_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_billing
    ADD CONSTRAINT workspace_billing_creem_subscription_id_unique UNIQUE (creem_subscription_id);

ALTER TABLE ONLY public.workspace_billing
    ADD CONSTRAINT workspace_billing_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_billing
    ADD CONSTRAINT workspace_billing_workspace_id_unique UNIQUE (workspace_id);

ALTER TABLE ONLY public.workspace_member_access
    ADD CONSTRAINT workspace_member_access_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_member_access
    ADD CONSTRAINT workspace_member_access_workspace_user_unique UNIQUE (workspace_id, user_id);

ALTER TABLE ONLY public.workspace_member_capacity
    ADD CONSTRAINT workspace_member_capacity_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_member
    ADD CONSTRAINT workspace_member_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_member_project
    ADD CONSTRAINT workspace_member_project_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_member_project
    ADD CONSTRAINT workspace_member_project_workspace_user_project_unique UNIQUE (workspace_id, user_id, project_id);

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_role
    ADD CONSTRAINT workspace_role_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_slug_unique UNIQUE (slug);

CREATE INDEX "account_userId_idx" ON public.account USING btree (user_id);

CREATE INDEX "activity_createdAt_idx" ON public.activity USING btree (created_at);

CREATE INDEX activity_task_id_idx ON public.activity USING btree (task_id);

CREATE INDEX "activity_userId_idx" ON public.activity USING btree (user_id);

CREATE INDEX "apikey_configId_idx" ON public.apikey USING btree (config_id);

CREATE INDEX apikey_key_idx ON public.apikey USING btree (key);

CREATE INDEX "apikey_referenceId_idx" ON public.apikey USING btree (reference_id);

CREATE INDEX "apikey_userId_idx" ON public.apikey USING btree (user_id);

CREATE INDEX "asset_activityId_idx" ON public.asset USING btree (activity_id);

CREATE INDEX "asset_createdBy_idx" ON public.asset USING btree (created_by);

CREATE INDEX asset_draft_expiry_idx ON public.asset USING btree (created_at, id) WHERE ((task_id IS NULL) AND (surface = ANY (ARRAY['draft'::text, 'draft-pending'::text])));

CREATE INDEX "asset_projectId_idx" ON public.asset USING btree (project_id);

CREATE INDEX "asset_taskId_idx" ON public.asset USING btree (task_id);

CREATE INDEX "asset_workspaceId_idx" ON public.asset USING btree (workspace_id);

CREATE INDEX "billing_reminder_sent_userId_idx" ON public.billing_reminder_sent USING btree (user_id);

CREATE INDEX "billing_reminder_sent_workspaceId_idx" ON public.billing_reminder_sent USING btree (workspace_id);

CREATE INDEX calendar_feed_project_id_idx ON public.calendar_feed USING btree (project_id);

CREATE INDEX "column_projectId_idx" ON public."column" USING btree (project_id);

CREATE INDEX comment_task_idx ON public.comment USING btree (task_id);

CREATE INDEX comment_user_idx ON public.comment USING btree (user_id);

CREATE INDEX "custom_field_def_projectId_idx" ON public.custom_field_definition USING btree (project_id);

CREATE INDEX "custom_field_value_fieldId_idx" ON public.custom_field_value USING btree (field_id);

CREATE INDEX "custom_field_value_taskId_idx" ON public.custom_field_value USING btree (task_id);

CREATE UNIQUE INDEX device_code_device_code_uidx ON public.device_code USING btree (device_code);

CREATE UNIQUE INDEX device_code_user_code_uidx ON public.device_code USING btree (user_code);

CREATE INDEX device_code_user_id_idx ON public.device_code USING btree (user_id);

CREATE INDEX external_link_deferred_issue_idx ON public.external_link USING btree (id) WHERE ((resource_type = 'issue'::text) AND (metadata ~~ '%"deferredIssueEdit":%'::text));

CREATE INDEX "external_link_externalId_idx" ON public.external_link USING btree (external_id);

CREATE INDEX "external_link_integrationId_idx" ON public.external_link USING btree (integration_id);

CREATE INDEX "external_link_resourceType_idx" ON public.external_link USING btree (resource_type);

CREATE INDEX "external_link_taskId_idx" ON public.external_link USING btree (task_id);

CREATE INDEX import_run_workspace_created_idx ON public.import_run USING btree (workspace_id, created_at);

CREATE INDEX "integration_projectId_idx" ON public.integration USING btree (project_id);

CREATE INDEX integration_type_idx ON public.integration USING btree (type);

CREATE INDEX invitation_email_idx ON public.invitation USING btree (email);

CREATE INDEX "invitation_inviterId_idx" ON public.invitation USING btree (inviter_id);

CREATE INDEX "invitation_workspaceId_idx" ON public.invitation USING btree (workspace_id);

CREATE INDEX label_task_id_idx ON public.label USING btree (task_id);

CREATE INDEX label_workspace_cascade_idx ON public.label USING btree (workspace_id, name, created_at, id) WHERE (task_id IS NOT NULL);

CREATE INDEX label_workspace_id_idx ON public.label USING btree (workspace_id);

CREATE UNIQUE INDEX label_workspace_name_unique ON public.label USING btree (workspace_id, name) WHERE (task_id IS NULL);

CREATE INDEX "mcp_oauth_state_expiresAt_idx" ON public.mcp_oauth_state USING btree (expires_at);

CREATE UNIQUE INDEX mcp_oauth_state_kind_key_uidx ON public.mcp_oauth_state USING btree (kind, key);

CREATE INDEX "notification_userId_idx" ON public.notification USING btree (user_id);

CREATE INDEX project_background_object_key_idx ON public.project USING btree (background_object_key) WHERE (background_object_key IS NOT NULL);

CREATE INDEX project_bookmark_project_user_idx ON public.project_bookmark USING btree (project_id, user_id);

CREATE INDEX "project_phase_parentId_idx" ON public.project_phase USING btree (parent_id);

CREATE INDEX "project_phase_projectId_idx" ON public.project_phase USING btree (project_id);

CREATE UNIQUE INDEX project_recent_access_unique ON public.project_recent_access USING btree (project_id, user_id, item_type, item_id);

CREATE INDEX project_recent_access_user_project_idx ON public.project_recent_access USING btree (project_id, user_id, accessed_at);

CREATE INDEX "project_sprint_phaseId_idx" ON public.project_sprint USING btree (phase_id);

CREATE INDEX "project_sprint_projectId_idx" ON public.project_sprint USING btree (project_id);

CREATE INDEX "project_workspaceId_position_idx" ON public.project USING btree (workspace_id, "position");

CREATE INDEX "session_userId_idx" ON public.session USING btree (user_id);

CREATE INDEX "task_assigneeId_idx" ON public.task USING btree (assignee_id);

CREATE INDEX "task_columnId_idx" ON public.task USING btree (column_id);

CREATE INDEX "task_dueDate_idx" ON public.task USING btree (due_date);

CREATE INDEX task_estimate_allocation_task_id_idx ON public.task_estimate_allocation USING btree (task_id);

CREATE UNIQUE INDEX task_estimate_allocation_task_user_unique ON public.task_estimate_allocation USING btree (task_id, user_id);

CREATE INDEX "task_phaseId_idx" ON public.task USING btree (phase_id);

CREATE INDEX "task_projectId_idx" ON public.task USING btree (project_id);

CREATE INDEX task_project_scheduled_id_idx ON public.task USING btree (project_id, id) WHERE ((start_date IS NOT NULL) OR (due_date IS NOT NULL));

CREATE INDEX task_relation_source_idx ON public.task_relation USING btree (source_task_id);

CREATE INDEX task_relation_target_idx ON public.task_relation USING btree (target_task_id);

CREATE INDEX "task_reminder_sent_taskId_idx" ON public.task_reminder_sent USING btree (task_id);

CREATE INDEX "task_sprintId_idx" ON public.task USING btree (sprint_id);

CREATE INDEX "teamMember_teamId_idx" ON public.team_member USING btree (team_id);

CREATE INDEX "teamMember_userId_idx" ON public.team_member USING btree (user_id);

CREATE INDEX "team_workspaceId_idx" ON public.team USING btree (workspace_id);

CREATE INDEX time_entry_audit_task_id_idx ON public.time_entry_audit USING btree (task_id);

CREATE INDEX time_entry_audit_time_entry_id_idx ON public.time_entry_audit USING btree (time_entry_id);

CREATE INDEX "time_entry_taskId_idx" ON public.time_entry USING btree (task_id);

CREATE INDEX "time_entry_userId_idx" ON public.time_entry USING btree (user_id);

CREATE INDEX "unwp_workspaceId_workspaceRuleId_idx" ON public.user_notification_workspace_project USING btree (workspace_id, workspace_rule_id);

CREATE INDEX "user_avatar_userId_idx" ON public.user_avatar USING btree (user_id);

CREATE INDEX "user_notification_workspace_project_projectId_idx" ON public.user_notification_workspace_project USING btree (project_id);

CREATE INDEX "user_notification_workspace_project_ruleId_idx" ON public.user_notification_workspace_project USING btree (workspace_rule_id);

CREATE INDEX "user_notification_workspace_project_workspaceId_projectId_idx" ON public.user_notification_workspace_project USING btree (workspace_id, project_id);

CREATE INDEX "user_notification_workspace_rule_userId_idx" ON public.user_notification_workspace_rule USING btree (user_id);

CREATE INDEX "user_notification_workspace_rule_workspaceId_idx" ON public.user_notification_workspace_rule USING btree (workspace_id);

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);

CREATE INDEX "workflow_rule_columnId_idx" ON public.workflow_rule USING btree (column_id);

CREATE INDEX "workflow_rule_projectId_idx" ON public.workflow_rule USING btree (project_id);

CREATE INDEX "workspace_billing_workspaceId_idx" ON public.workspace_billing USING btree (workspace_id);

CREATE INDEX "workspace_member_access_userId_idx" ON public.workspace_member_access USING btree (user_id);

CREATE UNIQUE INDEX workspace_member_capacity_workspace_user_unique ON public.workspace_member_capacity USING btree (workspace_id, user_id);

CREATE INDEX "workspace_member_project_projectId_idx" ON public.workspace_member_project USING btree (project_id);

CREATE INDEX "workspace_member_userId_idx" ON public.workspace_member USING btree (user_id);

CREATE INDEX "workspace_member_workspaceId_idx" ON public.workspace_member USING btree (workspace_id);

CREATE INDEX workspace_role_role_idx ON public.workspace_role USING btree (role);

CREATE INDEX "workspace_role_workspaceId_idx" ON public.workspace_role USING btree (workspace_id);

CREATE TRIGGER asset_storage_cleanup BEFORE DELETE ON public.asset FOR EACH ROW EXECUTE FUNCTION public.queue_deleted_storage_object();

CREATE TRIGGER project_storage_cleanup BEFORE DELETE ON public.project FOR EACH ROW EXECUTE FUNCTION public.queue_deleted_storage_object();

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_task_id_task_id_fk FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.apikey
    ADD CONSTRAINT apikey_reference_id_user_id_fk FOREIGN KEY (reference_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.apikey
    ADD CONSTRAINT apikey_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_activity_id_activity_id_fk FOREIGN KEY (activity_id) REFERENCES public.activity(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_created_by_user_id_fk FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_task_id_task_id_fk FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.billing_reminder_sent
    ADD CONSTRAINT billing_reminder_sent_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.billing_reminder_sent
    ADD CONSTRAINT billing_reminder_sent_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_feed
    ADD CONSTRAINT calendar_feed_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."column"
    ADD CONSTRAINT column_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT comment_task_id_task_id_fk FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT comment_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.custom_field_definition
    ADD CONSTRAINT custom_field_definition_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.custom_field_value
    ADD CONSTRAINT custom_field_value_field_id_custom_field_definition_id_fk FOREIGN KEY (field_id) REFERENCES public.custom_field_definition(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.custom_field_value
    ADD CONSTRAINT custom_field_value_task_id_task_id_fk FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.device_code
    ADD CONSTRAINT device_code_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.external_link
    ADD CONSTRAINT external_link_integration_id_integration_id_fk FOREIGN KEY (integration_id) REFERENCES public.integration(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.external_link
    ADD CONSTRAINT external_link_task_id_task_id_fk FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.github_import
    ADD CONSTRAINT github_import_integration_id_integration_id_fk FOREIGN KEY (integration_id) REFERENCES public.integration(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.import_run
    ADD CONSTRAINT import_run_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.import_run
    ADD CONSTRAINT import_run_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.integration
    ADD CONSTRAINT integration_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_inviter_id_user_id_fk FOREIGN KEY (inviter_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.label
    ADD CONSTRAINT label_task_id_task_id_fk FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.label
    ADD CONSTRAINT label_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project_bookmark
    ADD CONSTRAINT project_bookmark_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project_bookmark
    ADD CONSTRAINT project_bookmark_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project_phase
    ADD CONSTRAINT project_phase_parent_id_project_phase_id_fk FOREIGN KEY (parent_id) REFERENCES public.project_phase(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project_phase
    ADD CONSTRAINT project_phase_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project_recent_access
    ADD CONSTRAINT project_recent_access_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project_recent_access
    ADD CONSTRAINT project_recent_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project_sprint
    ADD CONSTRAINT project_sprint_phase_id_project_phase_id_fk FOREIGN KEY (phase_id) REFERENCES public.project_phase(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project_sprint
    ADD CONSTRAINT project_sprint_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_assignee_id_user_id_fk FOREIGN KEY (assignee_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_column_id_column_id_fk FOREIGN KEY (column_id) REFERENCES public."column"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.task_estimate_allocation
    ADD CONSTRAINT task_estimate_allocation_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.task_estimate_allocation
    ADD CONSTRAINT task_estimate_allocation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_phase_id_project_phase_id_fk FOREIGN KEY (phase_id) REFERENCES public.project_phase(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.task_relation
    ADD CONSTRAINT task_relation_source_task_id_task_id_fk FOREIGN KEY (source_task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.task_relation
    ADD CONSTRAINT task_relation_target_task_id_task_id_fk FOREIGN KEY (target_task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.task_reminder_sent
    ADD CONSTRAINT task_reminder_sent_task_id_task_id_fk FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_sprint_id_project_sprint_id_fk FOREIGN KEY (sprint_id) REFERENCES public.project_sprint(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.team_member
    ADD CONSTRAINT team_member_team_id_team_id_fk FOREIGN KEY (team_id) REFERENCES public.team(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.team_member
    ADD CONSTRAINT team_member_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.time_entry_audit
    ADD CONSTRAINT time_entry_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.time_entry_audit
    ADD CONSTRAINT time_entry_audit_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT time_entry_task_id_task_id_fk FOREIGN KEY (task_id) REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT time_entry_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.user_avatar
    ADD CONSTRAINT user_avatar_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_notification_preference
    ADD CONSTRAINT user_notification_preference_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_notification_workspace_project
    ADD CONSTRAINT user_notification_workspace_project_workspace_id_project_id_pro FOREIGN KEY (workspace_id, project_id) REFERENCES public.project(workspace_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_notification_workspace_project
    ADD CONSTRAINT user_notification_workspace_project_workspace_id_workspace_id_f FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_notification_workspace_project
    ADD CONSTRAINT user_notification_workspace_project_workspace_id_workspace_rule FOREIGN KEY (workspace_id, workspace_rule_id) REFERENCES public.user_notification_workspace_rule(workspace_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_notification_workspace_rule
    ADD CONSTRAINT user_notification_workspace_rule_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_notification_workspace_rule
    ADD CONSTRAINT user_notification_workspace_rule_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.workflow_rule
    ADD CONSTRAINT workflow_rule_column_id_column_id_fk FOREIGN KEY (column_id) REFERENCES public."column"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.workflow_rule
    ADD CONSTRAINT workflow_rule_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES public.project(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_billing
    ADD CONSTRAINT workspace_billing_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_member_access
    ADD CONSTRAINT workspace_member_access_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_member_access
    ADD CONSTRAINT workspace_member_access_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_member_capacity
    ADD CONSTRAINT workspace_member_capacity_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_member_capacity
    ADD CONSTRAINT workspace_member_capacity_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_member_project
    ADD CONSTRAINT workspace_member_project_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_member_project
    ADD CONSTRAINT workspace_member_project_workspace_id_project_id_project_worksp FOREIGN KEY (workspace_id, project_id) REFERENCES public.project(workspace_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_member
    ADD CONSTRAINT workspace_member_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_member
    ADD CONSTRAINT workspace_member_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_role
    ADD CONSTRAINT workspace_role_workspace_id_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON UPDATE CASCADE ON DELETE CASCADE;
