import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type ExperimentType =
  | 'feature_flag'
  | 'ab_test'
  | 'percentage_rollout'
  | 'user_segment';

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'archived';

export interface IExperimentVariant {
  id: string;
  name: string;
  description?: string;
  weight: number;
  config: Record<string, unknown>;
}

export interface IExperimentFilter {
  type: 'user_id' | 'badge' | 'premium' | 'staff' | 'account_age' | 'server_count' | 'custom';
  operator: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in';
  value: unknown;
}

export interface IExperimentMetrics {
  impressions: number;
  conversions: number;
  conversionRate: number;
  variantMetrics: Record<string, {
    impressions: number;
    conversions: number;
    conversionRate: number;
  }>;
}

export type IExperiment = typeof schema.experiments.$inferSelect;

export const Experiment = {
  table: schema.experiments,

  async findById(id: string) {
    const [row] = await db.select().from(schema.experiments).where(eq(schema.experiments.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'key': conditions.push(eq(schema.experiments.key, value as string)); break;
        case 'status': conditions.push(eq(schema.experiments.status, value as typeof schema.experiments.status.enumValues[number])); break;
        case 'type': conditions.push(eq(schema.experiments.type, value as typeof schema.experiments.type.enumValues[number])); break;
      }
    }
    let query = db.select().from(schema.experiments);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const [row] = await query.limit(1);
    return row || null;
  },

  async find(filter: Record<string, unknown> = {}) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'status': conditions.push(eq(schema.experiments.status, value as typeof schema.experiments.status.enumValues[number])); break;
        case 'type': conditions.push(eq(schema.experiments.type, value as typeof schema.experiments.type.enumValues[number])); break;
      }
    }
    let query = db.select().from(schema.experiments);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.experiments.$inferInsert) {
    const [row] = await db.insert(schema.experiments).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.experiments.$inferInsert>) {
    const [row] = await db.update(schema.experiments).set({ ...data, updatedAt: new Date() }).where(eq(schema.experiments.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.experiments).where(eq(schema.experiments.id, normalizeId(id)));
  },
};

export function getUserVariant(
  experiment: IExperiment,
  userId: string,
  userAttributes?: Record<string, unknown>
): { inExperiment: boolean; variant: IExperimentVariant | null } {
  if (experiment.status !== 'running') {
    return { inExperiment: false, variant: null };
  }

  const excludedUsers = (experiment.excludedUsers as string[]) || [];
  if (excludedUsers.some(id => id === userId)) {
    return { inExperiment: false, variant: null };
  }

  const userOverrides = (experiment.userOverrides as Array<{ userId: string; variantId: string }>) || [];
  const override = userOverrides.find(o => o.userId === userId);
  if (override) {
    const variants = (experiment.variants as IExperimentVariant[]) || [];
    const variant = variants.find(v => v.id === override.variantId);
    return { inExperiment: true, variant: variant || null };
  }

  const filters = (experiment.filters as IExperimentFilter[]) || [];
  if (filters.length > 0 && userAttributes) {
    const passesFilters = filters.every(filter => {
      const attrValue = userAttributes[filter.type];
      switch (filter.operator) {
        case 'equals':
          return attrValue === filter.value;
        case 'not_equals':
          return attrValue !== filter.value;
        case 'contains':
          return String(attrValue).includes(String(filter.value));
        case 'gt':
          return Number(attrValue) > Number(filter.value);
        case 'lt':
          return Number(attrValue) < Number(filter.value);
        case 'gte':
          return Number(attrValue) >= Number(filter.value);
        case 'lte':
          return Number(attrValue) <= Number(filter.value);
        case 'in':
          return Array.isArray(filter.value) && filter.value.includes(attrValue);
        case 'not_in':
          return Array.isArray(filter.value) && !filter.value.includes(attrValue);
        default:
          return true;
      }
    });

    if (!passesFilters) {
      return { inExperiment: false, variant: null };
    }
  }

  const hash = hashUserId(userId, experiment.key);
  const bucket = hash % 100;

  if (bucket >= (experiment.rolloutPercentage ?? 0)) {
    return { inExperiment: false, variant: null };
  }

  const variants = (experiment.variants as IExperimentVariant[]) || [];
  if (variants.length === 0) {
    return { inExperiment: true, variant: null };
  }

  let cumulativeWeight = 0;
  const variantBucket = hash % 100;

  for (const variant of variants) {
    cumulativeWeight += variant.weight;
    if (variantBucket < cumulativeWeight) {
      return { inExperiment: true, variant };
    }
  }

  return { inExperiment: true, variant: variants[0] || null };
}

function hashUserId(userId: string, experimentKey: string): number {
  const str = `${userId}:${experimentKey}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
