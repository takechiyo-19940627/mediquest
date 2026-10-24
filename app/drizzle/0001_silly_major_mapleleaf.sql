CREATE TABLE `source_creation_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_by` integer NOT NULL,
	`request_key` text NOT NULL,
	`source_id` integer NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_request_user_key_unique` ON `source_creation_requests` (`created_by`,`request_key`);