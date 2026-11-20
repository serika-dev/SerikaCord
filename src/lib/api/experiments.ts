import { Elysia, t } from 'elysia';
import { Experiment, getUserVariant } from '@/lib/models/Experiment';
import { checkRateLimit, getClientIP } from '@/lib/security';
import { Instance, isHostDomain, getCurrentInstance, verifyInstanceApiKey, generateInstanceApiKey, generateSecretKey } from '@/lib/models/Instance';

export const experimentRoutes = new Elysia({ prefix: '/experiments' })
  
  // Get user's variant for an experiment
  .get('/variant/:experimentKey', async ({ headers, cookie, params, set }) => {
    const { authenticateRequest } = await import('@/lib/services/auth');
    const authHeader = headers.authorization ?? null;
    const authToken = cookie.auth_token?.value;
    const cookies: Record<string, string> = {};
    if (typeof authToken === 'string') {
      cookies.auth_token = authToken;
    }
    const { user, error } = await authenticateRequest(authHeader, cookies);
    
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    // Find the experiment
    const experiment = await Experiment.findOne({ key: params.experimentKey, status: 'running' });
    if (!experiment) {
      return {
        experimentKey: params.experimentKey,
        variant: null,
      };
    }

    const userAttributes: Record<string, unknown> = {
      user_id: user.id,
      badge: user.badges ?? [],
      premium: user.isPremium ?? false,
      staff: (user.badges ?? []).some((b: string) => b === 'staff' || b === 'admin'),
      account_age: user.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000) : 0,
    };
    const result = getUserVariant(experiment, user.id, userAttributes);
    
    return {
      experimentKey: params.experimentKey,
      variant: result.variant,
      inExperiment: result.inExperiment,
    };
  }, {
    params: t.Object({
      experimentKey: t.String(),
    }),
  })

  // Get all active experiments for user
  .get('/active', async ({ headers, cookie, set }) => {
    const { authenticateRequest } = await import('@/lib/services/auth');
    const authHeader = headers.authorization ?? null;
    const authToken = cookie.auth_token?.value;
    const cookies: Record<string, string> = {};
    if (typeof authToken === 'string') {
      cookies.auth_token = authToken;
    }
    const { user, error } = await authenticateRequest(authHeader, cookies);
    
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    // Get all running experiments
    const experiments = await Experiment.find({ status: 'running' });

    // Build user attributes for filter evaluation
    const userAttributes: Record<string, unknown> = {
      user_id: user.id,
      badge: user.badges ?? [],
      premium: user.isPremium ?? false,
      staff: (user.badges ?? []).some((b: string) => b === 'staff' || b === 'admin'),
      account_age: user.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000) : 0,
    };

    // Get user's variant for each experiment
    const results = await Promise.all(
      experiments.map(async (exp) => {
        const result = getUserVariant(exp, user.id, userAttributes);
        return {
          key: exp.key,
          name: exp.name,
          type: exp.type,
          variant: result.variant,
          inExperiment: result.inExperiment,
        };
      })
    );

    // Filter out experiments where user is not enrolled
    return {
      experiments: results.filter(r => r.inExperiment),
    };
  })

  // Check if a feature is enabled for user
  .get('/feature/:featureKey', async ({ headers, cookie, params, set }) => {
    const { authenticateRequest } = await import('@/lib/services/auth');
    const authHeader = headers.authorization ?? null;
    const authToken = cookie.auth_token?.value;
    const cookies: Record<string, string> = {};
    if (typeof authToken === 'string') {
      cookies.auth_token = authToken;
    }
    const { user, error } = await authenticateRequest(authHeader, cookies);
    
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    // Find the experiment
    const experiment = await Experiment.findOne({ key: params.featureKey, status: 'running' });
    if (!experiment) {
      return {
        featureKey: params.featureKey,
        enabled: false,
        variant: null,
      };
    }

    const featureAttributes: Record<string, unknown> = {
      user_id: user.id,
      badge: user.badges ?? [],
      premium: user.isPremium ?? false,
      staff: (user.badges ?? []).some((b: string) => b === 'staff' || b === 'admin'),
      account_age: user.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000) : 0,
    };
    const result = getUserVariant(experiment, user.id, featureAttributes);
    
    // For feature flags, any variant that's not null and not 'control' means enabled
    const enabled = result.inExperiment && result.variant !== null && result.variant.id !== 'control';
    
    return {
      featureKey: params.featureKey,
      enabled,
      variant: result.variant,
    };
  }, {
    params: t.Object({
      featureKey: t.String(),
    }),
  });

