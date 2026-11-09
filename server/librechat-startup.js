import { Router } from 'express';
import { all, get, run, now, parse, setting } from './db.js';
import { authRouter } from './auth.js';
import { guestConversationCount } from './auth.js';
import { HttpError, canUseAgent, homepageFor, publicUser } from './security.js';

/** Original LibreChat browser contracts backed by the campus cookie identity. */
export const librechatStartupRouter = Router();
export function librechatUser(req, user = req.user) {
 const account = publicUser(user);
 return {
  id: account?.id || req.guestId, username: account?.name || '游客',
  name: account?.name || '游客', email: account?.email || '', avatar: '',
  role: account && account.role !== 'user' ? 'ADMIN' : 'USER',
  provider: account ? 'school-account' : 'school-guest', emailVerified: Boolean(user?.email_verified),
  createdAt: new Date(user?.created_at || now()).toISOString(), updatedAt: new Date().toISOString(),
  schoolRole: account?.role || 'guest', schoolPermissions: account?.permissions || [],
  school: { guest: !account, role: account?.role || 'guest', permissions: account?.permissions || [], guestMigrationCount: account ? guestConversationCount(req.guestId) : 0 },
  plugins: [], twoFactorEnabled: false,
 };
}
// This marker only opens the original browser shell. It grants no server access:
// every endpoint authorizes the real, revocable HttpOnly campus cookie instead.
const sessionView = (req, user) => ({ token: 'school-cookie-session', user: librechatUser(req, user) });
const allowedAgents = req => all('SELECT * FROM agents WHERE published=1 ORDER BY sort_order,created_at').filter(agent => canUseAgent(req.identity, agent));
export function librechatStartup(req) {
 const homepage = homepageFor(req.identity), agents = allowedAgents(req);
 return {
  appTitle: homepage.platformName, serverDomain: process.env.PUBLIC_URL || 'http://localhost:3000',
  socialLogins: [], emailLoginEnabled: true, registrationEnabled: true, passwordResetEnabled: true,
  emailEnabled: setting('registration').requireEmailVerification===true, socialLoginEnabled: false, allowAccountDeletion: false, allowEmailChange: false,
  discordLoginEnabled: false, facebookLoginEnabled: false, githubLoginEnabled: false,
  googleLoginEnabled: false, openidLoginEnabled: false, appleLoginEnabled: false,
  samlLoginEnabled: false, passkeyLoginEnabled: false, twoFactorAuthenticationRequired: false,
  openidLabel: '', openidImageUrl: '', openidAutoRedirect: false, samlLabel: '', samlImageUrl: '',
  minPasswordLength: 12, showBirthdayIcon: false, helpAndFaqURL: '/agents',
  ...(req.user && req.user.role !== 'user' ? { adminPanelURL: '/school/admin' } : {}),
  sharedLinksEnabled: Boolean(req.user), publicSharedLinksEnabled: Boolean(req.user),
  customFooter: homepage.modules?.footer === false ? '' : homepage.footer,
  ragEnabled: false, compactionEnabled: false, pullRequestsEnabled: false, insightsEnabled: false,
  projects: { enabled: false }, mcpApps: { enabled: false }, balance: { enabled: false },
  interface: {
   modelSelect: true, parameters: false, multiConvo: false, bookmarks: false, memories: false,
   presets: false, prompts: false, agents: { use: true, create: false, share: false, public: false },
   temporaryChat: false, retentionMode: 'temporary', runCode: false, webSearch: false,
   contextUsage: false, contextCost: false, artifactUndocking: false, feedback: true,
   marketplace: { use: true, retryDelaysMs: [] }, fileSearch: false, fileCitations: false,
   mascot: false, schedules: false, remoteAgents: { use: false, create: false },
   mcpServers: { use: false, create: false }, skills: false, buildInfo: false,
   sharedLinks: { create: Boolean(req.user), share: Boolean(req.user), public: Boolean(req.user), snapshotFiles: false },
   customWelcome: homepage.welcome, landingHeading: 'entity', landingFooter: false,
  },
  modelSpecs: { enforce: true, prioritize: true, list: agents.map((agent, index) => ({
   name: agent.id, label: agent.name, description: agent.description, default: index === 0,
   showInMenu: true, showOnLanding: true, conversation_starters: parse(agent.questions, []),
   hideBadgeRow: true, preset: { endpoint: 'campus', model: agent.id },
  })) },
  school: { homepage, guest: !req.user, retention: { guestBrowserDays: setting('retention').guestBrowserDays } },
 };
}
librechatStartupRouter.get('/config', (req, res) => res.json(librechatStartup(req)));
librechatStartupRouter.get('/share/:id/config', (req, res) => {
 const share = get('SELECT s.id FROM shares s JOIN conversations c ON s.conversation_id=c.id WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.hidden_at IS NULL', req.params.id, now());
 if (!share) throw new HttpError(404, '分享不存在、已撤销或已到期', 'SHARE_NOT_FOUND');
 res.json({ appTitle: setting('homepage').platformName, interface: { artifactUndocking: false, analyticsConsent: false }, school: { snapshot: true } });
});
librechatStartupRouter.post('/auth/refresh', (req, res) => res.json(sessionView(req)));
librechatStartupRouter.get('/user', (req, res) => res.json(librechatUser(req)));

