import { pgTable, text, serial, timestamp, integer, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
  type: text("type").notNull().default("simple"),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  url: text("url"),
  result: text("result"),
  error: text("error"),
  modelUsed: text("model_used"),
  category: text("category"),
  duration: integer("duration"),
  steps: jsonb("steps").default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  title: text("title"),
  messages: jsonb("messages").notNull().default([]),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const modelPerformanceTable = pgTable("model_performance", {
  id: serial("id").primaryKey(),
  model: text("model").notNull(),
  category: text("category").notNull(),
  successes: integer("successes").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  avgDuration: real("avg_duration").notNull().default(0),
  qualityScore: real("quality_score").notNull().default(0.5),
  lastUsed: timestamp("last_used").notNull().defaultNow(),
});

export const memoryTable = pgTable("memory", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  ttl: integer("ttl"),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
});

export const logsTable = pgTable("logs", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  source: text("source"),
  taskId: text("task_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ createdAt: true, updatedAt: true });
export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ createdAt: true, updatedAt: true });
export const insertModelPerformanceSchema = createInsertSchema(modelPerformanceTable).omit({ id: true, lastUsed: true });
export const insertMemorySchema = createInsertSchema(memoryTable).omit({ id: true, createdAt: true });
export const insertLogSchema = createInsertSchema(logsTable).omit({ id: true, createdAt: true });

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type ModelPerformance = typeof modelPerformanceTable.$inferSelect;
export type Memory = typeof memoryTable.$inferSelect;
export type Log = typeof logsTable.$inferSelect;