export const instanceRoutes = new Elysia({ prefix: '/instance' })
  
  // Get current instance info
  .get('/info', async ({ headers }) => {
    const host = headers.host || '';
    const isHost = isHostDomain(host);
    const instance = await getCurrentInstance();
    
    return {
      isHost,
      domain: host,
      instance: instance ? {
        id: instance.id,
        name: instance.name,
        type: instance.type,
        status: instance.status,
        config: instance.config,
      } : null,
    };
  })

  // Register a new self-hosted instance (public)
  .post('/register', async ({ headers, body, request, set }) => {
    // Unauthenticated: a tight per-IP limit keeps it from filling the table.
    const rl = await checkRateLimit('instanceRegister', getClientIP(request));
    if (!rl.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: rl.retryAfter };
    }

    // The Host header is client-supplied, so it only ever narrows this route;
    // the domain being registered is what must not be ours.
    const host = headers.host || '';
    if (isHostDomain(host)) {
      set.status = 400;
      return { error: 'Cannot register host domain as self-hosted instance' };
    }

    const name = body.name.trim();
    const adminEmail = body.adminEmail.trim();
    const domain = body.domain.trim().toLowerCase().replace(/\.$/, '');
    if (!name) {
      set.status = 400;
      return { error: 'Name is required' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      set.status = 400;
      return { error: 'Invalid admin email' };
    }
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
      set.status = 400;
      return { error: 'Invalid domain' };
    }
    if (isHostDomain(domain)) {
      set.status = 400;
      return { error: 'Cannot register host domain as self-hosted instance' };
    }

    // Check if domain already registered
    const existing = await Instance.findOne({ domain });
    if (existing) {
      set.status = 400;
      return { error: 'Domain already registered' };
    }

    // Generate API key
    const { key, hash, prefix } = generateInstanceApiKey();
    const secretKey = generateSecretKey();

    const instance = await Instance.create({
      name,
      domain,
      instanceId: crypto.randomUUID(),
      type: 'self_hosted',
      status: 'pending', // Requires admin approval
      ownerEmail: adminEmail,
      apiKey: hash,
      apiKeyPrefix: prefix,
      secretKey,
      config: {
        allowFederation: false, // Disabled until approved
        allowExternalEmojis: true,
        shareUserData: false,
      },
    });

    return {
      success: true,
      instanceId: instance.id,
      apiKey: key, // Only returned once!
      message: 'Instance registered. Please wait for approval from the host server.',
    };
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 100 }),
      adminEmail: t.String({ minLength: 3, maxLength: 254 }),
      domain: t.String({ minLength: 1, maxLength: 253 }),
    }),
  })

  // Instance ping (for self-hosted instances to report status)
  .post('/ping', async ({ headers, body, set }) => {
    const apiKey = headers['x-instance-api-key'];
    if (!apiKey) {
      set.status = 401;
      return { error: 'API key required' };
    }

    const { domain } = body as {
      domain: string;
    };

    // Verify API key
    const instance = await verifyInstanceApiKey(apiKey);
    if (!instance) {
      set.status = 401;
      return { error: 'Invalid API key' };
    }

    // Check domain matches
    if (instance.domain !== domain) {
      set.status = 403;
      return { error: 'Domain mismatch' };
    }

    return {
      success: true,
      status: instance.status,
      config: instance.config,
    };
  }, {
    body: t.Object({
      domain: t.String(),
    }),
  });
