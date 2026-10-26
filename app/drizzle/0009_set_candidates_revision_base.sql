CREATE TABLE `set_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`question_version_id` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_version_id`,`question_id`) REFERENCES `question_versions`(`id`,`question_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_candidate_question_unique` ON `set_candidates` (`set_id`,`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `set_candidate_version_unique` ON `set_candidates` (`set_id`,`question_version_id`);--> statement-breakpoint
CREATE TABLE `set_revision_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`requested_by` integer NOT NULL,
	`request_key` text NOT NULL,
	`source_set_id` integer NOT NULL,
	`source_revision` integer NOT NULL,
	`request_fingerprint` text NOT NULL,
	`created_set_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_revision_request_user_key_unique` ON `set_revision_requests` (`requested_by`,`request_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`derived_from_version_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invalidated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`derived_from_version_id`) REFERENCES `question_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_version_provenance_check" CHECK(("__new_question_versions"."generation_run_id" IS NOT NULL AND "__new_question_versions"."derived_from_version_id" IS NULL) OR ("__new_question_versions"."generation_run_id" IS NULL AND "__new_question_versions"."derived_from_version_id" IS NOT NULL)),
	CONSTRAINT "question_invalidation_check" CHECK(("__new_question_versions"."invalidated_at" IS NULL AND "__new_question_versions"."invalidated_by" IS NULL AND "__new_question_versions"."invalidation_reason" IS NULL) OR ("__new_question_versions"."invalidated_at" IS NOT NULL AND "__new_question_versions"."invalidated_by" IS NOT NULL AND "__new_question_versions"."invalidation_reason" IS NOT NULL)),
	CONSTRAINT "question_version_positive_check" CHECK("__new_question_versions"."version_no" >= 1),
	CONSTRAINT "question_quote_boolean_check" CHECK("__new_question_versions"."quote_verified" IN (0,1))
);
--> statement-breakpoint
INSERT INTO `__new_question_versions`("id", "question_id", "version_no", "body", "choices_json", "answer_ids_json", "explanation", "quote", "quote_verified", "reviewed_by", "reviewed_at", "invalidated_at", "invalidated_by", "invalidation_reason", "generation_run_id", "derived_from_version_id", "created_at") SELECT "id", "question_id", "version_no", "body", "choices_json", "answer_ids_json", "explanation", "quote", "quote_verified", "reviewed_by", "reviewed_at", "invalidated_at", "invalidated_by", "invalidation_reason", "generation_run_id", NULL, "created_at" FROM `question_versions`;--> statement-breakpoint
-- Preserve deleted maximum IDs as well as live IDs.
UPDATE sqlite_sequence SET seq = max(seq, coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'question_versions'), 0)) WHERE name = '__new_question_versions';--> statement-breakpoint
DROP TABLE `question_versions`;--> statement-breakpoint
ALTER TABLE `__new_question_versions` RENAME TO `question_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `question_version_id_question_unique` ON `question_versions` (`id`,`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_version_number_unique` ON `question_versions` (`question_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `__new_question_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`created_by` integer NOT NULL,
	`published_by` integer,
	`published_at` integer,
	`supersedes_set_id` integer,
	`supersedes_revision` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`publish_request_revision` integer,
	`publish_request_fingerprint` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_sets_supersedes_check" CHECK(("__new_question_sets"."supersedes_set_id" IS NULL AND "__new_question_sets"."supersedes_revision" IS NULL) OR ("__new_question_sets"."supersedes_set_id" IS NOT NULL AND "__new_question_sets"."supersedes_revision" IS NOT NULL)),
	CONSTRAINT "question_sets_status_check" CHECK("__new_question_sets"."status" IN ('draft','published','archived'))
);
--> statement-breakpoint
INSERT INTO `__new_question_sets`("id", "source_id", "title", "description", "status", "created_by", "published_by", "published_at", "supersedes_set_id", "supersedes_revision", "revision", "publish_request_revision", "publish_request_fingerprint", "created_at") SELECT "id", "source_id", "title", "description", "status", "created_by", "published_by", "published_at", NULL, NULL, "revision", "publish_request_revision", "publish_request_fingerprint", "created_at" FROM `question_sets`;--> statement-breakpoint
-- Preserve deleted maximum IDs as well as live IDs.
UPDATE sqlite_sequence SET seq = max(seq, coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'question_sets'), 0)) WHERE name = '__new_question_sets';--> statement-breakpoint
DROP TABLE `question_sets`;--> statement-breakpoint
ALTER TABLE `__new_question_sets` RENAME TO `question_sets`;--> statement-breakpoint
CREATE UNIQUE INDEX `question_sets_published_successor_unique` ON `question_sets` (`supersedes_set_id`) WHERE "question_sets"."published_at" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_set_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`question_version_id` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_id`,`question_version_id`) REFERENCES `set_candidates`(`set_id`,`question_version_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "set_item_position_check" CHECK("__new_set_items"."position" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_set_items`("id", "set_id", "question_version_id", "position") SELECT "id", "set_id", "question_version_id", "position" FROM `set_items`;--> statement-breakpoint
-- Preserve deleted maximum IDs as well as live IDs.
UPDATE sqlite_sequence SET seq = max(seq, coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'set_items'), 0)) WHERE name = '__new_set_items';--> statement-breakpoint
DROP TABLE `set_items`;--> statement-breakpoint
ALTER TABLE `__new_set_items` RENAME TO `set_items`;--> statement-breakpoint
CREATE UNIQUE INDEX `set_item_position_unique` ON `set_items` (`set_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `set_item_version_unique` ON `set_items` (`set_id`,`question_version_id`);

--> statement-breakpoint
-- Fail closed on material mismatches; uniqueness rejects multiple versions of
-- one logical question. The runner checks every FK before committing all DDL.
INSERT INTO set_candidates(set_id, question_id, question_version_id)
SELECT CASE WHEN q.source_id = s.source_id AND r.source_id = s.source_id THEN r.set_id END,
       v.question_id, v.id
FROM question_versions v
JOIN questions q ON q.id = v.question_id
JOIN generation_runs r ON r.id = v.generation_run_id
JOIN question_sets s ON s.id = r.set_id;
