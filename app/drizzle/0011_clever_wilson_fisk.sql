CREATE TABLE `past_exam_questions` (
	`question_version_id` integer PRIMARY KEY NOT NULL,
	`question_number` text NOT NULL,
	FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `past_exam_requests` (
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
CREATE UNIQUE INDEX `past_exam_request_unique` ON `past_exam_requests` (`requested_by`,`request_key`);--> statement-breakpoint
CREATE TABLE `past_exams` (
	`set_id` integer PRIMARY KEY NOT NULL,
	`exam_name` text NOT NULL,
	`year` text NOT NULL,
	`subject` text NOT NULL,
	`source_reference` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict
);
