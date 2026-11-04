import type { StartupConfigContext } from './config';
import type { AssistantsEndpoint } from './schemas';
import type * as t from './types';
import { ResourceType } from './accessPermissions';
import * as q from './types/queries';

let BASE_URL = '';
if (
  typeof process === 'undefined' ||
  (process as typeof process & { browser?: boolean }).browser === true
) {
  // process is only available in node context, or process.browser is true in client-side code
  // This is to ensure that the BASE_URL is set correctly based on the <base>
  // element in the HTML document, if it exists.
  const baseEl = document.querySelector('base');
  BASE_URL = baseEl?.getAttribute('href') || '/';
}

if (BASE_URL && BASE_URL.endsWith('/')) {
  BASE_URL = BASE_URL.slice(0, -1);
}

export const apiBaseUrl = () => BASE_URL;

// School adapter namespace; browser/router base remains the original deployment base.
const API_URL = `${BASE_URL}/api/librechat`;

// Testing this buildQuery function
const buildQuery = (params: Record<string, unknown>): string => {
  const query = Object.entries(params)
    .filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== null && value !== '';
    })
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((v) => `${key}=${encodeURIComponent(v)}`).join('&');
      }
      return `${key}=${encodeURIComponent(String(value))}`;
    })
    .join('&');
  return query ? `?${query}` : '';
};

export const health = () => `${BASE_URL}/health`;
export const user = () => `${API_URL}/user`;
export const userPreferences = () => `${user()}/preferences`;

export const balance = () => `${API_URL}/balance`;

export const userPlugins = () => `${API_URL}/user/plugins`;

export const deleteUser = () => `${API_URL}/user/delete`;
export const codeEnvironments = () => `${API_URL}/code-environments`;
export const codeSetupAttempt = (attemptId: string) =>
  `${codeEnvironments()}/setup/${encodeURIComponent(attemptId)}`;
export const codeSetupApprove = (attemptId: string) => `${codeSetupAttempt(attemptId)}/approve`;
export const codeSetupDeny = (attemptId: string) => `${codeSetupAttempt(attemptId)}/deny`;
export const codeEnvironmentPairings = () => `${codeEnvironments()}/pairings`;
export const codeEnvironmentById = (id: string) =>
  `${codeEnvironments()}/${encodeURIComponent(id)}`;
export const codeEnvironmentSettings = (id: string) => `${codeEnvironmentById(id)}/settings`;
export const codeEnvironmentStatus = (id: string) => `${codeEnvironmentById(id)}/status`;
export const codeEnvironmentConversationDecision = (conversationId: string) =>
  `${codeEnvironments()}/conversations/${encodeURIComponent(conversationId)}/decision`;

const messagesRoot = `${API_URL}/messages`;

export const messages = (params: q.MessagesListParams) => {
  const { conversationId, messageId, ...rest } = params;

  if (conversationId && messageId) {
    return `${messagesRoot}/${conversationId}/${messageId}`;
  }

  if (conversationId) {
    return `${messagesRoot}/${conversationId}`;
  }

  return `${messagesRoot}${buildQuery(rest)}`;
};

export const messagesArtifacts = (messageId: string) => `${messagesRoot}/artifact/${messageId}`;

/** The child calls of a stored message's subagent transcripts that the given files belong to. */
export const messageSubagentAttachmentCalls = ({
  conversationId,
  messageId,
  files,
}: q.SubagentAttachmentCallsParams) =>
  `${messagesRoot}/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}/subagent-calls?files=${encodeURIComponent(JSON.stringify(files))}`;

/** One tool-call part of a stored message, in full. */
export const messageToolCallPart = ({
  conversationId,
  messageId,
  partIndex,
  toolCallId,
  stepId,
  agentId,
}: q.ToolCallPartParams) => {
  const path = `${messagesRoot}/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}/parts/${partIndex}`;
  const query = [
    ['toolCallId', toolCallId],
    ['stepId', stepId],
    ['agentId', agentId],
  ]
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return query === '' ? path : `${path}?${query}`;
};

export const messagesBranch = () => `${messagesRoot}/branch`;

