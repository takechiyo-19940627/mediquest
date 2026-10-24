CREATE TABLE `issue_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reported_by` integer NOT NULL,
	`question_version_id` integer NOT NULL,
	`study_item_id` integer NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`study_item_id`) REFERENCES `study_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "issue_report_status_check" CHECK("issue_reports"."status" IN ('open','confirmed','dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_report_open_user_version_unique` ON `issue_reports` (`reported_by`,`question_version_id`) WHERE "issue_reports"."status" = 'open';