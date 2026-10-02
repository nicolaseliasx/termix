CREATE TABLE "persistent_session_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" text,
	"client_id" text,
	"details" text,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persistent_sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"tmux_session_name" varchar(255) NOT NULL,
	"management_state" text DEFAULT 'managed' NOT NULL,
	"expiry_mode" text DEFAULT 'manual' NOT NULL,
	"expiry_seconds" integer,
	"remote_created_at" text,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_attached_at" text,
	"last_detached_at" text,
	"expires_at" varchar(255),
	"last_observed_at" text,
	"hibernated_at" text,
	"ended_at" varchar(255),
	"end_reason" text
);
--> statement-breakpoint
ALTER TABLE "session_recordings" ALTER COLUMN "ended_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "persistent_session_events" ADD CONSTRAINT "persistent_session_events_session_id_persistent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."persistent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persistent_sessions" ADD CONSTRAINT "persistent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persistent_sessions" ADD CONSTRAINT "persistent_sessions_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_persistent_session_events_session_time" ON "persistent_session_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_persistent_sessions_user_active" ON "persistent_sessions" USING btree ("user_id","ended_at");--> statement-breakpoint
CREATE INDEX "idx_persistent_sessions_host_active" ON "persistent_sessions" USING btree ("host_id","ended_at");--> statement-breakpoint
CREATE INDEX "idx_persistent_sessions_expiry" ON "persistent_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_persistent_sessions_host_tmux_active" ON "persistent_sessions" USING btree ("host_id","tmux_session_name") WHERE "persistent_sessions"."ended_at" IS NULL;