const shareRoot = `${API_URL}/share`;
export const shareMessages = (shareId: string) => `${shareRoot}/${shareId}`;
export const forkSharedMessages = (shareId: string) => `${shareRoot}/${shareId}/fork`;
export const sharedStartupConfig = (shareId: string) => `${shareMessages(shareId)}/config`;
export const getSharedLink = (conversationId: string) => `${shareRoot}/link/${conversationId}`;
export const getSharedLinks = (
  pageSize: number,
  sortBy: 'title' | 'createdAt',
  sortDirection: 'asc' | 'desc',
  search?: string,
  cursor?: string,
) => `${shareRoot}${buildQuery({ pageSize, sortBy, sortDirection, search, cursor })}`;
export const createSharedLink = (conversationId: string) => `${shareRoot}/${conversationId}`;
export const updateSharedLink = (shareId: string) => `${shareRoot}/${shareId}`;
/** Share-scoped file routes: serve snapshotted files via shared-link permission. */
export const sharedFile = (shareId: string, fileId: string) =>
  `${shareRoot}/${shareId}/files/${encodeURIComponent(fileId)}`;
export const sharedFileDownload = (shareId: string, fileId: string) =>
  `${sharedFile(shareId, fileId)}/download`;
export const sharedFilePreview = (shareId: string, fileId: string) =>
  `${sharedFile(shareId, fileId)}/preview`;

const keysEndpoint = `${API_URL}/keys`;

export const keys = () => keysEndpoint;

export const userKeyQuery = (name: string) => `${keysEndpoint}?name=${name}`;

export const revokeUserKey = (name: string) => `${keysEndpoint}/${name}`;

export const revokeAllUserKeys = () => `${keysEndpoint}?all=true`;

const apiKeysEndpoint = `${API_URL}/api-keys`;

export const apiKeys = () => apiKeysEndpoint;

export const apiKeyById = (id: string) => `${apiKeysEndpoint}/${id}`;

export const conversationsRoot = `${API_URL}/convos`;

export const conversations = (params: q.ConversationListParams) => {
  return `${conversationsRoot}${buildQuery(params)}`;
};

export const conversationById = (id: string) => `${conversationsRoot}/${id}`;

export const parentSubagents = (parentConversationId: string) =>
  `${conversationsRoot}/${encodeURIComponent(parentConversationId)}/subagents`;

export const subagentThread = (
  parentConversationId: string,
  threadId: string,
  taskId?: string,
  cursor?: string,
) => {
  const endpoint = `${conversationsRoot}/${encodeURIComponent(parentConversationId)}/subagents/${encodeURIComponent(threadId)}`;
  if (taskId != null) return `${endpoint}?taskId=${encodeURIComponent(taskId)}`;
  return cursor == null ? endpoint : `${endpoint}?cursor=${encodeURIComponent(cursor)}`;
};

export const subagentTaskContent = (
  parentConversationId: string,
  threadId: string,
  taskId: string,
  afterSequence?: number,
  cursor?: string,
) => {
  const endpoint = `${parentSubagents(parentConversationId)}/${encodeURIComponent(threadId)}/tasks/${encodeURIComponent(taskId)}/content`;
  if (cursor != null) return `${endpoint}?cursor=${encodeURIComponent(cursor)}`;
  return afterSequence == null ? endpoint : `${endpoint}?afterSequence=${afterSequence}`;
};

export const subagentControl = (parentConversationId: string, threadId: string) =>
  `${conversationsRoot}/${encodeURIComponent(parentConversationId)}/subagents/${encodeURIComponent(threadId)}/control`;

export const subagentControlReceipt = (
  parentConversationId: string,
  threadId: string,
  taskId: string,
  invocationId: string,
) =>
  `${parentSubagents(parentConversationId)}/${encodeURIComponent(threadId)}/tasks/${encodeURIComponent(taskId)}/controls/${encodeURIComponent(invocationId)}`;

export const backgroundTasks = (conversationId: string) =>
  `${conversationsRoot}/${encodeURIComponent(conversationId)}/background-tasks`;

export const backgroundTasksCancel = (conversationId: string) =>
  `${backgroundTasks(conversationId)}/cancel`;

export const conversationPullRequest = (conversationId: string) =>
  `${conversationsRoot}/${encodeURIComponent(conversationId)}/pull-request`;

export const conversationPullRequests = () => `${conversationsRoot}/pull-requests`;

