CREATE TABLE `persistent_session_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` varchar(255) NOT NULL,
	`event_type` text NOT NULL,
	`actor_id` text,
	`client_id` text,
	`details` text,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `persistent_session_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `persistent_sessions` (
	`id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`host_id` int NOT NULL,
	`display_name` text NOT NULL,
	`tmux_session_name` varchar(255) NOT NULL,
	`management_state` text NOT NULL DEFAULT ('managed'),
	`expiry_mode` text NOT NULL DEFAULT ('manual'),
	`expiry_seconds` int,
	`remote_created_at` text,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`last_attached_at` text,
	`last_detached_at` text,
	`expires_at` varchar(255),
	`last_observed_at` text,
	`hibernated_at` text,
	`ended_at` varchar(255),
	`end_reason` text,
	CONSTRAINT `persistent_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_persistent_sessions_host_tmux_active` UNIQUE(`host_id`,`tmux_session_name`)
);
--> statement-breakpoint
ALTER TABLE `session_recordings` MODIFY COLUMN `ended_at` varchar(255);--> statement-breakpoint
ALTER TABLE `persistent_session_events` ADD CONSTRAINT `persistent_session_events_session_id_persistent_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `persistent_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `persistent_sessions` ADD CONSTRAINT `persistent_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `persistent_sessions` ADD CONSTRAINT `persistent_sessions_host_id_ssh_data_id_fk` FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_persistent_session_events_session_time` ON `persistent_session_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_persistent_sessions_user_active` ON `persistent_sessions` (`user_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `idx_persistent_sessions_host_active` ON `persistent_sessions` (`host_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `idx_persistent_sessions_expiry` ON `persistent_sessions` (`expires_at`);