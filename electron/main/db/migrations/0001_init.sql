CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`kind` text,
	`title` text,
	`body` text,
	`company_id` text,
	`person_id` text,
	`engagement_id` text,
	`source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `affiliations` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`company_id` text,
	`title` text,
	`is_primary` integer,
	`started` text,
	`ended` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text,
	`website` text,
	`bills_directly` integer DEFAULT true,
	`billed_via_company_id` text,
	`introduced_by_company_id` text,
	`cadence_days` integer DEFAULT 14,
	`last_touch_at` text,
	`budget_note` text,
	`notes` text,
	`since` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`billed_via_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`introduced_by_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "companies_billed_via_company_not_self" CHECK(("companies"."billed_via_company_id" IS NULL OR "companies"."billed_via_company_id" != "companies"."id"))
);
--> statement-breakpoint
CREATE TABLE `engagements` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`billing_company_id` text,
	`client_company_id` text,
	`service_version_id` text,
	`agreed_rate_cents` integer,
	`billing_model` text,
	`status` text,
	`started_on` text NOT NULL,
	`ends_on` text,
	`renews_on` text,
	`hours_included` real,
	`contract_value_cents` integer,
	`hourly_rate_cents` integer,
	`estimated_hours` real,
	`not_to_exceed_cents` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`billing_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_version_id`) REFERENCES `service_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `external_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`source` text,
	`external_id` text,
	`url` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favicons` (
	`host` text PRIMARY KEY NOT NULL,
	`bytes` blob,
	`fetched_at` text
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`url` text,
	`title` text,
	`kind` text,
	`added_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text,
	`name` text,
	`sort` integer,
	`completed_at` text,
	`amount_cents` integer,
	`expected_month` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`notes` text,
	`last_contact_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `revenue_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text,
	`period_month` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`kind` text,
	`status` text,
	`invoiced_at` text,
	`paid_at` text,
	`stripe_invoice_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_revenue_lines_period_month` ON `revenue_lines` (`period_month`);--> statement-breakpoint
CREATE TABLE `service_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`color` text,
	`sort` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text,
	`version` integer,
	`rate_cents` integer,
	`effective_from` text,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`category_id` text,
	`billing_model` text,
	`unit` text,
	`blurb` text,
	`active` integer DEFAULT true,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `service_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `taggings` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text,
	`entity_type` text,
	`entity_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taggings_tag_entity_unique` ON `taggings` (`tag_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`color` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text,
	`is_next_step` integer DEFAULT false,
	`due_on` text,
	`waiting_since` text,
	`done_at` text,
	`company_id` text,
	`engagement_id` text,
	`person_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text,
	`company_id` text,
	`worked_on` text,
	`hours` real,
	`note` text,
	`source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_time_entries_worked_on` ON `time_entries` (`worked_on`);