const pullRequestOAuthRoot = `${API_URL}/pull-requests/oauth`;

export const pullRequestConnection = () => `${pullRequestOAuthRoot}/status`;

export const pullRequestConnect = () => `${pullRequestOAuthRoot}/connect`;

export const pullRequestDisconnect = () => pullRequestOAuthRoot;

export const genTitle = (conversationId: string) =>
  `${conversationsRoot}/gen_title/${encodeURIComponent(conversationId)}`;

export const updateConversation = () => `${conversationsRoot}/update`;

export const archiveConversation = () => `${conversationsRoot}/archive`;
export const archiveAllConversations = () => `${conversationsRoot}/archive/all`;
export const pinConversation = () => `${conversationsRoot}/pin`;
export const markConversationSeen = () => `${conversationsRoot}/seen`;
export const markConversationUnread = () => `${conversationsRoot}/unread`;

export const deleteConversation = () => `${conversationsRoot}`;

export const deleteAllConversation = () => `${conversationsRoot}/all`;

export const importConversation = () => `${conversationsRoot}/import`;

export const forkConversation = () => `${conversationsRoot}/fork`;

export const duplicateConversation = () => `${conversationsRoot}/duplicate`;

export const projectsRoot = `${API_URL}/projects`;

export const projects = (params: q.ProjectListParams = {}) => {
  return `${projectsRoot}${buildQuery(params)}`;
};

export const projectById = (id: string) => `${projectsRoot}/${encodeURIComponent(id)}`;

export const projectFiles = (projectId: string) => `${projectById(projectId)}/files`;
export const projectAvailableFiles = (
  projectId: string,
  params: q.ProjectAvailableFilesParams = {},
) => `${projectById(projectId)}/files/available${buildQuery(params)}`;

export const projectFile = (projectId: string, fileId: string) =>
  `${projectFiles(projectId)}/${encodeURIComponent(fileId)}`;

export const projectConversation = (conversationId: string) =>
  `${projectsRoot}/conversations/${encodeURIComponent(conversationId)}`;

export const search = (q: string, cursor?: string | null) =>
  `${API_URL}/search?q=${q}${cursor ? `&cursor=${cursor}` : ''}`;

export const searchEnabled = () => `${API_URL}/search/enable`;

export const presets = () => `${API_URL}/presets`;

export const deletePreset = () => `${API_URL}/presets/delete`;

export const aiEndpoints = () => `${API_URL}/endpoints`;

export const tokenConfig = () => `${API_URL}/endpoints/token-config`;

export const reasoningCapabilities = (endpoint: string) =>
  `${API_URL}/endpoints/reasoning-capabilities?endpoint=${encodeURIComponent(endpoint)}`;

export const models = () => `${API_URL}/models`;

export const login = () => `${API_URL}/auth/login`;

export const logout = () => `${API_URL}/auth/logout`;

export const register = () => `${API_URL}/auth/register`;

export const refreshToken = (retry?: boolean) =>
  `${API_URL}/auth/refresh${retry === true ? '?retry=true' : ''}`;

export const requestPasswordReset = () => `${API_URL}/auth/requestPasswordReset`;

export const resetPassword = () => `${API_URL}/auth/resetPassword`;

export const verifyEmail = () => `${API_URL}/user/verify`;

export const requestEmailChange = () => `${API_URL}/user/email/change`;

export const confirmEmailChange = () => `${API_URL}/user/email/verify`;

// Auth page URLs (for client-side navigation and redirects)
export const loginPage = () => `${BASE_URL}/login`;
export const registerPage = () => `${BASE_URL}/register`;

const REDIRECT_PARAM = 'redirect_to';
const LOGIN_PATH_RE = /(?:^|\/)login(?:\/|$)/;

/**
 * Builds a `/login?redirect_to=...` URL from the given or current location.
 * Returns plain `/login` (no param) when already on a login route to prevent recursive nesting.
 */
