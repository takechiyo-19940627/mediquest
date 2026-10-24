CREATE TABLE `study_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`question_version_id` integer NOT NULL,
	`position` integer NOT NULL,
	`selected_ids_json` text,
	`is_correct` integer,
	`answered_at` integer,
	`excluded_reason` text,
	`excluded_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "study_item_position_check" CHECK("study_items"."position" >= 0),
	CONSTRAINT "study_item_correct_check" CHECK("study_items"."is_correct" IS NULL OR "study_items"."is_correct" IN (0,1)),
	CONSTRAINT "study_item_excluded_check" CHECK(("study_items"."excluded_reason" IS NULL AND "study_items"."excluded_at" IS NULL) OR ("study_items"."excluded_reason" IS NOT NULL AND "study_items"."excluded_reason" = 'stopped' AND "study_items"."excluded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_item_position_unique` ON `study_items` (`session_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_item_version_unique` ON `study_items` (`session_id`,`question_version_id`);--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`set_id` integer NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`start_request_key` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "study_session_status_check" CHECK("study_sessions"."status" IN ('in_progress','completed')),
	CONSTRAINT "study_session_mode_check" CHECK("study_sessions"."mode" = 'normal')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_session_user_request_unique` ON `study_sessions` (`user_id`,`start_request_key`);