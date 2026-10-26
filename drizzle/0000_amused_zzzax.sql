CREATE TABLE `game_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`game_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