export function buildLoginRedirectUrl(pathname?: string, search?: string, hash?: string): string {
  const p = pathname ?? window.location.pathname;
  if (LOGIN_PATH_RE.test(p)) {
    return '/login';
  }
  const s = search ?? window.location.search;
  const h = hash ?? window.location.hash;

  const stripped =
    BASE_URL && (p === BASE_URL || p.startsWith(BASE_URL + '/'))
      ? p.slice(BASE_URL.length) || '/'
      : p;
  const currentPath = `${stripped}${s}${h}`;
  if (!currentPath || currentPath === '/') {
    return '/login';
  }
  return `/login?${REDIRECT_PARAM}=${encodeURIComponent(currentPath)}`;
}

export const resendVerificationEmail = () => `${API_URL}/user/verify/resend`;

export const mcpReinitialize = (serverName: string) => `${API_URL}/mcp/${serverName}/reinitialize`;
export const mcpConnectionStatus = () => `${API_URL}/mcp/connection/status`;
export const mcpAuthValues = (serverName: string) => {
  return `${API_URL}/mcp/${serverName}/auth-values`;
};

export const cancelMCPOAuth = (serverName: string) => {
  return `${API_URL}/mcp/oauth/cancel/${serverName}`;
};

export const mcpOAuthStatus = (flowId: string) =>
  `${API_URL}/mcp/oauth/status/${encodeURIComponent(flowId)}`;

export const mcpOAuthBind = (serverName: string) => `${API_URL}/mcp/${serverName}/oauth/bind`;

export const actionOAuthBind = (actionId: string) => `${API_URL}/actions/${actionId}/oauth/bind`;

export const config = (context?: StartupConfigContext) =>
  `${API_URL}/config${buildQuery({ context })}`;

export const prompts = () => `${API_URL}/prompts`;

export const addPromptToGroup = (groupId: string) => `${API_URL}/prompts/groups/${groupId}/prompts`;

export const assistants = ({
  path = '',
  options,
  version,
  endpoint,
  isAvatar,
}: {
  path?: string;
  options?: object;
  endpoint?: AssistantsEndpoint;
  version: number | string;
  isAvatar?: boolean;
}) => {
  let url = isAvatar === true ? `${images()}/assistants` : `${API_URL}/assistants/v${version}`;

  if (path && path !== '') {
    url += `/${path}`;
  }

  if (endpoint) {
    options = {
      ...(options ?? {}),
      endpoint,
    };
  }

  if (options && Object.keys(options).length > 0) {
    const queryParams = new URLSearchParams(options as Record<string, string>).toString();
    url += `?${queryParams}`;
  }

  return url;
};

export const agents = ({ path = '', options }: { path?: string; options?: object }) => {
  let url = `${API_URL}/agents`;

  if (path && path !== '') {
    url += `/${path}`;
  }

  if (options && Object.keys(options).length > 0) {
    const queryParams = new URLSearchParams(options as Record<string, string>).toString();
    url += `?${queryParams}`;
  }

  return url;
};

export const activeJobs = () => `${API_URL}/agents/chat/active`;

const agentQueuedTurnsRoot = `${API_URL}/agents/chat/queued-turns`;
export const agentQueuedTurns = (protocolVersion?: 2) =>
  protocolVersion === 2 ? `${agentQueuedTurnsRoot}/v2` : agentQueuedTurnsRoot;
export const agentQueuedTurnsByConversation = (
  conversationId: string,
  clientRequestIds: string[] = [],
) => {
  const uniqueIds = Array.from(new Set(clientRequestIds)).slice(0, 100);
  const knownIds =
    uniqueIds.length > 0
      ? `&${uniqueIds.map((id) => `clientRequestIds=${encodeURIComponent(id)}`).join('&')}`
      : '';
  return `${agentQueuedTurnsRoot}?conversationId=${encodeURIComponent(conversationId)}${knownIds}`;
};
export const agentQueuedTurn = (queuedTurnId: string) =>
  `${agentQueuedTurnsRoot}/${encodeURIComponent(queuedTurnId)}`;

export const mcp = {
  tools: `${API_URL}/mcp/tools`,
  servers: `${API_URL}/mcp/servers`,
};

export const mcpServer = (serverName: string) => `${API_URL}/mcp/servers/${serverName}`;

export const revertAgentVersion = (agent_id: string) => `${agents({ path: `${agent_id}/revert` })}`;

export const files = () => `${API_URL}/files`;
export const fileUpload = () => `${API_URL}/files`;
export const fileDelete = () => `${API_URL}/files`;
export const fileDownload = (userId: string, fileId: string) =>
  `${API_URL}/files/download/${userId}/${fileId}`;
