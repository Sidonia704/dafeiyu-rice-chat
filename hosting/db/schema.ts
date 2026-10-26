import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const gameSessions = sqliteTable('game_sessions', {
  id: text('id').primaryKey(),
  gameJson: text('game_json').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at').notNull()
});