// Native favorites and sidebar ordering contain IDs only. They use the same
// principal as conversations, without copying chat bodies or merging identities.
let preferencesReady = false;
function nativePreferences(req, key, value) {
 if (!preferencesReady) {
  run("CREATE TABLE IF NOT EXISTS native_preferences(owner_type TEXT NOT NULL CHECK(owner_type IN ('user','guest')),owner_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner_type,owner_id,key))");
  preferencesReady = true;
 }
 if (value !== undefined) run('INSERT INTO native_preferences(owner_type,owner_id,key,value,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_type,owner_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at', req.identity.type, req.identity.id, key, JSON.stringify(value), now());
 return parse(get('SELECT value FROM native_preferences WHERE owner_type=? AND owner_id=? AND key=?', req.identity.type, req.identity.id, key)?.value, []);
}
const favoriteKey = value => value.agentId ? `agent:${value.agentId}` : value.spec ? `spec:${value.spec}` : `model:${value.endpoint.length}:${value.endpoint}:${value.model}`;
function validFavorite(value, allowed) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['agentId', 'spec', 'endpoint', 'model'].includes(key))) return false;
 const variants = Number(value.agentId !== undefined) + Number(value.spec !== undefined) + Number(value.endpoint !== undefined || value.model !== undefined);
 if (variants !== 1) return false;
 if (value.agentId !== undefined) return typeof value.agentId === 'string' && allowed.has(value.agentId);
 if (value.spec !== undefined) return typeof value.spec === 'string' && allowed.has(value.spec);
 return value.endpoint === 'campus' && typeof value.model === 'string' && allowed.has(value.model);
}
function currentFavorites(req) {
 const allowed = new Set(allowedAgents(req).map(agent => agent.id));
 return nativePreferences(req, 'favorites').filter(value => validFavorite(value, allowed));
}
function allowedPinnedKeys(req) {
 const result = new Set(currentFavorites(req).map(favoriteKey));
 if (!all('PRAGMA table_info(conversations)').some(column => column.name === 'pinned')) return result;
 const cutoff = req.identity.type === 'guest' ? now() - setting('retention').guestBrowserDays * 86400000 : 0;
 for (const row of all('SELECT id FROM conversations WHERE owner_type=? AND owner_id=? AND pinned=1 AND hidden_at IS NULL AND last_active_at>=?', req.identity.type, req.identity.id, cutoff)) result.add(`convo:${row.id}`);
 return result;
}
librechatStartupRouter.get('/user/settings/favorites', (req, res) => res.json(currentFavorites(req)));
librechatStartupRouter.post('/user/settings/favorites', (req, res) => {
 const values = req.body?.favorites, allowed = new Set(allowedAgents(req).map(agent => agent.id));
 if (!Array.isArray(values) || values.length > 200 || values.some(value => !validFavorite(value, allowed)) || new Set(values.map(favoriteKey)).size !== values.length) throw new HttpError(400, '收藏必须是当前可用校园智能体、模型或模型配置，且不能重复', 'INVALID_FAVORITES');
 res.json(nativePreferences(req, 'favorites', values));
});
librechatStartupRouter.get('/user/settings/pinned-order', (req, res) => {
 const allowed = allowedPinnedKeys(req);
 res.json(nativePreferences(req, 'pinned_order').filter(key => allowed.has(key)));
});
librechatStartupRouter.post('/user/settings/pinned-order', (req, res) => {
 const values = req.body?.pinnedOrder, allowed = allowedPinnedKeys(req);
 if (!Array.isArray(values) || values.length > 1000 || values.some(key => typeof key !== 'string' || !allowed.has(key)) || new Set(values).size !== values.length) throw new HttpError(400, '置顶顺序只能引用本身份的收藏和置顶会话，且不能重复', 'INVALID_PINNED_ORDER');
 res.json(nativePreferences(req, 'pinned_order', values));
});