/* Deferred-preview lifecycle endpoint. Returns
 * `{ status, text?, textFormat?, previewError? }` so the frontend can
 * poll while background HTML extraction is in flight. See PR #12957. */
export const filePreview = (fileId: string) =>
  `${API_URL}/files/${encodeURIComponent(fileId)}/preview`;
export const fileConfig = () => `${API_URL}/files/config`;
/** Owner-scoped usage touch so queued attachments outlive the upload-window TTL. */
export const fileUsage = () => `${API_URL}/files/usage`;
export const agentFiles = (agentId: string) => `${API_URL}/files/agent/${agentId}`;

export const images = () => `${files()}/images`;

export const avatar = () => `${images()}/avatar`;

export const speech = () => `${files()}/speech`;

export const speechToText = () => `${speech()}/stt`;

export const textToSpeech = () => `${speech()}/tts`;

export const textToSpeechManual = () => `${textToSpeech()}/manual`;

export const textToSpeechVoices = () => `${textToSpeech()}/voices`;

export const getCustomConfigSpeech = () => `${speech()}/config/get`;

export const getPromptGroup = (_id: string) => `${prompts()}/groups/${_id}`;

export const resolvePromptGroup = (_id: string, version?: number) =>
  `${getPromptGroup(_id)}/resolve${buildQuery({ version })}`;

export const getPromptGroupRevisions = (_id: string) => `${getPromptGroup(_id)}/revisions`;

