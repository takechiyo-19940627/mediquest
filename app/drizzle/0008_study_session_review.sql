-- Issue #44: study_sessions gains mode 'review' and a nullable self-referencing parent_session_id.
-- Written in the Drizzle Kit table-rebuild form (see 0006); existing rows copy NULL into the new column.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_study_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`set_id` integer NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`parent_session_id` integer,
	`start_request_key` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "study_session_status_check" CHECK("__new_study_sessions"."status" IN ('in_progress','completed')),
	CONSTRAINT "study_session_mode_check" CHECK("__new_study_sessions"."mode" IN ('normal','review')),
	CONSTRAINT "study_session_parent_check" CHECK(("__new_study_sessions"."mode" = 'normal' AND "__new_study_sessions"."parent_session_id" IS NULL) OR ("__new_study_sessions"."mode" = 'review' AND "__new_study_sessions"."parent_session_id" IS NOT NULL AND "__new_study_sessions"."parent_session_id" <> "__new_study_sessions"."id"))
);
--> statement-breakpoint
INSERT INTO `__new_study_sessions`("id", "user_id", "set_id", "status", "mode", "parent_session_id", "start_request_key", "started_at", "completed_at") SELECT "id", "user_id", "set_id", "status", "mode", NULL, "start_request_key", "started_at", "completed_at" FROM `study_sessions`;--> statement-breakpoint
DROP TABLE `study_sessions`;--> statement-breakpoint
ALTER TABLE `__new_study_sessions` RENAME TO `study_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `study_session_user_request_unique` ON `study_sessions` (`user_id`,`start_request_key`);