function authAlias(path, map = value => value) {
 return (req, res, next) => {
  const internal = Object.create(req);
  Object.assign(internal, { url: path, method: 'POST', body: req.body });
  const json = res.json;
  res.json = function (value) { res.json = json; return json.call(this, res.statusCode < 400 ? map(value, req) : value); };
  authRouter.handle(internal, res, error => { res.json = json; next(error); });
 };
}
librechatStartupRouter.post('/auth/login', authAlias('/auth/login', (value, req) => ({ ...sessionView(req, get('SELECT * FROM users WHERE id=?', value.user.id)), migrationCount: value.migrationCount })));
librechatStartupRouter.post('/auth/logout', authAlias('/auth/logout'));
librechatStartupRouter.post('/auth/register', authAlias('/auth/register'));
librechatStartupRouter.post('/auth/requestPasswordReset', authAlias('/auth/forgot-password'));
librechatStartupRouter.post('/auth/resetPassword', authAlias('/auth/reset-password'));
librechatStartupRouter.post('/user/verify', authAlias('/auth/verify'));
librechatStartupRouter.post('/user/verify/resend', authAlias('/auth/resend-verification'));

librechatStartupRouter.get('/roles/:name', (req, res) => {
 if (!['USER', 'ADMIN'].includes(req.params.name) || req.params.name === 'ADMIN' && (!req.user || req.user.role === 'user')) throw new HttpError(403, '无权读取此角色', 'PERMISSION_DENIED');
 const types = ['PROMPTS', 'BOOKMARKS', 'AGENTS', 'MEMORIES', 'MULTI_CONVO', 'TEMPORARY_CHAT', 'RUN_CODE', 'WEB_SEARCH', 'PEOPLE_PICKER', 'MARKETPLACE', 'FILE_SEARCH', 'FILE_CITATIONS', 'MCP_SERVERS', 'REMOTE_AGENTS', 'SKILLS', 'SHARED_LINKS', 'SCHEDULES'];
 const bits = ['USE', 'CREATE', 'UPDATE', 'READ', 'READ_AUTHOR', 'SHARE', 'OPT_OUT', 'VIEW_USERS', 'VIEW_GROUPS', 'VIEW_ROLES', 'SHARE_PUBLIC', 'CONFIGURE_OBO'];
 const permissions = Object.fromEntries(types.map(type => [type, Object.fromEntries(bits.map(bit => [bit, false]))]));
 permissions.AGENTS.USE = true; permissions.MARKETPLACE.USE = true;
 for (const bit of ['CREATE', 'SHARE', 'SHARE_PUBLIC']) permissions.SHARED_LINKS[bit] = Boolean(req.user);
 res.json({ name: req.params.name, permissions });
});
librechatStartupRouter.get('/endpoints', (req, res) => res.json({ campus: { type: 'custom', order: 0, userProvide: false, name: '校园智能体', titleConvo: false, modelDisplayLabel: '校园智能体' } }));
librechatStartupRouter.get('/models', (req, res) => res.json({ campus: allowedAgents(req).map(agent => agent.id) }));
librechatStartupRouter.get('/files/config', (req, res) => res.json({ endpoints: { default: { disabled: true, fileLimit: 0 }, campus: { disabled: true, fileLimit: 0 } }, serverFileSizeLimit: 0, avatarSizeLimit: 0 }));