export const getPromptGroupsWithFilters = (filter: object) => {
  let url = `${prompts()}/groups`;
  // Filter out undefined/null values
  const cleanedFilter = Object.entries(filter).reduce(
    (acc, [key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  if (Object.keys(cleanedFilter).length > 0) {
    const queryParams = new URLSearchParams(cleanedFilter).toString();
    url += `?${queryParams}`;
  }
  return url;
};

export const getPromptsWithFilters = (filter: object) => {
  let url = prompts();
  if (Object.keys(filter).length > 0) {
    const queryParams = new URLSearchParams(filter as Record<string, string>).toString();
    url += `?${queryParams}`;
  }
  return url;
};

export const getPrompt = (_id: string) => `${prompts()}/${_id}`;

export const getRandomPrompts = (limit: number, skip: number) =>
  `${prompts()}/random?limit=${limit}&skip=${skip}`;

export const postPrompt = prompts;

export const updatePromptGroup = getPromptGroup;

export const recordPromptGroupUsage = (groupId: string) => `${prompts()}/groups/${groupId}/use`;

export const updatePromptLabels = (_id: string) => `${getPrompt(_id)}/labels`;

export const updatePromptTag = (_id: string) => `${getPrompt(_id)}/tags/production`;

export const deletePromptGroup = getPromptGroup;

export const deletePrompt = ({ _id, groupId }: { _id: string; groupId: string }) => {
  return `${prompts()}/${_id}?groupId=${groupId}`;
};

export const getCategories = () => `${API_URL}/categories`;

export const getAllPromptGroups = () => `${prompts()}/all`;

/* Scheduled chats */
export const schedules = () => `${API_URL}/schedules`;
export const schedule = (id: string) => `${schedules()}/${encodeURIComponent(id)}`;
export const scheduleMCPConsent = (id: string) => `${schedule(id)}/mcp-consent`;
export const runSchedule = (id: string) => `${schedule(id)}/run`;

/* Skills */
export const skills = () => `${API_URL}/skills`;
export const importSkill = () => `${skills()}/import`;

export const getSkill = (id: string) => `${skills()}/${encodeURIComponent(id)}`;

export const listSkillsWithFilters = (
  filter: Record<string, string | number | undefined | null>,
) => {
  const cleaned = Object.entries(filter).reduce(
    (acc, [key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        acc[key] = String(value);
      }
      return acc;
    },
    {} as Record<string, string>,
  );
  const query =
    Object.keys(cleaned).length > 0 ? `?${new URLSearchParams(cleaned).toString()}` : '';
  return `${skills()}${query}`;
};

export const skillFiles = (id: string) => `${getSkill(id)}/files`;

export const skillFile = (id: string, relativePath: string) =>
  `${skillFiles(id)}/${encodeURIComponent(relativePath)}`;

export const insights = () => `${API_URL}/insights`;
export const insightsAccess = () => `${insights()}/access`;

/* Conversation traces */
export const conversationTrace = (conversationId: string) =>
  `${API_URL}/traces/${encodeURIComponent(conversationId)}`;
export const conversationTraceAvailability = (conversationId: string) =>
  `${conversationTrace(conversationId)}/availability`;
export const conversationTraceRecords = (conversationId: string, cursor?: string) =>
  `${conversationTrace(conversationId)}/records${
    cursor ? `?${new URLSearchParams({ cursor }).toString()}` : ''
  }`;
export const conversationTraceRecord = (
  conversationId: string,
  recordId: string,
  messageId: string,
  sourceId?: string,
) =>
  `${conversationTrace(conversationId)}/records/${encodeURIComponent(recordId)}?${new URLSearchParams(
    { message: messageId, ...(sourceId ? { source: sourceId } : {}) },
  ).toString()}`;

export const adminSkillsSync = () => `${API_URL}/admin/skills/sync`;
export const adminSkillsSyncStatus = () => `${adminSkillsSync()}/status`;
export const adminSkillsSyncRun = () => `${adminSkillsSync()}/run`;
export const adminSkillsSyncCredential = (credentialKey: string) =>
  `${adminSkillsSync()}/credentials/${encodeURIComponent(credentialKey)}`;

/**
 * Skill filesystem tree (phase 2). URL shape mirrors the original UI PR so
 * the tree hooks keep their call surface. `path` is pre-encoded by the
 * caller (e.g. `${nodeId}/content`).
 */
export const skillTree = ({ skillId, path = '' }: { skillId: string; path?: string }) => {
  let url = `${API_URL}/skills/${encodeURIComponent(skillId)}/tree`;
  if (path) {
    url += `/${path}`;
  }
  return url;
};

/* Skill active states (per-user overrides) */
export const skillStates = () => `${API_URL}/user/settings/skills/active`;

/* Langfuse connection (admin) */
export const adminLangfuseConnection = () => `${API_URL}/admin/langfuse/connection`;
export const adminLangfuseConnectionTest = () => `${adminLangfuseConnection()}/test`;
export const adminLangfuseSessionLink = (conversationId: string) =>
  `${adminLangfuseConnection()}/session/${encodeURIComponent(conversationId)}`;
export const adminLangfusePromptSync = () => `${API_URL}/admin/langfuse/prompt-sync`;
export const adminLangfusePrompts = (params: t.TLangfusePromptListParams = {}) =>
  `${API_URL}/admin/langfuse/prompts${buildQuery(params)}`;
export const adminLangfuseSyncPrompts = () => `${API_URL}/admin/langfuse/prompts/sync`;
export const adminLangfusePrompt = (name: string, version?: number) =>
  `${API_URL}/admin/langfuse/prompts/${encodeURIComponent(name)}${buildQuery({ version })}`;

/* Combined Pinned-section display order: favorite and pinned-chat entry keys interleaved. */
export const pinnedOrder = () => `${API_URL}/user/settings/pinned-order`;

/* Tool favorites (starred marketplace items) */
export const toolFavorites = () => `${API_URL}/user/settings/favorites/tools`;
export const toolFavorite = (itemType: string, itemId: string) =>
  `${toolFavorites()}/${itemType}/${encodeURIComponent(itemId)}`;

/* Roles */
export const roles = () => `${API_URL}/roles`;
export const adminRoles = () => `${API_URL}/admin/roles`;
export const getRole = (roleName: string) => `${roles()}/${encodeURIComponent(roleName)}`;
export const updatePromptPermissions = (roleName: string) => `${getRole(roleName)}/prompts`;
export const updateMemoryPermissions = (roleName: string) => `${getRole(roleName)}/memories`;
export const updateAgentPermissions = (roleName: string) => `${getRole(roleName)}/agents`;
export const updatePeoplePickerPermissions = (roleName: string) =>
  `${getRole(roleName)}/people-picker`;
export const updateMCPServersPermissions = (roleName: string) => `${getRole(roleName)}/mcp-servers`;
export const updateRemoteAgentsPermissions = (roleName: string) =>
  `${getRole(roleName)}/remote-agents`;

export const updateMarketplacePermissions = (roleName: string) =>
  `${getRole(roleName)}/marketplace`;
export const updateSkillPermissions = (roleName: string) => `${getRole(roleName)}/skills`;

/* Conversation Tags */
export const conversationTags = (tag?: string) =>
  `${API_URL}/tags${tag != null && tag ? `/${encodeURIComponent(tag)}` : ''}`;

export const addTagToConversation = (conversationId: string) =>
  `${conversationTags()}/convo/${conversationId}`;

export const userTerms = () => `${API_URL}/user/terms`;
export const acceptUserTerms = () => `${API_URL}/user/terms/accept`;
export const banner = () => `${API_URL}/banner`;

// Message Feedback
export const feedback = (conversationId: string, messageId: string) =>
  `${API_URL}/messages/${conversationId}/${messageId}/feedback`;

// Two-Factor Endpoints
export const enableTwoFactor = () => `${API_URL}/auth/2fa/enable`;
export const enableTwoFactorSetup = () => `${API_URL}/auth/2fa/setup`;
export const confirmTwoFactorSetup = () => `${API_URL}/auth/2fa/setup/confirm`;
export const acknowledgeTwoFactorSetup = () => `${API_URL}/auth/2fa/setup/acknowledge`;
export const finalizeTwoFactorSetup = () => `${API_URL}/auth/2fa/setup/finalize`;
export const verifyTwoFactor = () => `${API_URL}/auth/2fa/verify`;
export const confirmTwoFactor = () => `${API_URL}/auth/2fa/confirm`;
export const disableTwoFactor = () => `${API_URL}/auth/2fa/disable`;
export const regenerateBackupCodes = () => `${API_URL}/auth/2fa/backup/regenerate`;
export const verifyTwoFactorTemp = () => `${API_URL}/auth/2fa/verify-temp`;

// Passkey (WebAuthn) Endpoints
export const passkeys = () => `${API_URL}/auth/passkey`;
export const passkey = (passkeyId: string) => `${passkeys()}/${encodeURIComponent(passkeyId)}`;
export const passkeyRegistrationOptions = () => `${passkeys()}/register/options`;
export const passkeyRegistrationVerify = () => `${passkeys()}/register/verify`;
export const passkeyLoginOptions = () => `${passkeys()}/login/options`;
export const passkeyLoginVerify = () => `${passkeys()}/login/verify`;

/* Memories */
export const memories = () => `${API_URL}/memories`;
export const memory = (key: string, agentId?: string) =>
  `${memories()}/${encodeURIComponent(key)}${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`;
export const memoryById = (id: string, agentId?: string) =>
  `${memories()}/id/${encodeURIComponent(id)}${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`;
export const memoryPreferences = () => `${memories()}/preferences`;

export const searchPrincipals = (params: q.PrincipalSearchParams) => {
  const { q: query, limit, types } = params;
  let url = `${API_URL}/permissions/search-principals?q=${encodeURIComponent(query)}`;

  if (limit !== undefined) {
    url += `&limit=${limit}`;
  }

  if (types && types.length > 0) {
    url += `&types=${types.join(',')}`;
  }

  return url;
};

export const getAccessRoles = (resourceType: ResourceType) =>
  `${API_URL}/permissions/${resourceType}/roles`;

export const getResourcePermissions = (resourceType: ResourceType, resourceId: string) =>
  `${API_URL}/permissions/${resourceType}/${resourceId}`;

export const updateResourcePermissions = (resourceType: ResourceType, resourceId: string) =>
  `${API_URL}/permissions/${resourceType}/${resourceId}`;

export const getEffectivePermissions = (resourceType: ResourceType, resourceId: string) =>
  `${API_URL}/permissions/${resourceType}/${resourceId}/effective`;

export const getAllEffectivePermissions = (resourceType: ResourceType) =>
  `${API_URL}/permissions/${resourceType}/effective/all`;

// SharePoint Graph API Token
export const graphToken = (scopes: string) =>
  `${API_URL}/auth/graph-token?scopes=${encodeURIComponent(scopes)}`;

export const resetToolApprovalGrants = (): string => `${API_URL}/agents/tools/approvals/reset`;
