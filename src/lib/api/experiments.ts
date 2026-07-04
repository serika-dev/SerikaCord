import { Elysia, t } from 'elysia';
import { Experiment, getUserVariant } from '@/lib/models/Experiment';
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
      user_id: user._id.toString(),
      badge: user.badges ?? [],
      premium: user.isPremium ?? false,
      staff: (user.badges ?? []).some((b: string) => b === 'staff' || b === 'admin'),
      account_age: user.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000) : 0,
    };
    const result = getUserVariant(experiment, user._id.toString(), userAttributes);
    
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
      user_id: user._id.toString(),
      badge: user.badges ?? [],
      premium: user.isPremium ?? false,
      staff: (user.badges ?? []).some((b: string) => b === 'staff' || b === 'admin'),
      account_age: user.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000) : 0,
    };

    // Get user's variant for each experiment
    const results = await Promise.all(
      experiments.map(async (exp) => {
        const result = getUserVariant(exp, user._id.toString(), userAttributes);
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
      user_id: user._id.toString(),
      badge: user.badges ?? [],
      premium: user.isPremium ?? false,
      staff: (user.badges ?? []).some((b: string) => b === 'staff' || b === 'admin'),
      account_age: user.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000) : 0,
    };
    const result = getUserVariant(experiment, user._id.toString(), featureAttributes);
    
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
        id: instance._id,
        name: instance.name,
        type: instance.type,
        status: instance.status,
        config: instance.config,
      } : null,
    };
  })

  // Register a new self-hosted instance (public)
  .post('/register', async ({ headers, body, set }) => {
    const host = headers.host || '';
    
    // Only allow registration from non-host domains
    if (isHostDomain(host)) {
      set.status = 400;
      return { error: 'Cannot register host domain as self-hosted instance' };
    }

    const { name, adminEmail, domain } = body as {
      name: string;
      adminEmail: string;
      domain: string;
    };

    // Check if domain already registered
    const existing = await Instance.findOne({ domain });
    if (existing) {
      set.status = 400;
      return { error: 'Domain already registered' };
    }

    // Generate API key
    const { key, hash, prefix } = generateInstanceApiKey();
    const secretKey = generateSecretKey();

    const instance = new Instance({
      name,
      domain,
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

    await instance.save();

    return {
      success: true,
      instanceId: instance._id,
      apiKey: key, // Only returned once!
      message: 'Instance registered. Please wait for approval from the host server.',
    };
  }, {
    body: t.Object({
      name: t.String(),
      adminEmail: t.String(),
      domain: t.String(),
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
