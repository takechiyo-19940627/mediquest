CREATE TABLE `generation_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`requested_by` integer NOT NULL,
	`source_id` integer NOT NULL,
	`set_id` integer NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`requested_count` integer NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "generation_runs_status_check" CHECK("generation_runs"."status" IN ('running','succeeded','failed','unknown')),
	CONSTRAINT "generation_runs_count_check" CHECK("generation_runs"."requested_count" BETWEEN 1 AND 10),
	CONSTRAINT "generation_runs_error_check" CHECK("generation_runs"."error_code" IS NULL OR "generation_runs"."error_code" IN ('provider_failed','provider_unknown','invalid_output','storage_failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_run_user_key_unique` ON `generation_runs` (`requested_by`,`request_key`);--> statement-breakpoint
CREATE TABLE `question_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`created_by` integer NOT NULL,
	`published_by` integer,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_sets_status_check" CHECK("question_sets"."status" IN ('draft','published','archived'))
);
--> statement-breakpoint
CREATE TABLE `question_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`version_no` integer NOT NULL,
	`body` text NOT NULL,
	`choices_json` text NOT NULL,
	`answer_ids_json` text NOT NULL,
	`explanation` text NOT NULL,
	`quote` text NOT NULL,
	`quote_verified` integer NOT NULL,
	`reviewed_by` integer,
	`reviewed_at` integer,
	`generation_run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_version_positive_check" CHECK("question_versions"."version_no" >= 1),
	CONSTRAINT "question_quote_boolean_check" CHECK("question_versions"."quote_verified" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_version_number_unique` ON `question_versions` (`question_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "questions_status_check" CHECK("questions"."status" IN ('active','stopped'))
);
