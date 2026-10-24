CREATE TABLE `set_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`question_version_id` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "set_item_position_check" CHECK("set_items"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_item_position_unique` ON `set_items` (`set_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `set_item_version_unique` ON `set_items` (`set_id`,`question_version_id`);--> statement-breakpoint
ALTER TABLE `question_sets` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `publish_request_revision` integer;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `publish_request_fingerprint` text;