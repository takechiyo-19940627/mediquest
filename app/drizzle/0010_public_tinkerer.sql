CREATE TABLE `manual_set_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`requested_by` integer NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`set_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_set_request_unique` ON `manual_set_requests` (`requested_by`,`request_key`);--> statement-breakpoint
CREATE TEMP TABLE manual_version_sequence AS SELECT seq FROM sqlite_sequence WHERE name = 'question_versions';--> statement-breakpoint
CREATE TABLE `__new_question_versions` (
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
	`invalidated_at` integer,
	`invalidated_by` integer,
	`invalidation_reason` text,
	`generation_run_id` integer,
	`manual_created_by` integer,
	`derived_from_version_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invalidated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`manual_created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`derived_from_version_id`) REFERENCES `question_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_version_provenance_check" CHECK(("__new_question_versions"."generation_run_id" IS NOT NULL) + ("__new_question_versions"."derived_from_version_id" IS NOT NULL) + ("__new_question_versions"."manual_created_by" IS NOT NULL) = 1),
	CONSTRAINT "question_invalidation_check" CHECK(("__new_question_versions"."invalidated_at" IS NULL AND "__new_question_versions"."invalidated_by" IS NULL AND "__new_question_versions"."invalidation_reason" IS NULL) OR ("__new_question_versions"."invalidated_at" IS NOT NULL AND "__new_question_versions"."invalidated_by" IS NOT NULL AND "__new_question_versions"."invalidation_reason" IS NOT NULL)),
	CONSTRAINT "question_version_positive_check" CHECK("__new_question_versions"."version_no" >= 1),
	CONSTRAINT "question_quote_boolean_check" CHECK("__new_question_versions"."quote_verified" IN (0,1))
);
--> statement-breakpoint
INSERT INTO `__new_question_versions`("id", "question_id", "version_no", "body", "choices_json", "answer_ids_json", "explanation", "quote", "quote_verified", "reviewed_by", "reviewed_at", "invalidated_at", "invalidated_by", "invalidation_reason", "generation_run_id", "manual_created_by", "derived_from_version_id", "created_at") SELECT "id", "question_id", "version_no", "body", "choices_json", "answer_ids_json", "explanation", "quote", "quote_verified", "reviewed_by", "reviewed_at", "invalidated_at", "invalidated_by", "invalidation_reason", "generation_run_id", NULL, "derived_from_version_id", "created_at" FROM `question_versions`;--> statement-breakpoint
DROP TABLE `question_versions`;--> statement-breakpoint
ALTER TABLE `__new_question_versions` RENAME TO `question_versions`;--> statement-breakpoint
UPDATE sqlite_sequence SET seq = max(seq, COALESCE((SELECT seq FROM manual_version_sequence), 0)) WHERE name = 'question_versions';
--> statement-breakpoint
DROP TABLE manual_version_sequence;--> statement-breakpoint
CREATE UNIQUE INDEX `question_version_id_question_unique` ON `question_versions` (`id`,`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_version_number_unique` ON `question_versions` (`question_id`,`version_no`);