function marketplaceAgent(agent) {
 return { id: agent.id, name: agent.name, description: agent.description, provider: 'campus', model: agent.id,
  ...(/^(https?:\/\/|\/(?!\/))/i.test(agent.avatar || '') ? { avatar: { filepath: agent.avatar } } : {}),
  author: '学校管理员', authorName: '学校管理员', createdAt: new Date(agent.created_at).toISOString(), updatedAt: new Date(agent.created_at).toISOString(),
  category: agent.category, categoryIds: [agent.category], conversation_starters: parse(agent.questions, []),
  tools: [], projectIds: [], isCollaborative: false, promoted: Boolean(agent.recommended),
  // Native marketplace can display public descriptions; workflow config/credentials are never serialized.
  school: { avatar: agent.avatar, category: agent.category, recommended: Boolean(agent.recommended), homepageVisible: Boolean(agent.homepage_visible) },
 };
}
librechatStartupRouter.get('/agents/categories', (req, res) => {
 const agents = allowedAgents(req).filter(agent => agent.homepage_visible), counts = new Map();
 for (const agent of agents) counts.set(agent.category, (counts.get(agent.category) || 0) + 1);
 const promoted = agents.filter(agent => agent.recommended).length;
 const categories = [{ id: 'all', value: 'all', label: '全部', name: '全部', count: agents.length }];
 if (promoted && homepageFor(req.identity).modules?.recommended !== false) categories.push({ id: 'promoted', value: 'promoted', label: '推荐', name: '推荐', count: promoted });
 categories.push(...[...counts].map(([value, count]) => ({ id: value, value, label: value, name: value, count })));
 res.json(categories);
});
librechatStartupRouter.get('/agents', (req, res) => {
 const query = String(req.query.search || '').toLocaleLowerCase();
 let agents = allowedAgents(req).filter(agent => agent.homepage_visible && (!query || `${agent.name} ${agent.description}`.toLocaleLowerCase().includes(query)) && (!req.query.category || ['all', 'promoted'].includes(req.query.category) || agent.category === req.query.category) && (!(req.query.promoted === '1' || req.query.category === 'promoted') || agent.recommended));
 if (req.query.mine === '1' || Number(req.query.requiredPermission) > 1) agents = [];
 const start = req.query.cursor ? agents.findIndex(agent => agent.id === req.query.cursor) + 1 : 0;
 const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 1000));
 const data = agents.slice(start, start + limit).map(marketplaceAgent), more = start + data.length < agents.length;
 res.json({ object: 'list', data, first_id: data[0]?.id || '', last_id: data.at(-1)?.id || '', has_more: more, ...(more ? { after: data.at(-1).id } : {}) });
});
librechatStartupRouter.get('/agents/tools', (req, res) => res.json([]));
librechatStartupRouter.get('/agents/:id', (req, res) => {
 const agent = get('SELECT * FROM agents WHERE id=?', req.params.id);
 if (!canUseAgent(req.identity, agent)) throw new HttpError(403, '智能体已下架或当前身份无权使用', 'AGENT_UNAVAILABLE');
 res.json(marketplaceAgent(agent));
});
// Disabled original-provider features return their actual empty state, with all
// mutations left unavailable. They never advertise an unimplemented capability.
for (const path of ['/presets', '/files', '/tags', '/user/plugins', '/user/settings/favorites/tools', '/mcp/tools', '/categories']) librechatStartupRouter.get(path, (req, res) => res.json([]));
librechatStartupRouter.get('/search/enable', (req, res) => res.json(true));
librechatStartupRouter.get('/banner', (req, res) => res.json(null));
librechatStartupRouter.get('/user/terms', (req, res) => res.json({ termsAccepted: true, termsAcceptedAt: null }));
librechatStartupRouter.get('/endpoints/token-config', (req, res) => res.json({}));
librechatStartupRouter.get('/keys', (req, res) => res.json({ expiresAt: '' }));
librechatStartupRouter.get('/files/speech/config/get', (req, res) => res.json({}));
librechatStartupRouter.get('/user/settings/skills/active', (req, res) => res.json({}));
librechatStartupRouter.get('/agents/tools/web_search/auth', (req, res) => res.json({ authenticated: false, authTypes: [] }));
librechatStartupRouter.get('/endpoints/reasoning/:endpoint', (req, res) => res.json({}));
